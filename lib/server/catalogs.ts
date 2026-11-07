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
export function createCatalogService(
  store,
  fetchImpl = globalThis.fetch,
  sources: readonly ScraperDefinition[] = SCRAPER_SOURCES,
) {
  const cache = store.cache;
  const context = createScraperContext(cache, fetchImpl, sources);
  const { fetchText: fetchText_ } = context;
  const scrapers = createScraperRegistry(context, sources);
  const pendingCovers = new Map();
  const pendingTitles = new Map();
  async function rememberCovers(items) {
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
      if (isbn) await cache.put("cover:isbn:v1:" + isbn, cover, 2592000);
      if (key && !item.catalogVariant) await cache.put(key, cover, 2592000);
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
          availability: item.availability,
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

    const cached = await cache.get("isbn:v15:" + canonical);
    if (cached && !refresh) return JSON.parse(cached);
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
    if (!details && warnings.length && cached && refresh)
      return { ...JSON.parse(cached), stale: true, warnings };
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
    if (cached)
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
    if (!isbn || (await cache.get("cover:miss:v9:" + isbn)))
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
      coverUrl = safeCoverUrl(coverUrl);
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
    for (let start = 0; start < candidates.length; start += 3)
      await Promise.all(
        candidates.slice(start, start + 3).map(async (item) => {
          try {
            const scraper = scrapers.get(publisherId);
            if (scraper?.gallery) {
              for (const option of await scraper.gallery(
                item,
                { ...book, type: book.edition || book.type },
                request.refresh,
              ))
                await add(option.coverUrl, { ...item, ...option });
              return;
            }
            const html = await fetchText_(
              item.url,
              request.refresh,
              SCRAPE_TTL.product,
            );
            const title = textHtml(
              /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ||
                meta(html, "og:title") ||
                /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ||
                "",
            );
            if (specialSet(title)) return;
            const gallery = await publisherCovers(html, item.url);
            for (const cover of gallery.length ? gallery : [item.coverUrl])
              await add(cover, item);
          } catch {
            await add(item.coverUrl, item);
            warnings.push("Could not read the gallery for " + item.title + ".");
          }
        }),
      );
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
    return {
      row: book.row,
      covers: [...covers.values()],
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
      const catalog = await scraper.catalog(category.url, spec.refresh);
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
  return Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      async (request) => {
        if (request && typeof request === "object" && request.refresh === true)
          store.requireAdmin?.();
        return normalizeRecordTypes(await method(request));
      },
    ]),
  ) as typeof methods;
}
