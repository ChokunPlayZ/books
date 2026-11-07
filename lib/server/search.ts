import {
  PUBLISHERS,
  canonicalIsbn,
  digest,
  parseCatalog,
  catalogTotal,
  splitFirstPageTitle,
  publisherKey,
} from "../domain.ts";
import {
  mergeSearchResults,
  searchLanguage,
  type KnownSearch,
  type ExternalSearch,
  type SearchResult,
  type SearchSource,
} from "../domain/search.ts";
import { AppError, type Store } from "./store.ts";
import { createScraperContext } from "./scrapers/http.ts";
import {
  createScraperRegistry,
  SCRAPER_SOURCES,
  supportsIsbn,
} from "./scrapers/registry.ts";
import type { ScraperDefinition } from "./scrapers/types.ts";
import type { createCatalogService } from "./catalogs.ts";
import { SCRAPE_TTL } from "./scrape-cache.ts";

function queryFrom(request: unknown) {
  const query = (request as { query?: unknown })?.query;
  if (
    typeof query !== "string" ||
    query.trim().length < 2 ||
    query.length > 200
  )
    throw new AppError("Enter a title, publisher or ISBN (2–200 characters).");
  return query.trim().normalize("NFKC");
}

export function createSearchService(
  store: Store,
  catalogs: Pick<
    ReturnType<typeof createCatalogService>,
    "getPublisherDirectory" | "getSeriesCategories"
  >,
  fetchImpl = globalThis.fetch,
  definitions: readonly ScraperDefinition[] = SCRAPER_SOURCES,
) {
  const context = createScraperContext(store.cache, fetchImpl, definitions);
  const registry = createScraperRegistry(context, definitions);
  const describe = (source): SearchSource => ({
    id: source.id,
    name:
      PUBLISHERS.find((publisher) => publisher.id === source.id)?.name ||
      source.priceSource?.name ||
      {
        "google-books": "Google Books",
        "open-library": "Open Library",
        hanmoto: "Hanmoto",
      }[source.id] ||
      source.id,
  });
  function providers(query: string) {
    const isbn = canonicalIsbn(query);
    return isbn
      ? registry.isbnProviders.filter((source) => supportsIsbn(source, isbn))
      : registry.titleProviders.filter((source) =>
          source.titleLanguages.includes(searchLanguage(query)),
        );
  }
  function publicUrl(raw: unknown, sourceId?: string) {
    if (typeof raw !== "string" || !raw) return "";
    try {
      const url = new URL(raw);
      const sources = sourceId
        ? [registry.get(sourceId)].filter(Boolean)
        : definitions;
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !sources.some((source) => source.hosts.includes(url.hostname))
      )
        return "";
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }
  function titleResult(
    book,
    source: SearchSource,
    known: boolean,
  ): SearchResult | null {
    if (!book || typeof book !== "object") return null;
    const title = typeof book.title === "string" ? book.title : book.series;
    if (typeof title !== "string" || !title.trim()) return null;
    const url = publicUrl(book.url || book.publisherUrl);
    const volume =
      book.volume === "" || book.volume == null ? "" : Number(book.volume);
    return {
      id:
        "title:" +
        digest(
          JSON.stringify([
            url,
            title,
            book.publisher,
            volume,
            book.edition || book.type,
            canonicalIsbn(book.isbn),
            !!(
              book.variant ||
              book.special ||
              book.bundle ||
              book.variantGroup
            ),
          ]),
        ),
      kind: "title",
      title: title.slice(0, 1000),
      series: typeof book.series === "string" ? book.series : title,
      publisher: typeof book.publisher === "string" ? book.publisher : "",
      type: typeof book.type === "string" ? book.type : "",
      edition: typeof book.edition === "string" ? book.edition : "",
      aliases:
        typeof book.catalogSeries === "string" ? [book.catalogSeries] : [],
      volume: Number.isFinite(volume) ? volume : "",
      isbn: canonicalIsbn(book.isbn),
      url,
      variant: !!(
        book.variant ||
        book.special ||
        book.bundle ||
        book.variantGroup
      ),
      known,
      owned: false,
      sources: [{ ...source, url }],
      score: 0,
    };
  }

  async function searchKnownEntities(request: unknown): Promise<KnownSearch> {
    const query = queryFrom(request);
    const [collection, rows] = await Promise.all([
      store.api.getCollection(),
      store.cache.searchable(),
    ]);
    const results: SearchResult[] = [];
    for (const book of collection.books) {
      const item = titleResult(
        book,
        { id: "library", name: "Your library" },
        true,
      );
      if (item)
        results.push({
          ...item,
          id: "library:" + book.row,
          owned: true,
          librarySeries: book.series,
        });
    }
    for (const book of collection.savedReleases) {
      const item = titleResult(
        book,
        { id: "saved", name: "Saved titles" },
        true,
      );
      if (item) results.push(item);
    }
    for (const row of rows) {
      try {
        const value = JSON.parse(row.value);
        const source = registry.get(
          value.publisherId ||
            value.sourceId ||
            publisherKey(value.details?.publisher),
        );
        const label = source
          ? describe(source)
          : { id: "cache", name: "Previously found" };
        const books = [
          ...(Array.isArray(value.items) ? value.items : []),
          ...(Array.isArray(value.titles) ? value.titles : []),
          ...(value.found && value.details
            ? [{ ...value.details, isbn: value.isbn }]
            : []),
        ];
        for (const book of books) {
          const item = titleResult(book, label, true);
          if (item) results.push(item);
        }
      } catch {
        /* A disposable malformed cache entry must not break search. */
      }
    }
    for (const publisher of PUBLISHERS)
      results.push({
        id: "publisher:" + publisher.id,
        kind: "publisher",
        title: publisher.name,
        series: "",
        publisher: "",
        type: "",
        volume: "",
        isbn: "",
        url: publisher.url,
        known: true,
        owned: false,
        sources: [],
        score: 0,
      });
    for (const shop of registry.priceProviders)
      results.push({
        id: "store:" + shop.id,
        kind: "store",
        title: shop.priceSource.name,
        series: "",
        publisher: "",
        type: "",
        volume: "",
        isbn: "",
        url: shop.priceSource.searchUrl(encodeURIComponent(query)),
        known: true,
        owned: false,
        sources: [],
        score: 0,
      });
    return {
      query,
      results: mergeSearchResults(query, [], results),
      sources: providers(query).map(describe),
    };
  }

  async function loadTitles(source, query: string) {
    if (source.searchTitles) return await source.searchTitles(query);
    // Search a single listing page, rather than crawling every category or volume.
    if (source.priceSource && source.catalog) {
      const url = source.priceSource.searchUrl(encodeURIComponent(query));
      const html = await context.fetchText(url);
      const items = parseCatalog(source.id, html, url)
        .slice(0, 48)
        .map((item) =>
          source.id === "firstpage"
            ? { ...item, ...splitFirstPageTitle(item.title) }
            : item,
        );
      const total = catalogTotal(source.id, html);
      if (
        !items.length &&
        total !== 0 &&
        !/ไม่พบสินค้า|ไม่พบข้อมูล|no results|no products|search found no/i.test(
          html,
        )
      )
        throw new Error("Title search markup unavailable.");
      return { items, complete: total !== null && total === items.length };
    }
    if (source.searchSeriesUrl)
      return await source.catalog(source.searchSeriesUrl(query));
    if (source.seriesDirectory?.fromPublisherDirectory) {
      const directory = await catalogs.getPublisherDirectory({
        url: source.seriesDirectory.url,
      });
      if (directory.stale || directory.error)
        throw new Error("Directory unavailable.");
      return { items: directory.titles || [], complete: true };
    }
    const directory = await catalogs.getSeriesCategories({
      publisherId: source.id,
    });
    if (directory.stale || directory.error)
      throw new Error("Directory unavailable.");
    return {
      items: directory.categories.map((category) => ({
        title: category.title,
        series: category.title,
        url: category.url,
        type: category.type || "",
        publisher: describe(source).name,
      })),
      complete: true,
    };
  }

  async function searchExternalTitles(
    request: unknown,
  ): Promise<ExternalSearch> {
    const query = queryFrom(request);
    const sourceId = (request as { sourceId?: unknown })?.sourceId;
    const source = providers(query).find(
      (provider) => provider.id === sourceId,
    );
    if (!source) throw new AppError("Choose an applicable search source.");
    const descriptor = describe(source);
    const key =
      "search-titles:v1:" +
      source.id +
      ":" +
      digest(query.toLocaleLowerCase("en"));
    const cached = await store.cache.get(key);
    let previous;
    try {
      previous = cached ? JSON.parse(cached) : null;
      if (
        !Array.isArray(previous?.items) ||
        !["complete", "partial"].includes(previous?.status)
      )
        previous = null;
    } catch {
      /* Rebuild corrupt cache. */
    }
    if (
      previous &&
      Date.now() - Date.parse(previous.checkedAt) < SCRAPE_TTL.catalog * 1000
    )
      return {
        source: descriptor,
        results: mergeSearchResults(query, [], previous.items),
        status: previous.status,
      };
    try {
      const loaded = await context.scrapeCache.get(
        "universal-search:v1:" + source.id + ":" + query,
        { maxAge: SCRAPE_TTL.catalog },
        async () => {
          const isbn = canonicalIsbn(query);
          if (!isbn) return await loadTitles(source, query);
          const book = await source.lookupIsbn(isbn);
          return {
            items: book ? [{ ...book, isbn: book.isbn || isbn }] : [],
            complete: true,
          };
        },
      );
      const items = loaded.items.flatMap((book) => {
        const item = titleResult(book, descriptor, false);
        // A source may not inject a link to another host into search results.
        return item &&
          ((!book.url && !book.publisherUrl) || publicUrl(item.url, source.id))
          ? [item]
          : [];
      });
      const results = mergeSearchResults(query, [], items);
      const status = loaded.complete ? "complete" : "partial";
      await store.cache.put(
        key,
        JSON.stringify({
          sourceId: source.id,
          items: results,
          status,
          checkedAt: new Date().toISOString(),
        }),
        SCRAPE_TTL.retention,
      );
      return { source: descriptor, results, status };
    } catch {
      return {
        source: descriptor,
        results: mergeSearchResults(query, [], previous?.items || []),
        status: "unavailable",
      };
    }
  }
  return { searchKnownEntities, searchExternalTitles };
}
