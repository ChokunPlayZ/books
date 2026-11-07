import { randomUUID } from "node:crypto";
import {
  canonicalIsbn,
  digest,
  parsePageCount,
  safeCoverUrl,
  safePublisherUrl,
} from "../domain.ts";
import { CACHE_GROUPS } from "../metadata.ts";
import type {
  CacheEntry,
  CacheGroup,
  CrawlResult,
  CrawlTarget,
  MetadataOverview,
  MetadataQuery,
} from "../metadata.ts";
import type { openStore } from "./store.ts";
import { AppError } from "./store.ts";
import type { createCatalogService } from "./catalogs.ts";

type Store = Awaited<ReturnType<typeof openStore>>;
type Catalogs = ReturnType<typeof createCatalogService>;
type Target = CrawlTarget & { arg: Record<string, string> };
const cooldown = (key: string) =>
  key.endsWith(":retry") ||
  key.endsWith(":cooldown") ||
  key.startsWith("cover:retry:");
function parse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function groupFor(key: string): CacheGroup {
  key = key.replace(/^user:\d+:/, "");
  if (cooldown(key)) return "cooldowns";
  if (key.startsWith("isbn:")) return "isbn";
  if (/^(publisher-|series:|series-categories:|releases:)/.test(key))
    return "catalogs";
  if (key.startsWith("scrape:")) return "responses";
  if (key.startsWith("cover:")) return "covers";
  if (key.startsWith("anilist:")) return "anime";
  return "other";
}

// Maintenance touches only disposable cache rows. Covers, library records,
// saved releases and catalog links live in separate tables.
export function createMetadataService(store: Store, catalogs: Catalogs) {
  const pending = new Map<string, Promise<CrawlResult>>();
  const cacheRows = async () =>
    (await store.db
      .prepare(
        "SELECT key, value, expires_at, octet_length(value) AS bytes FROM cache ORDER BY key",
      )
      .all()) as unknown as {
      key: string;
      value: string;
      expires_at: number;
      bytes: number;
    }[];
  async function entries(
    rows?: Awaited<ReturnType<typeof cacheRows>>,
  ): Promise<CacheEntry[]> {
    rows ??= await cacheRows();
    const now = Date.now();
    return rows.map((row) => {
      const value = parse(row.value);
      const checked = value?.checkedAt;
      const date = new Date(checked || NaN);
      return {
        key: row.key,
        group: groupFor(row.key),
        bytes: row.bytes,
        label: String(
          value?.source ||
            value?.details?.title ||
            value?.title ||
            value?.series ||
            value?.url ||
            row.key,
        ),
        expiresAt: row.expires_at,
        expired: row.expires_at !== 0 && row.expires_at <= now,
        checkedAt: Number.isNaN(date.getTime()) ? "" : date.toISOString(),
      };
    });
  }
  async function queryEntries(request: MetadataQuery = {}, all?: CacheEntry[]) {
    all ??= await entries();
    if (!request || typeof request !== "object" || Array.isArray(request))
      throw new AppError("Choose cache filters.");
    const group = request.group || "all";
    if (group !== "all" && !Object.hasOwn(CACHE_GROUPS, group))
      throw new AppError("Choose a cache category.");
    const search = String(request.search || "")
      .trim()
      .toLowerCase()
      .slice(0, 500);
    return all.filter(
      (entry) =>
        (group === "all" || entry.group === group) &&
        (!request.expiredOnly || entry.expired) &&
        (!search ||
          (entry.label + " " + entry.key).toLowerCase().includes(search)),
    );
  }
  async function targets(
    rows?: Awaited<ReturnType<typeof cacheRows>>,
  ): Promise<Target[]> {
    rows ??= await cacheRows();
    const result = new Map<string, Target>();
    function add(
      kind: Target["kind"],
      arg: Record<string, string>,
      label: string,
      detail: string,
    ) {
      const id = kind + ":" + digest(JSON.stringify(arg));
      result.set(id, { id, kind, arg, label, detail });
    }
    const collection = await store.api.getCollection();
    for (const book of collection.books) {
      const isbn = canonicalIsbn(book.isbn);
      if (isbn) await add("isbn", { isbn }, isbn, book.series);
    }
    for (const link of collection.seriesCatalogs)
      await add(
        "series",
        { series: link.series, type: link.type, publisherId: link.publisherId },
        link.series,
        link.type + " · " + link.publisherId,
      );
    for (const row of rows) {
      const key = row.key.replace(/^user:\d+:/, "");
      if (
        !/^(isbn:|releases:v1:|publisher-catalog:v1:|publisher-directory:|series:v1:)/.test(
          key,
        )
      )
        continue;
      const value = parse(row.value);
      if (/^isbn:v\d+:/.test(row.key)) {
        const isbn = canonicalIsbn(row.key.split(":").at(-1));
        if (isbn && !result.has("isbn:" + digest(JSON.stringify({ isbn }))))
          await add(
            "isbn",
            { isbn },
            isbn,
            value?.details?.title || "Cached ISBN",
          );
      } else if (row.key.startsWith("releases:v1:") && value?.publisherId) {
        const publisher = collection.publishers.find(
          (p) => p.id === value.publisherId,
        );
        await add(
          "releases",
          { publisherId: value.publisherId },
          publisher?.name || value.publisherId,
          "Release feed",
        );
      } else if (row.key.startsWith("publisher-catalog:v1:") && value?.url) {
        await add(
          "catalog",
          { url: value.url },
          value.title || value.url,
          "Publisher category",
        );
      } else if (row.key.startsWith("publisher-directory:") && value?.url) {
        await add(
          "directory",
          { url: value.url },
          value.title || value.url,
          "Publisher directory",
        );
      } else if (
        key.startsWith("series:v1:") &&
        row.key.startsWith(`user:${store.currentUser().id}:`) &&
        value?.series &&
        value?.publisherId &&
        value?.type
      ) {
        await add(
          "series",
          {
            series: value.series,
            type: value.type,
            publisherId: value.publisherId,
          },
          value.series,
          value.type + " · " + value.publisherId,
        );
      }
    }
    return [...result.values()];
  }
  async function getMetadataOverview(
    request: MetadataQuery = {},
  ): Promise<MetadataOverview> {
    store.requireAdmin();
    const rows = await cacheRows(),
      all = await entries(rows),
      filtered = await queryEntries(request, all);
    const pages = Math.max(1, Math.ceil(filtered.length / 20));
    const page = Math.max(
      1,
      Math.min(pages, Number.isSafeInteger(request.page) ? request.page : 1),
    );
    const books = (await store.api.getCollection()).books;
    return {
      summary: {
        count: all.length,
        bytes: all.reduce((sum, entry) => sum + entry.bytes, 0),
        expired: all.filter(
          (entry) => entry.expired && entry.group !== "cooldowns",
        ).length,
        cooldowns: all.filter(
          (entry) => entry.group === "cooldowns" && !entry.expired,
        ).length,
      },
      groups: (Object.keys(CACHE_GROUPS) as CacheGroup[]).map((id) => ({
        id,
        count: all.filter((entry) => entry.group === id).length,
      })),
      entries: filtered.slice((page - 1) * 20, page * 20),
      total: filtered.length,
      page,
      pages,
      targets: (await targets(rows)).map(({ arg: _arg, ...target }) => target),
      coverage: {
        books: books.length,
        withIsbn: books.filter((book) => canonicalIsbn(book.isbn)).length,
        missingCover: books.filter((book) => !book.coverId && !book.coverUrl)
          .length,
        missingLink: books.filter((book) => !book.publisherUrl).length,
        missingPages: books.filter((book) => !book.pageCount).length,
      },
    };
  }
  async function purgeMetadataCache(
    request: MetadataQuery & { key?: string } = {},
  ) {
    store.requireAdmin();
    if (pending.size)
      throw new AppError(
        "Wait for the current re-crawl to finish before purging.",
        409,
      );
    if (
      request &&
      Object.hasOwn(request, "key") &&
      (typeof request.key !== "string" || !request.key)
    )
      throw new AppError("Choose a cached record to purge.");
    const selected = (await queryEntries(request)).filter(
      (entry) =>
        entry.group !== "cooldowns" &&
        (!request.key || entry.key === request.key),
    );
    return store.transaction(async () => {
      // Serialize the check/delete with worker claims, not just this process.
      await store.db.query("SELECT pg_advisory_xact_lock(726005::bigint)");
      const running = await store.db
        .prepare("SELECT 1 FROM scrape_jobs WHERE status='running' LIMIT 1")
        .get();
      if (running)
        throw new AppError(
          "Wait for running scraping tasks to finish before purging.",
          409,
        );
      const remove = store.db.prepare("DELETE FROM cache WHERE key=?");
      for (const entry of selected) await remove.run(entry.key);
      return { purged: selected.length };
    });
  }
  async function getMetadataCacheEntry(request: { key: string }) {
    store.requireAdmin();
    if (typeof request?.key !== "string")
      throw new AppError("Choose a cached record.");
    const row = await store.db
      .prepare("SELECT value FROM cache WHERE key=?")
      .get(request.key);
    if (!row)
      throw new AppError(
        "This cached record was purged. Reload the list.",
        404,
      );
    const value = String(row.value);
    let formatted = value;
    try {
      formatted = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      /* Plain cached URLs remain readable. */
    }
    return {
      content: formatted.slice(0, 16000),
      truncated: formatted.length > 16000,
    };
  }
  async function crawl(
    target: Target,
    fillMissing: boolean,
  ): Promise<CrawlResult> {
    let result,
      filled = 0;
    if (target.kind === "isbn") {
      result = await catalogs.lookupIsbn({ ...target.arg, refresh: true });
      if (result.found && fillMissing) {
        const details = result.details;
        // Re-read after the network wait, and save with the current revision token.
        // An ISBN lookup never guesses a series, purchase, reading state or edition.
        for (const book of (await store.api.getCollection()).books) {
          if (canonicalIsbn(book.isbn) !== target.arg.isbn) continue;
          if (details.isbn && canonicalIsbn(details.isbn) !== target.arg.isbn)
            continue;
          const next = { ...book };
          if (!book.coverId && !book.coverUrl)
            next.coverUrl = safeCoverUrl(details.coverUrl);
          if (!book.publisherUrl)
            next.publisherUrl = safePublisherUrl(details.url, book.publisher);
          if (!book.pageCount)
            next.pageCount = parsePageCount(details.pageCount);
          if (book.msrp === "" || book.msrp == null) {
            next.msrp = details.msrp ?? "";
            next.msrpCurrency = details.msrpCurrency || details.currency || "";
          }
          if (
            next.coverUrl !== book.coverUrl ||
            next.publisherUrl !== book.publisherUrl ||
            next.pageCount !== book.pageCount ||
            next.msrp !== book.msrp ||
            next.msrpCurrency !== book.msrpCurrency
          ) {
            await store.api.saveBook({
              row: book.row,
              token: book.token,
              book: next,
              requestId: randomUUID(),
              allowDuplicate: true,
            });
            filled++;
          }
        }
      }
      const warnings = result.warnings || [];
      return {
        id: target.id,
        status:
          result.stale || (!result.found && warnings.length > 0)
            ? "failed"
            : warnings.length
              ? "warning"
              : "updated",
        filled,
        message: [
          result.stale
            ? "Source unavailable. Previous metadata kept."
            : result.found
              ? "Metadata refreshed."
              : "No exact ISBN match found.",
          filled
            ? `Filled missing fields on ${filled} book${filled === 1 ? "" : "s"}.`
            : "",
          ...warnings,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
    const request = { ...target.arg, refresh: true };
    if (target.kind === "series")
      result = await catalogs.getSeriesCatalog(request);
    else if (target.kind === "releases")
      result = await catalogs.getPublisherReleases(request);
    else if (target.kind === "catalog")
      result = await catalogs.getPublisherCatalog(request);
    else result = await catalogs.getPublisherDirectory(request);
    return {
      id: target.id,
      filled,
      status: result.stale
        ? "failed"
        : result.error || result.needsSelection
          ? "warning"
          : "updated",
      message:
        result.error ||
        `Refreshed ${result.titles?.length ?? result.items?.length ?? 0} records.`,
    };
  }
  async function validateCrawlTarget(request: {
    id: string;
    fillMissing?: boolean;
  }) {
    store.requireAdmin();
    if (
      typeof request?.id !== "string" ||
      (Object.hasOwn(request, "fillMissing") &&
        typeof request.fillMissing !== "boolean")
    )
      throw new AppError("Choose a source and a boolean fill-missing value.");
    const target = (await targets()).find((entry) => entry.id === request.id);
    if (!target)
      throw new AppError(
        "This source is no longer available. Reload the list.",
        404,
      );
    return target;
  }
  async function recrawlMetadata(request: {
    id: string;
    fillMissing?: boolean;
  }) {
    store.requireAdmin();
    if (typeof request?.id !== "string")
      throw new AppError("Choose a source to re-crawl.");
    const pendingKey =
      store.currentUser().id +
      ":" +
      request.id +
      ":" +
      (request.fillMissing === true);
    if (!pending.has(pendingKey)) {
      const operation = (async () => {
        const target = await validateCrawlTarget(request);
        return crawl(target, request.fillMissing === true).catch((error) => ({
          id: target.id,
          status: "failed" as const,
          filled: 0,
          message: error.message || "Re-crawl failed. Try again later.",
        }));
      })().finally(() => pending.delete(pendingKey));
      pending.set(pendingKey, operation);
    }
    return pending.get(pendingKey);
  }
  return {
    validateCrawlTarget,
    getMetadataOverview,
    getMetadataCacheEntry,
    purgeMetadataCache,
    recrawlMetadata,
  };
}
