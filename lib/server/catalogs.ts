import {
  PUBLISHERS,
  normalizeIsbn,
  canonicalIsbn,
  digest,
  seriesCatalogRequest,
  matchSeriesCategory,
  seriesCategoryTitle,
  catalogSeriesKey,
  releaseItem,
  textHtml,
  meta,
  publisherCatalogSource,
  safeCoverUrl,
  originalCoverUrl,
  volumeCoverKey,
  safePublisherTitleUrl,
  safeProductUrl,
  safePublisherUrl,
  publisherKey,
  specialSet,
  parsePageCount,
} from "../domain.ts";
import { publisherCovers } from "./publisher-covers.ts";
import { bookSourceApplies } from "../domain/book-sources.ts";
import { searchLanguage } from "../domain/search.ts";
import { bookEditionKey } from "../domain/book-type.ts";
import { money } from "../domain/msrp.ts";
import { coverPreference } from "../domain/cover-preference.ts";
import { fillScrapedMetadata } from "../domain/scraped-metadata.ts";
import { AppError } from "./store.ts";
import { SCRAPE_TTL } from "./scrape-cache.ts";
import { createScraperContext } from "./scrapers/http.ts";
import {
  createScraperRegistry,
  SCRAPER_SOURCES,
  supportsIsbn,
} from "./scrapers/registry.ts";
import {
  cachedJson as cachedJson_,
  cacheJson as cacheJson_,
} from "./scrapers/cache.ts";
import type { ScraperDefinition } from "./scrapers/types.ts";
import {
  normalizeBookType,
  normalizeRecordTypes,
} from "../domain/book-type.ts";
type CatalogRequest = {
  row?: number;
  publisherUrl?: string;
  url?: string;
  refresh?: boolean;
  publisherId?: string;
  type?: string;
  categories?: { title: string; url: string; type?: string }[];
  series?: string;
};

export type BookLookupRequest = {
  series: string;
  volume: number | string;
  publisher?: string;
  publisherId?: string;
  type?: string;
  edition?: string;
  isbn?: string;
  refresh?: boolean;
};

export async function knownBookCoverUrl(store, book) {
  const isbn = canonicalIsbn(book.isbn);
  const volume = volumeCoverKey(book);
  return (
    book.coverUrl ||
    (isbn && (await store.cache.get("cover:isbn:v1:" + isbn))) ||
    (volume && (await store.cache.get(volume))) ||
    ""
  );
}

// Catalog caches are durable; failed refreshes keep the previous successful result.
export const CATALOG_REUSE = Symbol("catalog-cache-reuse");
export const CATALOG_CRAWLER = Symbol("catalog-crawler");
export const CATALOG_MSRP = Symbol("catalog-cached-msrp");
export function createCatalogService(
  store,
  fetchImpl = globalThis.fetch,
  sources: readonly ScraperDefinition[] = SCRAPER_SOURCES,
) {
  const cache = store.cache;
  const context = createScraperContext(cache, fetchImpl, sources);
  const { fetchText: fetchText_ } = context;
  const scrapers = createScraperRegistry(
    context,
    sources,
    store.ingestScrapedMetadata,
  );
  const pendingCovers = new Map();
  const pendingTitles = new Map();
  async function reparseBook(book) {
    const source = scrapers.get(
      book.publisherId || publisherKey(book.publisher),
    );
    return source?.reparseBook ? await source.reparseBook(book) : book;
  }
  function explicitMsrp(book) {
    if (!book || book.special || book.bundle) return null;
    const msrp = money(book.msrp);
    const msrpCurrency = String(book.msrpCurrency || book.currency || "")
      .trim()
      .toUpperCase();
    return msrp !== "" && (!msrpCurrency || /^[A-Z]{3}$/.test(msrpCurrency))
      ? { msrp, msrpCurrency }
      : null;
  }
  // Read only verified local snapshots. A richer source may have been discovered
  // after the permanent aggregate was saved, including through covers or a crawl.
  async function cachedMsrp(isbn: string, aggregate?) {
    const canonical = canonicalIsbn(isbn);
    if (!canonical) return null;
    aggregate ??= await cachedJson_(cache, "isbn:v15:" + canonical);
    if (
      aggregate?.found &&
      canonicalIsbn(aggregate.isbn) === canonical &&
      aggregate.details &&
      (!aggregate.details.isbn ||
        canonicalIsbn(aggregate.details.isbn) === canonical)
    ) {
      const price = explicitMsrp(await reparseBook(aggregate.details));
      if (price) return price;
    }
    const encountered = await cachedJson_(
      cache,
      "book-metadata:v1:" + canonical,
    );
    if (encountered?.isbn === canonical && encountered.isbnVerified === true) {
      const price = explicitMsrp(encountered);
      if (price) return price;
    }
    const providers = new Set([
      ...scrapers.isbnProviders,
      ...scrapers.isbnSearchProviders,
    ]);
    const keys = [...providers]
      .filter((source) => supportsIsbn(source, canonical))
      .flatMap((source) =>
        ["source-book", "source-search"].map(
          (kind) =>
            "scrape:v1:" + digest(`${kind}:v1:${source.id}:${canonical}`),
        ),
      );
    const values = cache.getMany ? await cache.getMany(keys) : null;
    const snapshots = values
      ? { ...cache, get: (key) => values.get(key) ?? null }
      : cache;
    for (const source of providers) {
      if (!supportsIsbn(source, canonical)) continue;
      for (const kind of ["source-book", "source-search"]) {
        const key = `${kind}:v1:${source.id}:${canonical}`;
        const snapshot = await cachedJson_(
          snapshots,
          "scrape:v1:" + digest(key),
        );
        if (snapshot?.source !== key) continue;
        const books =
          kind === "source-book" ? [snapshot.value] : snapshot.value?.items;
        if (!Array.isArray(books)) continue;
        for (const book of books) {
          if (canonicalIsbn(book?.isbn) !== canonical) continue;
          try {
            const url = new URL(book.url);
            if (
              url.protocol !== "https:" ||
              !source.hosts.includes(url.hostname) ||
              url.username ||
              url.password ||
              url.port
            )
              continue;
            const parsed = source.reparseBook
              ? await source.reparseBook(book)
              : book;
            const price = explicitMsrp(parsed);
            if (price) return price;
          } catch {
            // Malformed old snapshots cannot block another verified source.
          }
        }
      }
    }
    return null;
  }
  async function rememberCovers(items) {
    const remember = async (key, cover) => {
      const previous = await cache.get(key);
      if (
        previous &&
        coverPreference({ coverUrl: previous }) <
          coverPreference({ coverUrl: cover })
      )
        return;
      await cache.put(key, cover, 2592000);
    };
    await scrapers.rememberBooks(items);
    for (const item of items) {
      const verifiedIsbn = canonicalIsbn(item.isbn);
      if (
        item.isbnVerified &&
        verifiedIsbn &&
        safeProductUrl(item.url, item.publisherId) &&
        !item.bundle &&
        !item.special
      ) {
        const url = new URL(item.url).href;
        await cache.put("known-product:v1:" + url, verifiedIsbn, Infinity);
        await context.scrapeCache.pin("text:" + url);
      }
      const cover = safeCoverUrl(item.coverUrl);
      if (!cover || item.bundle || item.special) continue;
      const isbn = canonicalIsbn(item.isbn),
        key = volumeCoverKey(item);
      if (isbn) await remember("cover:isbn:v1:" + isbn, cover);
      if (key && !item.catalogVariant) await remember(key, cover);
    }
  }
  const savedSeriesCatalog_ = async (spec) =>
    await store.savedSeriesCatalog(spec);
  // Re-read saved cache titles so parser fixes also apply before a refresh or outage.
  async function reparseItems(result) {
    if (!result) return null;
    const reparsed = {
      ...result,
      items: result.items
        .filter((item) => !specialSet(item.title))
        .map((item) => ({
          ...item,
          ...releaseItem(
            item.publisherId,
            item.title,
            item.url,
            item.price,
            item.isbn,
            item.type,
          ),
          ...(scrapers.get(item.publisherId)?.preserveParsedSeries
            ? { series: item.series }
            : {}),
          ...(item.publisherId === "yaakz"
            ? { publisher: item.publisher }
            : {}),
          availability: item.availability,
          coverUrl: originalCoverUrl(item.coverUrl),
          ...(item.publisherId === "lilyhouse" && item.variantGroup
            ? { special: true, isbn: "", volume: "" }
            : {}),
        })),
    };
    await rememberCovers(reparsed.items);
    return reparsed;
  }
  async function annotateSeriesItems(catalog, spec, category) {
    catalog.items.forEach((item) => {
      item.catalogSeries = spec.series;
      item.catalogVariant =
        catalogSeriesKey(item.series) !==
          catalogSeriesKey(seriesCategoryTitle(category.title)) &&
        catalogSeriesKey(item.series) !== catalogSeriesKey(spec.series);
    });
    await rememberCovers(catalog.items);
    return catalog;
  }
  async function lookupIsbn(raw) {
    const refresh = typeof raw === "object" && raw?.refresh === true;
    const isbn = normalizeIsbn(typeof raw === "object" ? raw?.isbn : raw);
    if (!isbn) throw new Error("Enter or scan an ISBN first.");
    const canonical = canonicalIsbn(isbn);

    let cachedResult = await cachedJson_(cache, "isbn:v15:" + canonical);
    const encountered = await cachedJson_(
      cache,
      "book-metadata:v1:" + canonical,
    );
    if (
      cachedResult?.found &&
      encountered?.isbn === canonical &&
      encountered.isbnVerified === true
    ) {
      cachedResult = {
        ...cachedResult,
        details: fillScrapedMetadata(cachedResult.details, encountered),
      };
    }
    if (cachedResult?.details) {
      cachedResult.details = await reparseBook(cachedResult.details);
      if (
        cachedResult.details.msrp === "" ||
        cachedResult.details.msrp == null
      ) {
        const price = await cachedMsrp(canonical, cachedResult);
        if (price) Object.assign(cachedResult.details, price);
      }
    }
    if (cachedResult && !refresh) {
      if (cachedResult.found)
        await store.ingestScrapedMetadata?.([
          { ...cachedResult.details, isbn: canonical, isbnVerified: true },
        ]);
      return cachedResult;
    }
    const providers = scrapers.isbnProviders.filter((source) =>
      supportsIsbn(source, canonical),
    );
    // Start independent sources together, then keep the existing source preference
    // and warnings regardless of the order in which requests finish.
    const results = await Promise.allSettled(
      providers.map((provider) => provider.lookupIsbn(canonical, refresh)),
    );
    const warnings = [];
    let details = null;
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected")
        warnings.push(
          providers[index].isbnWarning ||
            providers[index].id + " is unavailable right now.",
        );
      else if (result.value) {
        details = result.value;
        if ("publisherId" in details) await rememberCovers([details]);
        break;
      }
    }
    if (details) {
      // Every lookup verifies this ISBN. Fill only the missing page count while
      // retaining the preferred source's title, edition and other metadata.
      const pageCount =
        results
          .filter((result) => result.status === "fulfilled" && result.value)
          .map((result) => {
            if (result.status !== "fulfilled") return "";
            const book = result.value;
            if (book.isbn && canonicalIsbn(book.isbn) !== canonical) return "";
            return parsePageCount(book.pageCount);
          })
          .find((count) => count !== "") ?? "";
      const msrpSource = results
        .flatMap((result) =>
          result.status === "fulfilled" && result.value ? [result.value] : [],
        )
        .find(
          (book) =>
            (!book.isbn || canonicalIsbn(book.isbn) === canonical) &&
            book.msrp !== "" &&
            book.msrp != null,
        );
      details = {
        ...details,
        pageCount,
        msrp: msrpSource?.msrp ?? "",
        msrpCurrency: msrpSource?.msrpCurrency || msrpSource?.currency || "",
      };
    }
    if (!details && warnings.length && cachedResult && refresh)
      return { ...cachedResult, stale: true, warnings };
    const result = {
      isbn: isbn,
      found: !!details,
      details: details,
      warnings: warnings,
      stale: false,
      checkedAt: details?.checkedAt ?? new Date().toISOString(),
      searchUrl:
        "https://www.naiin.com/search-result?title=" +
        encodeURIComponent(canonical),
    };
    // Cache confirmed misses too; transient provider failures get a shorter TTL.
    await cache.put(
      "isbn:v15:" + canonical,
      JSON.stringify(result),
      details && !warnings.length
        ? Infinity
        : warnings.length
          ? SCRAPE_TTL.retry
          : SCRAPE_TTL.isbn,
    );
    return result;
  }

  async function lookupBook(request: BookLookupRequest) {
    const series =
      typeof request?.series === "string" ? request.series.trim() : "";
    if (
      !series ||
      series.length > 500 ||
      [
        request.publisher,
        request.publisherId,
        request.type,
        request.edition,
        request.isbn,
      ].some(
        (value) =>
          value != null && (typeof value !== "string" || value.length > 500),
      ) ||
      (request.volume !== "" &&
        (!/^\d+(?:\.\d+)?$/.test(String(request.volume)) ||
          !Number.isFinite(Number(request.volume))))
    )
      throw new AppError(
        "Enter a series name and, if provided, a non-negative volume number.",
      );
    const publisherId = request.publisherId || publisherKey(request.publisher);
    if (request.publisherId && !scrapers.get(request.publisherId))
      throw new AppError("Choose a supported publisher.");
    if (
      /special|limited|collector|deluxe|ultimate|box\s*set|ฉบับพิเศษ|ปกพิเศษ|เซต|เซ็ต|ชุด/i.test(
        request.edition || "",
      )
    )
      return {
        found: false,
        details: null,
        isbn: "",
        needsSelection: true,
        warnings: [],
        checkedAt: "",
        categoryUrl: "",
      };
    const type = request.type ? normalizeBookType(request.type) : "";
    const titleLanguage = searchLanguage(series);
    const language =
      /\((TH|EN|JP)\)/i
        .exec(request.edition || request.type || "")?.[1]
        ?.toUpperCase() ||
      (!publisherId ? { th: "TH", en: "EN", ja: "JP" }[titleLanguage] : "");
    // Explicit edition/publisher choices take precedence over a translated or
    // romanized shelf name. Otherwise use its script to avoid unrelated editions.
    const edition = language ? `(${language})` : request.edition;
    const spec = { ...request, series, type, publisherId, edition };
    const eligible = scrapers.titleProviders.filter(
      (source) =>
        bookSourceApplies(source.id, spec) &&
        source.titleLanguages.includes(titleLanguage),
    );
    // Cache the entire series, not the volume query. Siblings (including imports)
    // reuse one matched category/listing and never repeat a full-store search.
    // These keys are account-scoped because explicit shelf aliases are private.
    const key =
      "book-discovery:v2:" +
      digest(
        JSON.stringify([
          catalogSeriesKey(series),
          publisherId,
          type,
          request.edition || "",
          eligible.map((source) => source.id),
        ]),
      );
    let catalog = await cachedJson_(cache, key);
    if (!Array.isArray(catalog?.items) || !Array.isArray(catalog?.warnings))
      catalog = null;
    if (
      !catalog ||
      request.refresh ||
      Date.now() - Date.parse(catalog.checkedAt) >=
        (catalog.warnings.length ? SCRAPE_TTL.retry : SCRAPE_TTL.catalog) * 1000
    ) {
      const warnings: string[] = [];
      const candidates = eligible
        .filter((source) => !publisherId || source.id === publisherId)
        .sort(
          (a, b) =>
            Number(
              !a.seriesDirectory ||
                a.seriesDirectory.manual ||
                !!a.searchSeriesUrl,
            ) -
              Number(
                !b.seriesDirectory ||
                  b.seriesDirectory.manual ||
                  !!b.searchSeriesUrl,
              ) || (a.isbnPriority ?? Infinity) - (b.isbnPriority ?? Infinity),
        );
      let selected = null;
      for (const source of candidates) {
        try {
          let result;
          if (
            source.catalog &&
            (source.seriesDirectory || source.searchSeriesUrl)
          ) {
            result = await getSeriesCatalog({
              series,
              type,
              publisherId: source.id,
              refresh: request.refresh,
            });
            if (result.stale) throw new Error("Catalog unavailable");
            if (
              !type &&
              result.needsSelection &&
              result.categories?.filter(
                (category) =>
                  catalogSeriesKey(seriesCategoryTitle(category.title)) ===
                  catalogSeriesKey(series),
              ).length > 1
            ) {
              selected = { ...result, publisherId: source.id, ambiguous: true };
              break;
            }
          } else if (source.searchTitles) {
            result = await context.scrapeCache.get(
              "discovery-titles:v2:" +
                source.id +
                ":" +
                catalogSeriesKey(series),
              { maxAge: SCRAPE_TTL.catalog, refresh: request.refresh },
              () => source.searchTitles(series),
            );
          } else continue;
          const items = result.items.filter(
            (item) =>
              !item.catalogVariant &&
              (catalogSeriesKey(item.series) === catalogSeriesKey(series) ||
                (item.catalogSeries === series && result.url)) &&
              (!type || !item.type || normalizeBookType(item.type) === type) &&
              bookSourceApplies(source.id, {
                ...item,
                edition: edition || item.edition,
              }),
          );
          if (!items.length) continue;
          selected = { ...result, items, publisherId: source.id };
          break;
        } catch {
          warnings.push(
            (PUBLISHERS.find((p) => p.id === source.id)?.name || source.id) +
              " is unavailable right now.",
          );
        }
      }
      const fallback =
        !selected && catalog?.items?.length && warnings.length > 0;
      catalog = {
        items: [],
        ...(!selected && catalog?.items?.length ? catalog : {}),
        ...selected,
        warnings,
        stale: !!fallback,
        checkedAt: fallback ? catalog.checkedAt : new Date().toISOString(),
      };
      await cacheJson_(cache, key, catalog);
    }
    const matchesVolume = (item) =>
      !item.special &&
      !item.bundle &&
      !item.variantGroup &&
      (request.volume === ""
        ? item.volume === "" || item.volume == null
        : item.volume !== "" &&
          item.volume != null &&
          Number(item.volume) === Number(request.volume)) &&
      (!type || !item.type || normalizeBookType(item.type) === type) &&
      (!language ||
        !/\((TH|EN|JP)\)/i.test(item.edition || item.type || "") ||
        /\((TH|EN|JP)\)/i
          .exec(item.edition || item.type)?.[1]
          ?.toUpperCase() === language) &&
      (!canonicalIsbn(request.isbn) ||
        !canonicalIsbn(item.isbn) ||
        canonicalIsbn(item.isbn) === canonicalIsbn(request.isbn));
    let matches = catalog.items.filter(matchesVolume);
    let selectedSource = scrapers.get(catalog.publisherId);
    const warnings = [...catalog.warnings];
    // A complete category describes current listings, not every published book.
    // Search only the missing volume at another store; siblings still use the
    // category and an empty category never becomes a claim of nonexistence.
    if (!matches.length && !catalog.ambiguous) {
      for (const source of eligible
        .filter(
          (source) => source.searchTitles && source.id !== catalog.publisherId,
        )
        .sort(
          (a, b) => (a.isbnPriority ?? Infinity) - (b.isbnPriority ?? Infinity),
        )) {
        try {
          const query =
            series + (request.volume === "" ? "" : " " + request.volume);
          const result = await context.scrapeCache.get(
            "discovery-volume:v2:" + source.id + ":" + query,
            { maxAge: SCRAPE_TTL.catalog, refresh: request.refresh },
            () => source.searchTitles(query),
          );
          const items = result.items.filter(
            (item) =>
              matchesVolume(item) &&
              catalogSeriesKey(item.series) === catalogSeriesKey(series) &&
              (!(publisherId || catalog.publisherId) ||
                !item.publisher ||
                publisherKey(item.publisher) ===
                  (publisherId || catalog.publisherId)),
          );
          if (items.length) {
            matches = items;
            selectedSource = source;
            break;
          }
        } catch {
          warnings.push(source.id + " is unavailable right now.");
        }
      }
    }
    const identities = new Set(
      matches.map((item) =>
        JSON.stringify([
          canonicalIsbn(item.isbn) || item.url,
          bookEditionKey(item),
        ]),
      ),
    );
    let details = identities.size === 1 ? matches[0] : null;
    if (details) {
      const source = selectedSource;
      if (source?.bookDetails) {
        try {
          const product = await source.bookDetails(
            details.url,
            request.refresh,
          );
          if (product) {
            if (
              !matchesVolume(product) ||
              catalogSeriesKey(product.series) !==
                catalogSeriesKey(details.series) ||
              (product.publisher &&
                details.publisher &&
                publisherKey(product.publisher) !==
                  publisherKey(details.publisher))
            )
              details = null;
            else
              details = {
                ...details,
                ...product,
                type: product.type || details.type,
                isbnVerified:
                  product.isbnVerified === true &&
                  !!canonicalIsbn(product.isbn),
              };
          }
        } catch {
          warnings.push("Could not verify this volume’s product details.");
        }
      }
      if (details && source)
        details = {
          ...details,
          source:
            source.priceSource?.name || details.source || details.publisher,
        };
      if (details) await rememberCovers([details]);
    }
    return {
      found: !!details,
      details,
      needsSelection: !!catalog.ambiguous || identities.size > 1,
      isbn: details?.isbnVerified
        ? canonicalIsbn(details.isbn)
        : canonicalIsbn(request.isbn),
      warnings,
      checkedAt: catalog.checkedAt,
      categoryUrl: catalog.url || "",
      stale: !!catalog.stale,
    };
  }

  async function getBookCover(request) {
    const row = request?.row;
    if (!Number.isSafeInteger(row)) throw new Error("Choose a library volume.");
    const collection = await store.api.getCollection();
    const book =
      collection.books.find((b) => b.row === row) ||
      collection.trash.find((entry) => entry.book.row === row)?.book;
    if (!book) throw new Error("This volume is no longer in your library.");
    if (book.coverId)
      return {
        row,
        token: book.token,
        coverId: book.coverId,
        coverUrl: book.coverUrl,
      };
    if (book.coverUrl)
      return { row, token: book.token, coverUrl: book.coverUrl };
    const isbn = canonicalIsbn(book.isbn),
      volumeKey = volumeCoverKey(book);
    const key = isbn ? "cover:isbn:v1:" + isbn : volumeKey;
    const cached =
      (isbn && (await cache.get(key))) ||
      (volumeKey && (await cache.get(volumeKey)));
    if (
      cached &&
      (request.lookup === false || coverPreference({ coverUrl: cached }) === 0)
    )
      return { row, token: book.token, coverUrl: safeCoverUrl(cached) };
    if (request.lookup === false)
      return { row, token: book.token, coverUrl: "" };
    if (!isbn && scrapers.get(publisherKey(book.publisher))?.coverFromSeries) {
      const catalog = await getSeriesCatalog({
        series: book.series,
        type: book.type,
        publisherId: publisherKey(book.publisher),
      });
      const match = catalog.items.find(
        (item) =>
          !item.bundle &&
          !item.special &&
          !item.catalogVariant &&
          Number(item.volume) === Number(book.volume) &&
          item.volume !== "" &&
          normalizeBookType(item.type) === normalizeBookType(book.type),
      );
      return { row, token: book.token, coverUrl: match?.coverUrl || "" };
    }
    if (!isbn) {
      if (
        book.volume === "" ||
        !book.series ||
        !collection.books.some((item) => item.row === row)
      )
        return { row, token: book.token, coverUrl: "" };
      const options = await getBookCoverOptions({
        row,
        refresh: request.refresh,
      });
      const coverUrl = options.covers[0]?.coverUrl || "";
      if (volumeKey && coverUrl) await cache.put(volumeKey, coverUrl, 2592000);
      return { row, token: book.token, coverUrl };
    }
    if (await cache.get("cover:miss:v9:" + isbn))
      return { row, token: book.token, coverUrl: "" };
    if (!pendingCovers.has(isbn)) {
      const pending = lookupIsbn(isbn)
        .then(async (result) => {
          const cover = safeCoverUrl(result.details?.coverUrl);
          if (cover) await cache.put(key, cover, 2592000);
          else if (!result.warnings.length)
            await cache.put("cover:miss:v9:" + isbn, "1", 86400);
          return cover;
        })
        .finally(() => pendingCovers.delete(isbn));
      pendingCovers.set(isbn, pending);
    }
    return { row, token: book.token, coverUrl: await pendingCovers.get(isbn) };
  }

  async function getBookCoverOptions(request: CatalogRequest = {}) {
    const book = (await store.api.getCollection()).books.find(
      (b) => b.row === request.row,
    );
    if (!book) throw new Error("Choose a library volume.");
    const publisherId = publisherKey(book.publisher);
    const supportedPublisher = !!scrapers.get(publisherId)?.catalog;
    const explicit = request.publisherUrl ?? book.publisherUrl;
    if (explicit && !safePublisherUrl(explicit, publisherId))
      throw new Error("Use an HTTPS link on this publisher’s website.");
    const productUrl =
      explicit &&
      (safeProductUrl(explicit, publisherId) ||
        (/^https:\/\/www\.naiin\.com\/product\/detail\/\d+\/?$/.test(explicit)
          ? explicit
          : ""));
    if (explicit && !productUrl && supportedPublisher)
      throw new Error(
        "Enter this volume’s publisher product page to pull its gallery.",
      );
    const catalog = supportedPublisher
      ? await getSeriesCatalog({
          series: book.series,
          type: book.type,
          publisherId,
          refresh: request.refresh,
        })
      : { items: [] };
    const matchingType = normalizeBookType;
    // Revised editions can supply alternate covers without changing the saved series.
    const coverSeriesKey = (title) =>
      catalogSeriesKey(
        String(title || "").replace(/\s*\(ฉบับปรับปรุงใหม่\)\s*$/, ""),
      );
    const candidates = catalog.items.filter(
      (item) =>
        !item.bundle &&
        (!item.catalogVariant ||
          [book.series, catalog.title].some(
            (title) =>
              title && coverSeriesKey(item.series) === coverSeriesKey(title),
          )) &&
        !specialSet(item.title) &&
        ((canonicalIsbn(book.isbn) &&
          canonicalIsbn(item.isbn) === canonicalIsbn(book.isbn)) ||
          (book.volume !== "" &&
            item.volume !== "" &&
            Number(item.volume) === Number(book.volume) &&
            (!item.type ||
              matchingType(item.type) === matchingType(book.type)))),
    );
    if (productUrl && !candidates.some((item) => item.url === productUrl))
      candidates.unshift({ url: productUrl, title: book.series, coverUrl: "" });
    const covers = new Map(),
      warnings = [];
    const add = (coverUrl, item) => {
      coverUrl = originalCoverUrl(coverUrl);
      if (coverUrl && !covers.has(coverUrl))
        covers.set(coverUrl, {
          coverUrl,
          publisherUrl: item.url,
          title: item.title,
          source:
            item.source ||
            PUBLISHERS.find((p) => p.id === publisherId)?.name ||
            book.publisher,
          sourceUrl: item.sourceUrl || item.url,
        });
    };
    // Fetch a few product pages at a time so alternate editions remain selectable.
    for (let start = 0; start < candidates.length; start += 3) {
      const batch = await Promise.all(
        candidates.slice(start, start + 3).map(async (item) => {
          try {
            const scraper = scrapers.get(publisherId);
            if (scraper?.gallery) {
              const options = await scraper.gallery(
                item,
                { ...book, type: book.edition || book.type },
                request.refresh,
              );
              return {
                options: options.map((option) => ({
                  coverUrl: option.coverUrl,
                  item: { ...item, ...option },
                })),
                warning: "",
              };
            }
            const html = await fetchText_(
              item.url,
              request.refresh,
              SCRAPE_TTL.product,
            );
            // Product details reuse the HTML just fetched for this gallery.
            // Do not throw away pages/MSRP simply because covers were requested.
            if (scraper?.bookDetails) {
              try {
                await scraper.bookDetails(item.url);
              } catch {
                // Gallery-only markup can still provide usable cover choices.
              }
            }
            const title = textHtml(
              /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ||
                meta(html, "og:title") ||
                /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ||
                "",
            );
            if (specialSet(title)) return { options: [], warning: "" };
            const gallery = await publisherCovers(html, item.url);
            return {
              options: (gallery.length ? gallery : [item.coverUrl]).map(
                (coverUrl) => ({ coverUrl, item }),
              ),
              warning: "",
            };
          } catch {
            return {
              options: [{ coverUrl: item.coverUrl, item }],
              warning: "Could not read the gallery for " + item.title + ".",
            };
          }
        }),
      );
      // Keep results stable across workers, cached reads and network timings.
      for (const result of batch) {
        for (const option of result.options) add(option.coverUrl, option.item);
        if (result.warning) warnings.push(result.warning);
      }
    }
    if (catalog.error) warnings.push(catalog.error);
    const isbn = canonicalIsbn(book.isbn);
    for (const source of scrapers.coverProviders) {
      if (
        !bookSourceApplies(source.id, book) ||
        (isbn && !supportsIsbn(source, isbn))
      )
        continue;
      try {
        for (const item of await source.coverOptions(book, request.refresh))
          await add(item.coverUrl, item);
      } catch {
        warnings.push(
          source.coverWarning ||
            "Could not check " + source.id + " for this volume.",
        );
      }
    }
    // Automatic covers keep their URL in cover_sources, not books.cover_url.
    // A failed/empty rediscovery must not hide a cover we already have offline.
    const currentUrl = safeCoverUrl(
      book.coverUrl ||
        (book.coverId
          ? await store.covers.source(book.coverId)
          : await knownBookCoverUrl(store, book)),
    );
    if (currentUrl && originalCoverUrl(currentUrl) !== currentUrl)
      add(originalCoverUrl(currentUrl), {
        url: book.publisherUrl || "",
        title: book.series,
        source: new URL(currentUrl).hostname,
        sourceUrl: currentUrl,
      });
    if (book.coverId) {
      const key = currentUrl || book.coverId;
      covers.set(key, {
        ...(covers.get(key) || {
          coverUrl: currentUrl,
          publisherUrl: book.publisherUrl || "",
          title: book.series,
          source: currentUrl ? new URL(currentUrl).hostname : "Stored cover",
          sourceUrl: currentUrl,
        }),
        coverId: book.coverId,
      });
    } else if (currentUrl && !covers.size) {
      add(currentUrl, {
        url: book.publisherUrl || "",
        title: book.series,
        source: new URL(currentUrl).hostname,
        sourceUrl: currentUrl,
      });
    }
    return {
      row: book.row,
      covers: [...covers.values()].sort(
        (a, b) => coverPreference(a) - coverPreference(b),
      ),
      warnings,
      publisherUrl: candidates[0]?.url || catalog.url || "",
    };
  }

  async function searchPublisherIsbn(request: {
    publisherId: string;
    isbn: string;
    refresh?: boolean;
  }) {
    const source = scrapers.get(request?.publisherId);
    if (!source?.searchIsbn) {
      const publishers = scrapers.isbnSearchProviders.map(
        (provider) =>
          PUBLISHERS.find((publisher) => publisher.id === provider.id)?.name ||
          provider.id,
      );
      throw new Error(
        publishers.length
          ? "Choose " +
              new Intl.ListFormat("en", { type: "disjunction" }).format(
                publishers,
              ) +
              " for ISBN search."
          : "No publisher supports ISBN search.",
      );
    }
    const isbn = canonicalIsbn(normalizeIsbn(request.isbn));
    if (!isbn) throw new Error("Enter a valid ISBN first.");
    const result = await source.searchIsbn(isbn, request.refresh);
    await rememberCovers(result.items);
    return result;
  }

  async function getPublisherCatalog(request: CatalogRequest = {}) {
    const source = publisherCatalogSource(
      request.url || "https://www.phoenixnext.com/gl.html",
    );
    const scraper = scrapers.require(source.publisherId);
    if (!scraper.catalog)
      throw new Error("This source does not support catalogs.");
    const key = "publisher-catalog:v1:" + digest(source.url);
    const previous = await reparseItems(await cachedJson_(cache, key));
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < SCRAPE_TTL.catalog * 1000
    )
      return previous;
    try {
      const catalog = await scraper.catalog(source.url, request.refresh);
      if (previous?.complete && !catalog.complete)
        throw new Error("Incomplete refresh");
      await rememberCovers(catalog.items);
      const result = {
        ...catalog,
        items: catalog.items.filter((item) => !specialSet(item.title)),
        ...source,
        checkedAt: new Date().toISOString(),
        stale: false,
        error: catalog.complete
          ? ""
          : "Some category pages could not be checked. These results may be missing titles.",
      };
      await cacheJson_(cache, key, result);
      return result;
    } catch {
      if (previous)
        return {
          ...previous,
          stale: true,
          error:
            "Could not refresh this publisher category. Showing the previous check.",
        };
      return {
        ...source,
        items: [],
        complete: false,
        checkedAt: "",
        stale: true,
        error:
          "Could not read this publisher category. Try refreshing or open the publisher website.",
      };
    }
  }

  async function getPublisherDirectory(request: CatalogRequest = {}) {
    const source = publisherCatalogSource(
      request.url || "https://www.phoenixnext.com/gl.html",
    );
    const scraper = scrapers.require(source.publisherId);
    if (!scraper.directory || scraper.directoryAsCatalog?.(source.url))
      return await getPublisherCatalog({ ...request, url: source.url });
    const key = "publisher-directory:v1:" + digest(source.url),
      previous = await cachedJson_(cache, key);
    if (scraper.normalizeDirectory && previous?.titles)
      previous.titles = scraper.normalizeDirectory(previous.titles);
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < SCRAPE_TTL.directory * 1000
    )
      return previous;
    try {
      const { titles, title } = await scraper.directory(
        source.url,
        request.refresh,
      );
      const result = {
        ...source,
        titles,
        items: [],
        checkedAt: new Date().toISOString(),
        stale: false,
        title,
        error: "",
      };
      await cacheJson_(cache, key, result);
      return result;
    } catch {
      if (previous)
        return {
          ...previous,
          stale: true,
          error:
            "Could not refresh the title directory. Showing the previous check.",
        };
      return {
        ...source,
        titles: [],
        items: [],
        checkedAt: "",
        stale: true,
        error:
          "Could not read the publisher’s title directory. Try refreshing or open the publisher website.",
      };
    }
  }

  async function getPublisherTitle(request: CatalogRequest = {}) {
    const id = request.publisherId;
    const categories = request.categories;
    const series =
      typeof request.series === "string"
        ? request.series.trim().slice(0, 500)
        : "";
    if (
      !Array.isArray(categories) ||
      !categories.length ||
      categories.length > 4 ||
      categories.some((category) => !safePublisherTitleUrl(category.url, id))
    )
      throw new Error("Choose a publisher title category.");
    const key = digest(
      JSON.stringify(categories.map((category) => category.url).sort()) +
        !!request.refresh +
        series,
    );
    if (!pendingTitles.has(key)) {
      const pending = (async () => {
        const catalogs = await Promise.all(
          categories.map(
            async (category) =>
              await getPublisherCatalog({
                url: category.url,
                refresh: request.refresh,
              }),
          ),
        );
        const items = catalogs.flatMap((catalog, index) =>
          catalog.items.map((item) => ({
            ...item,
            type: item.type || categories[index].type || "",
          })),
        );
        const rank = (item) =>
          item.bundle
            ? 5
            : Number(item.volume) === 1
              ? item.special
                ? 1
                : 0
              : item.special
                ? 4
                : 2;
        items.sort(
          (a, b) =>
            rank(a) - rank(b) ||
            (a.volume === "" ? Infinity : Number(a.volume)) -
              (b.volume === "" ? Infinity : Number(b.volume)) ||
            Number(/\[แถม|\[ฟรี/.test(a.title)) -
              Number(/\[แถม|\[ฟรี/.test(b.title)),
        );
        const selected = items[0];
        const item = selected
          ? {
              ...selected,
              coverUrl:
                selected.coverUrl ||
                items.find(
                  (other) => other.volume === selected.volume && other.coverUrl,
                )?.coverUrl ||
                "",
            }
          : null;
        if (item && series)
          await rememberCovers([{ ...item, catalogSeries: series }]);
        return {
          item,
          checkedAt: catalogs[0].checkedAt,
          complete: catalogs.every((catalog) => catalog.complete),
          stale: catalogs.some((catalog) => catalog.stale),
          error: catalogs.find((catalog) => catalog.error)?.error || "",
        };
      })().finally(() => pendingTitles.delete(key));
      pendingTitles.set(key, pending);
    }
    return pendingTitles.get(key);
  }

  async function getPublisherReleases(request) {
    request = request || {};
    const publisher = PUBLISHERS.find(function (p) {
      return p.id === request.publisherId;
    });
    const scraper = scrapers.get(publisher?.id);
    if (!publisher || !scraper?.releases)
      throw new Error("Choose a supported publisher.");
    const key = "releases:v1:" + publisher.id;
    const cached = await cache.get(key),
      previous = await reparseItems(cached ? JSON.parse(cached) : null);
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < SCRAPE_TTL.releases * 1000
    )
      return previous;
    try {
      const scraped = await scraper.releases(request.refresh);
      if (!scraped.length) throw new Error("No book listings could be read.");
      const items = scraped.filter((item) => !specialSet(item.title));
      await rememberCovers(items);
      const result = {
        publisherId: publisher.id,
        items: items,
        checkedAt: new Date().toISOString(),
        stale: false,
        error: "",
      };
      const json = JSON.stringify(result);
      await cache.put(key, json, SCRAPE_TTL.retention);
      return result;
    } catch (e) {
      if (previous)
        return Object.assign({}, previous, {
          stale: true,
          error:
            "Could not refresh " +
            publisher.name +
            ". Showing the previous check.",
        });
      return {
        publisherId: publisher.id,
        items: [],
        checkedAt: "",
        stale: true,
        error:
          "Could not read " +
          publisher.name +
          " right now. Open the publisher website or try Refresh releases.",
      };
    }
  }

  async function getSeriesCatalog(request) {
    const spec = seriesCatalogRequest(request);
    const scraper = scrapers.require(spec.publisherId);
    if (!scraper.catalog)
      throw new Error("This source does not support series catalogs.");
    const saved = await savedSeriesCatalog_(spec),
      key =
        "series:v1:" +
        spec.publisherId +
        ":" +
        digest(
          spec.series + "\n" + spec.type + "\n" + (saved ? saved.url : ""),
        );
    const legacyTypes =
      spec.type === "Light novel"
        ? ["LN (TH)", "LN (EN)"]
        : spec.type === "Manga"
          ? ["Manga (TH)", "Manga (EN)", "Manga (JP)"]
          : ["Other"];
    const cached = await reparseItems(
      (await cachedJson_(cache, key)) ||
        (
          await Promise.all(
            legacyTypes.map(
              async (type) =>
                await cachedJson_(
                  cache,
                  "series:v1:" +
                    spec.publisherId +
                    ":" +
                    digest(
                      spec.series +
                        "\n" +
                        type +
                        "\n" +
                        (saved ? saved.url : ""),
                    ),
                ),
            ),
          )
        ).find(Boolean),
    );
    const previous = cached
      ? await annotateSeriesItems(cached, spec, cached)
      : null;
    if (
      previous &&
      !spec.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < SCRAPE_TTL.catalog * 1000
    )
      return previous;
    let category = saved;
    try {
      if (!category && !scraper.searchSeriesUrl) {
        const directory = await getSeriesCategories({
          publisherId: spec.publisherId,
          refresh: spec.refresh,
        });
        category = matchSeriesCategory(
          spec.series,
          directory.categories,
          spec.type,
        );
        if (!category)
          return {
            publisherId: spec.publisherId,
            series: spec.series,
            type: spec.type,
            items: [],
            checkedAt: "",
            complete: false,
            stale: false,
            needsSelection: true,
            categories: directory.categories,
            directoryUrl: directory.url,
            error: directory.error || "",
          };
      }
      if (!category)
        category = {
          title: spec.series,
          url: scraper.searchSeriesUrl(spec.series),
        };
      const catalog = await context.scrapeCache.get(
        "series-catalog:v1:" + spec.publisherId + ":" + category.url,
        { maxAge: SCRAPE_TTL.catalog, refresh: spec.refresh },
        () => scraper.catalog(category.url, spec.refresh),
      );
      if (
        scraper.preserveCompleteSeries &&
        previous?.complete &&
        !catalog.complete
      )
        throw new Error("Incomplete publisher series refresh.");
      if (catalog.title) category = { title: catalog.title, url: category.url };
      await annotateSeriesItems(catalog, spec, category);
      catalog.items = catalog.items.filter((item) => !specialSet(item.title));
      const result = Object.assign(catalog, {
        publisherId: spec.publisherId,
        series: spec.series,
        type: spec.type,
        title: category.title,
        url: category.url,
        checkedAt: new Date().toISOString(),
        stale: false,
        needsSelection: !!catalog.search && !catalog.items.length,
        error:
          catalog.search && !catalog.items.length
            ? "No books matched this search. Check the publisher’s series title."
            : catalog.complete
              ? ""
              : "This category check is incomplete. Open the publisher category to check the remaining books.",
      });
      await cacheJson_(cache, key, result);
      return result;
    } catch (error) {
      if (previous)
        return Object.assign({}, previous, {
          stale: true,
          error:
            "Could not refresh this series catalog. Showing the previous check.",
        });
      return {
        publisherId: spec.publisherId,
        series: spec.series,
        type: spec.type,
        items: [],
        title: category ? category.title : "",
        url: category ? category.url : "",
        checkedAt: "",
        complete: false,
        stale: true,
        needsSelection: false,
        error:
          "Could not check this series catalog. Try Refresh catalog or choose its category.",
      };
    }
  }

  async function getSeriesCategories(request) {
    const id = request && request.publisherId;
    const source = scrapers.get(id);
    const directorySource = source?.seriesDirectory;
    if (!directorySource)
      throw new Error("Choose a publisher that supports series categories.");
    if (directorySource.manual)
      return {
        publisherId: id,
        url: directorySource.url,
        categories: [],
        checkedAt: "",
        stale: false,
        error: "",
      };
    if (directorySource.fromPublisherDirectory) {
      const directory = await getPublisherDirectory({
        url: directorySource.url,
        refresh: request.refresh,
      });
      if (directory.stale && !directory.titles.length)
        throw new Error(directory.error);
      return {
        publisherId: id,
        url: directory.url,
        checkedAt: directory.checkedAt,
        stale: directory.stale,
        error: directory.error,
        categories: directory.titles.map((title) => ({
          title: title.series,
          url: title.url,
          type: title.type,
        })),
      };
    }
    const key = "series-directory:v1:" + id,
      previous = await cachedJson_(cache, key);
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < SCRAPE_TTL.directory * 1000
    )
      return previous;
    const url = directorySource.url;
    try {
      const categories = await directorySource.load(request.refresh);
      if (!categories.length) throw new Error("Category directory unavailable");
      const result = {
        publisherId: id,
        url: url,
        categories: categories,
        checkedAt: new Date().toISOString(),
        stale: false,
        error: "",
      };
      await cacheJson_(cache, key, result);
      return result;
    } catch (error) {
      if (previous)
        return Object.assign({}, previous, {
          stale: true,
          error:
            "Category directory could not refresh. Showing previously found categories.",
        });
      throw new Error(
        "Could not load this publisher’s series categories. Paste its series category URL or try again.",
      );
    }
  }

  const methods = {
    lookupBook,
    lookupIsbn,
    searchPublisherIsbn,
    getBookCover,
    getBookCoverOptions,
    getPublisherCatalog,
    getPublisherDirectory,
    getPublisherTitle,
    getPublisherReleases,
    getSeriesCatalog,
    getSeriesCategories,
  };
  const api = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      async (request) => {
        if (request && typeof request === "object" && request.refresh === true)
          store.requireAdmin?.();
        return normalizeRecordTypes(await method(request));
      },
    ]),
  ) as typeof methods;
  // Cache-only operations must not wait behind remote work or a paused queue.
  // This private symbol is not enumerable and can never become an RPC method.
  async function canReuse(name: string, request: any) {
    if (request?.refresh === true) return false;
    try {
      let key = "",
        maxAge = 0;
      if (name === "lookupIsbn") {
        const isbn = canonicalIsbn(
          typeof request === "string" ? request : request?.isbn,
        );
        return !!isbn && !!(await cache.get("isbn:v15:" + isbn));
      }
      if (name === "getPublisherReleases") {
        key = "releases:v1:" + request?.publisherId;
        maxAge = SCRAPE_TTL.releases;
      } else if (
        name === "getPublisherCatalog" ||
        name === "getPublisherDirectory"
      ) {
        const source = publisherCatalogSource(
          request?.url || "https://www.phoenixnext.com/gl.html",
        );
        const scraper = scrapers.require(source.publisherId);
        const directory =
          name === "getPublisherDirectory" &&
          scraper.directory &&
          !scraper.directoryAsCatalog?.(source.url);
        key =
          (directory ? "publisher-directory:v1:" : "publisher-catalog:v1:") +
          digest(source.url);
        maxAge = directory ? SCRAPE_TTL.directory : SCRAPE_TTL.catalog;
      } else if (name === "getSeriesCatalog") {
        const spec = seriesCatalogRequest(request);
        const saved = await savedSeriesCatalog_(spec);
        key =
          "series:v1:" +
          spec.publisherId +
          ":" +
          digest(spec.series + "\n" + spec.type + "\n" + (saved?.url || ""));
        maxAge = SCRAPE_TTL.catalog;
      }
      if (!key) return false;
      const cached = await cachedJson_(cache, key);
      return (
        !!cached && Date.now() - Date.parse(cached.checkedAt) < maxAge * 1000
      );
    } catch {
      return false;
    }
  }
  Object.defineProperty(api, CATALOG_CRAWLER, {
    value: {
      sources: PUBLISHERS.filter((p) => scrapers.get(p.id)?.releases).map(
        (p) => ({
          id: p.id,
          name: p.name,
          full:
            !!(
              scrapers.get(p.id)?.seriesDirectory &&
              !scrapers.get(p.id).seriesDirectory.manual
            ) || p.id === "lilyhouse",
        }),
      ),
      async warm(publisherId: string, item: { url: string; isbn: string }) {
        const source = scrapers.require(publisherId);
        const url = safeProductUrl(item.url, publisherId);
        if (!url) return;
        const requestedIsbn = canonicalIsbn(item.isbn);
        const details = source.bookDetails
          ? await source.bookDetails(url)
          : requestedIsbn && source.lookupIsbn
            ? await source.lookupIsbn(requestedIsbn)
            : null;
        const isbn = canonicalIsbn(details?.isbn);
        if (
          details &&
          isbn &&
          (requestedIsbn ? isbn === requestedIsbn : details.isbnVerified) &&
          safeProductUrl(details.url, publisherId)
        ) {
          // Exact publisher metadata is enough to answer the next scan locally.
          // Never overwrite a richer existing aggregate or include private aliases.
          if (!(await cache.get("isbn:v15:" + isbn)))
            await cache.put(
              "isbn:v15:" + isbn,
              JSON.stringify({
                isbn,
                found: true,
                details,
                warnings: [],
                stale: false,
                checkedAt: new Date().toISOString(),
              }),
              Infinity,
            );
        }
      },
    },
  });
  Object.defineProperty(api, CATALOG_MSRP, { value: cachedMsrp });
  return Object.defineProperty(api, CATALOG_REUSE, {
    value: canReuse,
  }) as typeof api & {
    [CATALOG_REUSE]: typeof canReuse;
    [CATALOG_MSRP]: typeof cachedMsrp;
    [CATALOG_CRAWLER]: {
      sources: { id: string; name: string; full: boolean }[];
      warm(
        publisherId: string,
        item: { url: string; isbn: string },
      ): Promise<void>;
    };
  };
}
