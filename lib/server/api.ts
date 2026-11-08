import {
  CATALOG_REUSE,
  createCatalogService,
  knownBookCoverUrl,
} from "./catalogs.ts";
import { canonicalIsbn, volumeCoverKey } from "../domain.ts";
import { createAnimeService } from "./anime.ts";
import { createSeasonalDiscoveryService } from "./seasonal-discovery.ts";
import { createMetadataService } from "./metadata.ts";
import { AppError } from "./store.ts";
import { createSearchService } from "./search.ts";
import { createScrapeQueue } from "./scrape-queue.ts";
import { createAdminService } from "./admin.ts";
import { attachCoverPlaceholders } from "./covers.ts";
import type { Store } from "./store.ts";

const queues = new WeakMap<Store, ReturnType<typeof createScrapeQueue>>();
export const applicationQueue = (store: Store) => queues.get(store);

async function eachLimit(items, action, limit = 4) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, limit) }, async () => {
      while (cursor < items.length) await action(items[cursor++]);
    }),
  );
}

// All client-facing book data carries stored IDs. Cover discovery belongs here.
export function createApplicationApi(
  store,
  covers,
  fetchImpl = globalThis.fetch,
) {
  const catalogs = createCatalogService(store, fetchImpl);
  const anime = createAnimeService(store, fetchImpl);
  const seasonal = createSeasonalDiscoveryService(anime, catalogs);
  const maintenance = createMetadataService(store, catalogs);
  const { validateCrawlTarget, ...maintenanceApi } = maintenance;
  const search = createSearchService(store, catalogs, fetchImpl);
  function authorizeRefresh(arg: unknown) {
    if (!arg || typeof arg !== "object") return;
    const refresh = (arg as { refresh?: unknown }).refresh;
    if (Object.hasOwn(arg, "refresh") && typeof refresh !== "boolean")
      throw new AppError("Choose a boolean refresh value.");
    if (refresh === true) store.requireAdmin();
  }
  async function attachImages(result) {
    const records = [];
    function visit(value) {
      if (!value || typeof value !== "object") return;
      if (Object.hasOwn(value, "coverUrl")) records.push(value);
      for (const child of Object.values(value)) visit(child);
    }
    visit(result);
    await eachLimit(records, async (record) => {
      if (!record.coverId && record.coverUrl) {
        try {
          record.coverId = (await covers.ensure(record.coverUrl)).id;
          if (record.row)
            record.coverId = await store.covers.assign(
              record.row,
              record.coverId,
              record.token,
            );
        } catch {
          // Metadata and the rest of the library remain usable during a source outage.
          record.coverId = "";
        }
      }
    });
    const books = (await store.api.getCollection()).books;
    for (const record of records) {
      if (
        !record.coverId ||
        record.row ||
        record.bundle ||
        record.special ||
        record.catalogVariant
      )
        continue;
      const isbn = canonicalIsbn(record.isbn);
      const key = volumeCoverKey(record);
      for (const book of books) {
        if (book.coverId || book.coverUrl) continue;
        if (
          (isbn && canonicalIsbn(book.isbn) === isbn) ||
          (key && volumeCoverKey(book) === key)
        ) {
          book.coverId = await store.covers.assign(
            book.row,
            record.coverId,
            book.token,
          );
        }
      }
    }
    if (result && typeof result === "object" && !Array.isArray(result)) {
      result.bookCoverIds = Object.fromEntries(
        books
          .filter((book) => book.coverId)
          .map((book) => [book.row, book.coverId]),
      );
      if (Array.isArray(result.covers)) {
        const missing = result.covers.filter((cover) => !cover.coverId).length;
        result.covers = result.covers.filter((cover) => cover.coverId);
        if (missing)
          result.warnings.push(
            "Some cover images could not be downloaded. Try pulling covers again.",
          );
      }
    }
    return await attachCoverPlaceholders(store, result);
  }
  const queued = {
    ...Object.fromEntries(
      Object.entries({ ...catalogs, ...anime, ...seasonal }).map(
        ([name, method]) => [
          name,
          async (arg) => {
            authorizeRefresh(arg);
            return attachImages(await method(arg));
          },
        ],
      ),
    ),
    searchExternalTitles: search.searchExternalTitles,
    recrawlMetadata: maintenance.recrawlMetadata,
  };
  const queue = queues.get(store) ?? createScrapeQueue(store, queued);
  queue.updateHandlers(queued);
  queues.set(store, queue);
  const label = (name: string, arg: any) =>
    [
      name,
      typeof arg === "string"
        ? arg
        : arg?.isbn ||
          arg?.series ||
          arg?.query ||
          arg?.url ||
          arg?.publisherId ||
          arg?.id ||
          "",
    ]
      .filter(Boolean)
      .join(" · ");
  const methods: Record<string, (arg?: unknown) => unknown> = {
    ...store.api,
    ...catalogs,
    ...anime,
    ...seasonal,
  };
  const api = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      async (arg) => {
        // Validate before enqueueing and again in the worker after role lookup.
        authorizeRefresh(arg);
        if (
          Object.hasOwn(catalogs, name) &&
          (await catalogs[CATALOG_REUSE](name, arg))
        )
          return attachImages(await method(arg));
        if (Object.hasOwn(queued, name))
          return queue.run(name, arg, label(name, arg));
        return await attachImages(await method(arg));
      },
    ]),
  );
  api.getCollection = async () => {
    const collection = await store.api.getCollection();
    await eachLimit(
      [...collection.books, ...collection.trash.map((entry) => entry.book)],
      async (book) => {
        if (book.coverId) return;
        try {
          const source = await knownBookCoverUrl(store, book);
          if (source) {
            const image = await covers.ensure(source);
            book.coverId = await store.covers.assign(
              book.row,
              image.id,
              book.token,
            );
          }
        } catch {}
      },
    );
    return await attachImages(collection);
  };
  api.saveBook = async (request) => {
    const book = { ...request.book };
    if (book.coverUrl && !book.coverId)
      book.coverId = (await covers.ensure(book.coverUrl)).id;
    return await store.api.saveBook({ ...request, book });
  };
  // Search must never wait for cover downloads or mutate a user's shelf.
  return {
    ...api,
    ...maintenanceApi,
    ...search,
    ...createAdminService(store),
    getScrapeQueue: queue.getScrapeQueue,
    getScrapeJob: queue.getScrapeJob,
    manageScrapeQueue: queue.manageScrapeQueue,
    manageScrapeJob: queue.manageScrapeJob,
    searchExternalTitles: async (arg) =>
      queue.run(
        "searchExternalTitles",
        arg,
        label("searchExternalTitles", arg),
      ),
    recrawlMetadata: async (arg) => {
      store.requireAdmin();
      return queue.run("recrawlMetadata", arg, label("recrawlMetadata", arg));
    },
    enqueueMetadataRecrawl: async (arg) => {
      store.requireAdmin();
      const target = await validateCrawlTarget(arg);
      return {
        id: await queue.enqueue(
          "recrawlMetadata",
          arg,
          `Re-scrape · ${target.label}`,
        ),
      };
    },
    enqueueScrapeTask: async (request) => {
      store.requireAdmin();
      if (!request || !Object.hasOwn(catalogs, request.kind))
        throw new AppError("Choose a supported scraping task.");
      if (
        !request.arg ||
        typeof request.arg !== "object" ||
        Array.isArray(request.arg)
      )
        throw new AppError("Choose a scraping target.");
      const arg = { ...request.arg, refresh: true };
      return {
        id: await queue.enqueue(
          request.kind,
          arg,
          `Force re-scrape · ${label(request.kind, arg)}`,
        ),
      };
    },
  };
}
