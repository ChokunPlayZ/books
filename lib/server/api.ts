import {
  CATALOG_REUSE,
  CATALOG_MSRP,
  createCatalogService,
  knownBookCoverUrl,
} from "./catalogs.ts";
import { canonicalIsbn, volumeCoverKey } from "../domain.ts";
import { createAnimeService } from "./anime.ts";
import { createSeriesInfoService } from "./series-info.ts";
import { createSeriesDetailsService } from "./series-details.ts";
import { createMetadataSuggestions } from "./metadata-suggestions.ts";
import { createSeasonalDiscoveryService } from "./seasonal-discovery.ts";
import { createMetadataService } from "./metadata.ts";
import { AppError } from "./store.ts";
import { createSearchService } from "./search.ts";
import { createScrapeQueue } from "./scrape-queue.ts";
import { createAdminService } from "./admin.ts";
import { createPublisherCrawls } from "./publisher-crawls.ts";
import { createAdminUsers } from "./admin-users.ts";
import { attachCoverPlaceholders } from "./covers.ts";
import { createScraperDebugger } from "./scraper-debug.ts";
import {
  createImportDiscovery,
  type ImportDiscoveryBatch,
} from "./import-discovery.ts";
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
  const seriesInfo = createSeriesInfoService(store, catalogs, anime);
  const seriesDetails = createSeriesDetailsService(store);
  const suggestions = createMetadataSuggestions(store);
  const seasonal = createSeasonalDiscoveryService(anime, catalogs);
  const maintenance = createMetadataService(store, catalogs);
  const publisherCrawls = createPublisherCrawls(store, catalogs);
  const { validateCrawlTarget, ...maintenanceApi } = maintenance;
  const search = createSearchService(store, catalogs, fetchImpl);
  const discoverImportedBooks = createImportDiscovery(store, catalogs, covers);
  const scraperDebugger = createScraperDebugger(store, fetchImpl);
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
    pullSeriesInfo: async (arg) =>
      attachImages(await seriesInfo.pullSeriesInfo(arg)),
    ...Object.fromEntries(
      Object.entries({ ...catalogs, ...anime, ...seasonal }).map(
        ([name, method]) => [
          name,
          async (arg) => {
            authorizeRefresh(arg);
            return store.deferMetadataFill(async () =>
              attachImages(await method(arg)),
            );
          },
        ],
      ),
    ),
    searchExternalTitles: search.searchExternalTitles,
    searchExternalSuggestions: search.searchExternalSuggestions,
    recrawlMetadata: maintenance.recrawlMetadata,
    crawlPublisher: publisherCrawls.crawlPublisher,
    debugScraperIsbn: scraperDebugger.debugScraperIsbn,
    discoverBook: (arg: { row: number }) =>
      discoverImportedBooks(
        { firstRow: arg?.row, lastRow: arg?.row, afterRow: 0 },
        true,
      ),
    discoverImportedBooks: async (arg: ImportDiscoveryBatch) => {
      const result = await discoverImportedBooks(arg);
      if (result.next)
        await queue.enqueue(
          "discoverImportedBooks",
          result.next,
          "Discover imported books · continued",
          -10,
        );
      return result;
    },
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
    ...seriesInfo,
    ...seriesDetails,
    ...suggestions,
  };
  const api = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      async (arg) => {
        // Validate before enqueueing and again in the worker after role lookup.
        authorizeRefresh(arg);
        if (
          name === "pullSeriesInfo" &&
          arg?.automatic === true &&
          arg.search === undefined &&
          arg.mediaId === undefined &&
          arg.sourceUrl === undefined
        ) {
          // Automatic enrichment must not hold an HTTP/concurrency slot while
          // sources are slow, or block unrelated library actions after navigation.
          const request = {
            series: arg.series,
            type: arg.type,
            automatic: true,
          };
          const info = await seriesInfo.getSeriesInfo(request);
          return {
            ...(await attachImages(info)),
            discoveryJobId: await queue.enqueue(
              name,
              request,
              label(name, request),
              -10,
            ),
          };
        }
        if (
          Object.hasOwn(catalogs, name) &&
          (await catalogs[CATALOG_REUSE](name, arg))
        )
          return store.deferMetadataFill(async () =>
            attachImages(await method(arg)),
          );
        if (Object.hasOwn(queued, name))
          return queue.run(name, arg, label(name, arg));
        return await attachImages(await method(arg));
      },
    ]),
  );
  api.getCollection = async () => {
    let collection = await store.api.getCollection();
    let filledMsrp = false;
    const prices = new Map();
    await eachLimit(collection.books, async (book) => {
      const isbn = canonicalIsbn(book.isbn);
      if (!isbn || (book.msrp !== "" && book.msrp != null)) return;
      if (!prices.has(isbn)) prices.set(isbn, catalogs[CATALOG_MSRP](isbn));
      const price = await prices.get(isbn);
      if (price && (await store.fillMissingMsrp(book, price)))
        filledMsrp = true;
    });
    // Metadata changes have new revision tokens; return one coherent shelf.
    if (filledMsrp) collection = await store.api.getCollection();
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
    return store.transaction(async () => {
      const result = await store.api.saveBook({ ...request, book });
      const discoveryJobId = await store.enqueueBookDiscovery(
        result.row,
        request.requestId,
      );
      return { ...result, ...(discoveryJobId ? { discoveryJobId } : {}) };
    });
  };
  api.saveSeriesVolumes = (request) =>
    store.transaction(async () => {
      const result = await store.api.saveSeriesVolumes(request);
      for (const change of request.changes)
        await store.enqueueBookDiscovery(change.row, request.requestId);
      return result;
    });
  // Searching stays independent of image downloads. Visible search covers are
  // resolved separately, without assigning them to books or changing the shelf.
  async function attachSearchPreviews(result) {
    await eachLimit(result.results, async (item) => {
      // Shared metadata can refer to an image first stored by another account.
      // Let the on-demand resolver grant access through its public source URL.
      if (item.coverId && !(await store.covers.canAccess(item.coverId)))
        item.coverId = "";
    });
    return attachCoverPlaceholders(store, result);
  }
  return {
    ...api,
    ...suggestions,
    getMetadataBrowse: seriesDetails.getMetadataBrowse,
    getSeriesVolumes: async (
      arg: Parameters<typeof seriesDetails.getSeriesVolumes>[0],
    ) => attachImages(await seriesDetails.getSeriesVolumes(arg)),
    getSeriesInfo: async (
      arg: Parameters<typeof seriesInfo.getSeriesInfo>[0],
    ) => attachImages(await seriesInfo.getSeriesInfo(arg)),
    getSeriesDiscovery: async (
      arg: Parameters<typeof seriesInfo.getSeriesInfo>[0] & { id: string },
    ) => {
      const info = await seriesInfo.getSeriesInfo(arg);
      if (typeof arg.id !== "string" || arg.id.length > 100)
        throw new AppError("Scraping task not found.", 404);
      const job = await store.db
        .prepare(
          "SELECT status,result,error,payload,available_at FROM scrape_jobs WHERE id=? AND user_id=app_user_id() AND kind='pullSeriesInfo'",
        )
        .get(arg.id);
      if (
        !job ||
        job.payload.series !== arg.series ||
        job.payload.type !== arg.type
      )
        throw new AppError("Scraping task not found.", 404);
      if (job.result && ["succeeded", "failed"].includes(job.status))
        return attachImages({
          ...info,
          candidates:
            job.result.workId === info.workId ? job.result.candidates : [],
          warnings: job.result.warnings,
        });
      if (["failed", "cancelled"].includes(job.status))
        throw new AppError(job.error || "Scraping task cancelled.", 409);
      if (job.status === "queued") {
        if (job.available_at > Date.now())
          throw new AppError(
            "The source is unavailable. Your task will retry after the cooldown.",
            503,
          );
        const settings = await store.db
          .prepare("SELECT paused FROM scrape_queue_settings WHERE id=1")
          .get();
        if (settings.paused)
          throw new AppError(
            "Scraping is paused. Your task is queued for later.",
            503,
          );
      }
      return { ...info, discoveryJobId: arg.id };
    },
    ...maintenanceApi,
    ...search,
    searchKnownEntities: async (arg) =>
      attachSearchPreviews(await search.searchKnownEntities(arg)),
    getSearchCover: async (arg) => {
      const result = await search.getSearchCover(arg);
      if (result.coverId && !(await store.covers.canAccess(result.coverId)))
        result.coverId = "";
      if (!result.coverId && result.coverUrl)
        result.coverId = (await covers.ensure(result.coverUrl)).id;
      return attachCoverPlaceholders(store, result);
    },
    ...createAdminService(store),
    ...createAdminUsers(store),
    getScraperDebugSources: scraperDebugger.getScraperDebugSources,
    debugScraperIsbn: async (arg) => {
      const request = scraperDebugger.validateScraperDebug(arg);
      return queue.run(
        "debugScraperIsbn",
        request,
        `Debug ${request.providerId} · ${request.isbn || request.query}`,
      );
    },
    getPublisherCrawls: publisherCrawls.getPublisherCrawls,
    managePublisherCrawl: publisherCrawls.managePublisherCrawl,
    startPublisherCrawl: (arg) =>
      publisherCrawls.startPublisherCrawl(arg, (id, label) =>
        queue.enqueue("crawlPublisher", { id }, label, -100),
      ),
    getScrapeQueue: queue.getScrapeQueue,
    getScrapeJob: queue.getScrapeJob,
    manageScrapeQueue: queue.manageScrapeQueue,
    manageScrapeJob: queue.manageScrapeJob,
    searchKnownSuggestions: search.searchKnownSuggestions,
    searchExternalSuggestions: async (arg) =>
      (await search.cachedSearchSuggestions(arg)) ??
      queue.run(
        "searchExternalSuggestions",
        arg,
        label("searchExternalSuggestions", arg),
      ),
    searchExternalTitles: async (arg) =>
      attachSearchPreviews(
        await queue.run(
          "searchExternalTitles",
          arg,
          label("searchExternalTitles", arg),
        ),
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
