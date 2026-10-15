import {
  BOOK_APP,
  PUBLISHERS,
  normalizeIsbn,
  canonicalIsbn,
  digest,
  seriesCatalogRequest,
  parseSeriesCategories,
  matchSeriesCategory,
  seriesCategoryTitle,
  catalogSeriesKey,
  catalogTotal,
  parseCatalog,
  releaseItem,
  luckpimItem,
  splitBookTitle,
  attr,
  structuredBooks,
  meta,
  names,
  textHtml,
  publisherCatalogSource,
  safeCoverUrl,
  volumeCoverKey,
  parsePublisherTitles,
  safePublisherTitleUrl,
  safeProductUrl,
  safePublisherUrl,
  publisherKey,
  specialSet,
  releaseBundle,
} from "../domain.ts";
import { yaakzProducts, yaakzItems } from "./yaakz.ts";
import { publisherCovers } from "./publisher-covers.ts";
import type { Release } from "../types.ts";

type CatalogRequest = {
  row?: number;
  publisherUrl?: string;
  url?: string;
  refresh?: boolean;
  publisherId?: string;
  categories?: { title: string; url: string; type?: string }[];
  series?: string;
};

type CatalogResult = {
  items: Release[];
  total: number | null;
  pages: number;
  complete: boolean;
  title?: string;
  search?: boolean;
};

export function knownBookCoverUrl(store, book) {
  const isbn = canonicalIsbn(book.isbn);
  const volume = volumeCoverKey(book);
  return (
    book.coverUrl ||
    (isbn && store.cache.get("cover:isbn:v1:" + isbn)) ||
    (volume && store.cache.get(volume)) ||
    ""
  );
}

// Catalog caches are durable; failed refreshes keep the previous successful result.
export function createCatalogService(store, fetchImpl = globalThis.fetch) {
  const cache = store.cache;
  const pendingCovers = new Map();
  const pendingTitles = new Map();
  function rememberCovers(items) {
    for (const item of items) {
      const cover = safeCoverUrl(item.coverUrl);
      if (!cover || item.bundle || item.special) continue;
      const isbn = canonicalIsbn(item.isbn),
        key = volumeCoverKey(item);
      if (isbn) cache.put("cover:isbn:v1:" + isbn, cover, 2592000);
      if (key && !item.catalogVariant) cache.put(key, cover, 2592000);
    }
  }
  const savedSeriesCatalog_ = (spec) => store.savedSeriesCatalog(spec);
  // Re-read saved cache titles so parser fixes also apply before a refresh or outage.
  function reparseItems(result) {
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
          availability: item.availability,
        })),
    };
    rememberCovers(reparsed.items);
    return reparsed;
  }
  function annotateSeriesItems(catalog, spec, category) {
    catalog.items.forEach((item) => {
      item.catalogSeries = spec.series;
      item.catalogVariant =
        catalogSeriesKey(item.series) !==
          catalogSeriesKey(seriesCategoryTitle(category.title)) &&
        catalogSeriesKey(item.series) !== catalogSeriesKey(spec.series);
    });
    rememberCovers(catalog.items);
    return catalog;
  }
  async function requestRemote(url: string, options: RequestInit = {}) {
    const parsed = new URL(url);
    const allowed = [
      "www.phoenixnext.com",
      "www.firstpagepro.com",
      "www.luckpim.com",
      "www.naiin.com",
      "www.yaakz.com",
      "www.googleapis.com",
      "openlibrary.org",
    ];
    if (
      parsed.protocol !== "https:" ||
      !allowed.includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      throw new Error("Unsupported catalog source.");
    const fetchOptions: RequestInit = {
      ...options,
      headers: { "User-Agent": "Mozilla/5.0", ...options.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    };
    let current = parsed,
      response;
    for (let hop = 0; hop <= 3; hop++) {
      response = await fetchImpl(current.href, fetchOptions);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      let location = response.headers.get("location");
      if (
        !["www.firstpagepro.com", "www.yaakz.com"].includes(current.hostname) ||
        !location ||
        hop === 3
      )
        throw new Error("Unsupported catalog redirect.");
      // This publisher sends raw UTF-8 Thai slugs in Location. Fetch exposes
      // header bytes as Latin-1; restore UTF-8 before URL percent-encoding.
      if (
        /[^\x00-\x7f]/.test(location) &&
        [...location].every((char) => char.charCodeAt(0) <= 255)
      ) {
        try {
          location = new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from([...location], (char) => char.charCodeAt(0)),
          );
        } catch {}
      }
      const next = new URL(location, current);
      const sourceId =
        current.hostname === "www.yaakz.com" ? "yaakz" : "firstpage";
      const canonical = (value) =>
        safePublisherTitleUrl(value.origin + value.pathname, sourceId) ||
        safeProductUrl(value.origin + value.pathname, sourceId);
      if (
        next.protocol !== "https:" ||
        next.hostname !== current.hostname ||
        next.username ||
        next.password ||
        !canonical(current) ||
        canonical(next) !== canonical(current)
      )
        throw new Error("Unsupported catalog redirect.");
      if (!next.search) next.search = current.search;
      await response.body?.cancel();
      current = next;
    }
    let body = "",
      size = 0;
    if (response.body) {
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Catalog response too large.");
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    }
    const headers = Object.fromEntries(response.headers);
    headers["set-cookie"] = response.headers.getSetCookie?.() || [];
    return { status: response.status, body, headers };
  }
  async function lookupIsbn(raw) {
    const isbn = normalizeIsbn(raw);
    if (!isbn) throw new Error("Enter or scan an ISBN first.");
    const canonical = canonicalIsbn(isbn);

    const cached = cache.get("isbn:v3:" + canonical);
    if (cached) return JSON.parse(cached);
    const warnings = [];
    let details = null;
    try {
      details = await lookupNaiin_(canonical);
    } catch (e) {
      warnings.push(
        "Naiin is unavailable right now. You can still search it using the link below.",
      );
    }
    if (!details)
      try {
        const catalog = await fetchYaakzCatalog_(
          "https://www.yaakz.com/search?q=" + encodeURIComponent(canonical),
        );
        const item = catalog.items.find(
          (item) => canonicalIsbn(item.isbn) === canonical,
        );
        if (item) details = { ...item, source: "Yaakz" };
      } catch {
        warnings.push("Yaakz is unavailable right now.");
      }
    if (!details)
      try {
        const data = await fetchJson_(
          "https://www.googleapis.com/books/v1/volumes?q=isbn:" +
            encodeURIComponent(canonical) +
            "&maxResults=5",
        );
        const found = (data.items || []).find(function (item) {
          return ((item.volumeInfo || {}).industryIdentifiers || []).some(
            function (id) {
              return canonicalIsbn(id.identifier) === canonical;
            },
          );
        });
        if (found) {
          const v = found.volumeInfo;
          details = {
            title: v.title || "",
            publisher: v.publisher || "",
            authors: (v.authors || []).join(", "),
            source: "Google Books",
            coverUrl: safeCoverUrl(
              v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail,
            ),
          };
        }
      } catch (e) {
        warnings.push("Google Books is unavailable right now.");
      }
    if (!details) {
      try {
        const key = "ISBN:" + canonical;
        const data = await fetchJson_(
          "https://openlibrary.org/api/books?bibkeys=" +
            encodeURIComponent(key) +
            "&jscmd=data&format=json",
        );
        const v = data[key];
        if (v)
          details = {
            title: v.title || "",
            publisher: (v.publishers || [])
              .map(function (p) {
                return p.name;
              })
              .join(", "),
            authors: (v.authors || [])
              .map(function (a) {
                return a.name;
              })
              .join(", "),
            source: "Open Library",
            coverUrl: safeCoverUrl(
              v.cover?.medium || v.cover?.large || v.cover?.small,
            ),
          };
      } catch (e) {
        warnings.push("Open Library is unavailable right now.");
      }
    }
    const result = {
      isbn: isbn,
      found: !!details,
      details: details,
      warnings: warnings,
      searchUrl:
        "https://www.naiin.com/search-result?title=" +
        encodeURIComponent(canonical),
    };
    if (details)
      cache.put("isbn:v3:" + canonical, JSON.stringify(result), 21600);
    return result;
  }

  async function getBookCover(request) {
    const row = request?.row;
    if (!Number.isSafeInteger(row)) throw new Error("Choose a library volume.");
    const collection = store.api.getCollection();
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
      (isbn && cache.get(key)) || (volumeKey && cache.get(volumeKey));
    if (cached)
      return { row, token: book.token, coverUrl: safeCoverUrl(cached) };
    if (request.lookup === false)
      return { row, token: book.token, coverUrl: "" };
    if (!isbn && publisherKey(book.publisher) === "yaakz") {
      const catalog = await getSeriesCatalog({
        series: book.series,
        type: book.type,
        publisherId: "yaakz",
      });
      const match = catalog.items.find(
        (item) =>
          !item.bundle &&
          !item.special &&
          !item.catalogVariant &&
          Number(item.volume) === Number(book.volume) &&
          item.volume !== "" &&
          item.type === book.type,
      );
      return { row, token: book.token, coverUrl: match?.coverUrl || "" };
    }
    if (!isbn || cache.get("cover:miss:v1:" + isbn))
      return { row, token: book.token, coverUrl: "" };
    if (!pendingCovers.has(isbn)) {
      const pending = lookupIsbn(isbn)
        .then((result) => {
          const cover = safeCoverUrl(result.details?.coverUrl);
          if (cover) cache.put(key, cover, 2592000);
          else if (!result.warnings.length)
            cache.put("cover:miss:v1:" + isbn, "1", 86400);
          return cover;
        })
        .finally(() => pendingCovers.delete(isbn));
      pendingCovers.set(isbn, pending);
    }
    return { row, token: book.token, coverUrl: await pendingCovers.get(isbn) };
  }

  async function getBookCoverOptions(request: CatalogRequest = {}) {
    const book = store.api
      .getCollection()
      .books.find((b) => b.row === request.row);
    if (!book) throw new Error("Choose a library volume.");
    const publisherId = publisherKey(book.publisher);
    const supportedPublisher = PUBLISHERS.some((p) => p.id === publisherId);
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
          refresh: true,
        })
      : { items: [] };
    const matchingType = (type) =>
      String(type || "")
        .replace(/\s*\(colou?r\)/gi, "")
        .trim();
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
            if (publisherId === "yaakz") {
              const options = item.coverUrl
                ? [item]
                : yaakzItems(await fetchYaakzProduct_(item.url));
              for (const option of options) {
                if (specialSet(option.title) || option.bundle) continue;
                if (
                  (canonicalIsbn(book.isbn) &&
                    canonicalIsbn(book.isbn) === canonicalIsbn(option.isbn)) ||
                  (book.volume !== "" &&
                    option.volume !== "" &&
                    Number(option.volume) === Number(book.volume) &&
                    (!option.type ||
                      matchingType(option.type) === matchingType(book.type)))
                )
                  add(option.coverUrl, option);
              }
              return;
            }
            const html = await fetchText_(item.url);
            const title = textHtml(
              /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ||
                meta(html, "og:title") ||
                /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ||
                "",
            );
            if (specialSet(title)) return;
            const gallery = publisherCovers(html, item.url);
            for (const cover of gallery.length ? gallery : [item.coverUrl])
              add(cover, item);
          } catch {
            add(item.coverUrl, item);
            warnings.push("Could not read the gallery for " + item.title + ".");
          }
        }),
      );
    if (catalog.error) warnings.push(catalog.error);
    const isbn = canonicalIsbn(book.isbn);
    if (isbn || /\(TH\)/.test(book.type)) {
      try {
        const shop = isbn
          ? await lookupNaiin_(isbn)
          : await lookupNaiinTitle_(book);
        if (shop?.coverUrl)
          add(shop.coverUrl, {
            title: shop.title,
            url: book.publisherUrl || "",
            source: "Naiin",
            sourceUrl: shop.url,
          });
      } catch {
        warnings.push("Could not check Naiin for this ISBN.");
      }
    }
    if (publisherId !== "yaakz" && /\(TH\)/.test(book.type)) {
      try {
        const shops = await fetchYaakzCatalog_(
          "https://www.yaakz.com/search?q=" +
            encodeURIComponent(isbn || book.series),
        );
        for (const item of shops.items) {
          if (item.bundle || specialSet(item.title)) continue;
          const exact = isbn && canonicalIsbn(item.isbn) === isbn;
          const named =
            !isbn &&
            catalogSeriesKey(item.series) === catalogSeriesKey(book.series) &&
            item.volume !== "" &&
            book.volume !== "" &&
            Number(item.volume) === Number(book.volume) &&
            item.type === book.type;
          if (exact || named)
            add(item.coverUrl, {
              ...item,
              url: book.publisherUrl || "",
              source: "Yaakz",
              sourceUrl: item.url,
            });
        }
      } catch {
        warnings.push("Could not check Yaakz for this volume.");
      }
    }
    return {
      row: book.row,
      covers: [...covers.values()],
      warnings,
      publisherUrl: candidates[0]?.url || catalog.url || "",
    };
  }

  async function getPublisherCatalog(request: CatalogRequest = {}) {
    const source = publisherCatalogSource(
      request.url || "https://www.phoenixnext.com/gl.html",
    );
    const key = "publisher-catalog:v1:" + digest(source.url);
    const previous = reparseItems(cachedJson_(cache, key));
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < 86400000
    )
      return previous;
    try {
      const catalog =
        source.publisherId === "yaakz"
          ? await fetchYaakzCatalog_(source.url, 20, !!request.refresh)
          : await fetchSeriesCategory_(source.publisherId, source.url);
      if (previous?.complete && !catalog.complete)
        throw new Error("Incomplete refresh");
      rememberCovers(catalog.items);
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
      cacheJson_(cache, key, result);
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
    if (source.publisherId === "yaakz")
      return getPublisherCatalog({ ...request, url: source.url });
    const key = "publisher-directory:v1:" + digest(source.url),
      previous = cachedJson_(cache, key);
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < 86400000
    )
      return previous;
    try {
      const html = await fetchText_(source.url);
      const titles = parsePublisherTitles(source.publisherId, html, source.url);
      if (!titles.length) {
        // A pasted single-series category can omit its own link in navigation.
        const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
        if (!safePublisherTitleUrl(source.url, source.publisherId) || !title)
          throw new Error("Directory markup unavailable");
        const name = textHtml(title[1]);
        titles.push({
          id: source.publisherId + ":title:" + digest(source.url),
          ...source,
          publisher: PUBLISHERS.find((p) => p.id === source.publisherId).name,
          series: name,
          title: name,
          categories: [{ url: source.url, type: "" }],
          type: "",
          volume: "",
          isbn: "",
          directory: true,
        });
      }
      const result = {
        ...source,
        titles,
        items: [],
        checkedAt: new Date().toISOString(),
        stale: false,
        title:
          source.publisherId === "firstpage"
            ? "First Page Pro titles"
            : source.url.endsWith("gl.html")
              ? "Phoenix Next · Girl’s Love"
              : "Phoenix Next titles",
        error: "",
      };
      cacheJson_(cache, key, result);
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
          categories.map((category) =>
            getPublisherCatalog({
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
          rememberCovers([{ ...item, catalogSeries: series }]);
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
    if (!publisher) throw new Error("Choose a supported publisher.");
    const key = "releases:v1:" + publisher.id;
    const cached = cache.get(key),
      previous = reparseItems(cached ? JSON.parse(cached) : null);
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < 3600000
    )
      return previous;
    try {
      const scraped =
        publisher.id === "luckpim"
          ? await fetchLuckpim_()
          : publisher.id === "yaakz"
            ? (await fetchYaakzCatalog_(publisher.url, 2, !!request.refresh))
                .items
            : await fetchCatalog_(publisher);
      if (!scraped.length) throw new Error("No book listings could be read.");
      const items = scraped.filter((item) => !specialSet(item.title));
      rememberCovers(items);
      const result = {
        publisherId: publisher.id,
        items: items,
        checkedAt: new Date().toISOString(),
        stale: false,
        error: "",
      };
      const json = JSON.stringify(result);
      cache.put(key, json, 604800);
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
    const saved = savedSeriesCatalog_(spec),
      key =
        "series:v1:" +
        spec.publisherId +
        ":" +
        digest(
          spec.series + "\n" + spec.type + "\n" + (saved ? saved.url : ""),
        );
    const cached = reparseItems(cachedJson_(cache, key));
    const previous = cached ? annotateSeriesItems(cached, spec, cached) : null;
    if (
      previous &&
      !spec.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < 3600000
    )
      return previous;
    let category = saved;
    try {
      if (!category && !["luckpim", "yaakz"].includes(spec.publisherId)) {
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
          url:
            (spec.publisherId === "yaakz"
              ? "https://www.yaakz.com/search?q="
              : "https://www.luckpim.com/search_result?k=") +
            encodeURIComponent(spec.series),
        };
      const catalog: CatalogResult =
        spec.publisherId === "luckpim"
          ? await fetchLuckpimSeries_(category.url)
          : spec.publisherId === "yaakz"
            ? await fetchYaakzCatalog_(category.url, 20, spec.refresh)
            : await fetchSeriesCategory_(spec.publisherId, category.url);
      if (catalog.title) category = { title: catalog.title, url: category.url };
      annotateSeriesItems(catalog, spec, category);
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
      cacheJson_(cache, key, result);
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
    if (
      !PUBLISHERS.some(function (p) {
        return p.id === id;
      }) ||
      ["luckpim", "yaakz"].includes(id)
    )
      throw new Error(
        "Choose Phoenix Next or First Page Pro for series categories.",
      );
    const key = "series-directory:v1:" + id,
      previous = cachedJson_(cache, key);
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < 3600000
    )
      return previous;
    const url =
      id === "phoenix"
        ? "https://www.phoenixnext.com/book-series.html"
        : "https://www.firstpagepro.com/";
    try {
      const categories = parseSeriesCategories(id, await fetchText_(url));
      if (!categories.length) throw new Error("Category directory unavailable");
      const result = {
        publisherId: id,
        url: url,
        categories: categories,
        checkedAt: new Date().toISOString(),
        stale: false,
        error: "",
      };
      cacheJson_(cache, key, result);
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

  async function fetchYaakzProduct_(url, refresh = false) {
    const safe = safeProductUrl(url, "yaakz");
    if (!safe) throw new Error("Choose a Yaakz product page.");
    const key = "yaakz-product:v1:" + digest(safe);
    const previous = cachedJson_(cache, key);
    if (
      previous &&
      !refresh &&
      Date.now() - Date.parse(previous.checkedAt) < 3600000
    )
      return previous.product;
    const products = yaakzProducts(await fetchText_(safe));
    const uuid = safe.split("/").pop();
    const product = products.find((product) => String(product.uuid) === uuid);
    if (!product) throw new Error("Yaakz product markup changed.");
    cacheJson_(cache, key, { product, checkedAt: new Date().toISOString() });
    return product;
  }

  async function fetchYaakzCatalog_(url, maxPages = 20, refresh = false) {
    const parsed = new URL(url);
    const query = parsed.searchParams.get("q");
    const category = parsed.pathname.split("/").pop();
    const items = new Map(),
      parentIds = new Set();
    let pages = 0,
      complete = false,
      total = 0;
    for (let page = 1; page <= maxPages; page++) {
      const endpoint = new URL("https://www.yaakz.com/api/products");
      endpoint.searchParams.set(
        query ? "filter[q]" : "filter[parent_category_id]",
        query || (/^\d+$/.test(category) ? category : "976"),
      );
      endpoint.searchParams.set("page", String(page));
      endpoint.searchParams.set("per_page", "20");
      const result = await fetchJson_(endpoint.href);
      if (!Array.isArray(result.data) || !Number.isSafeInteger(result.total))
        throw new Error("Yaakz catalog markup changed.");
      if (
        result.total < 0 ||
        result.data.some((item) => !/^\d+$/.test(String(item.uuid)))
      )
        throw new Error("Yaakz catalog markup changed.");
      total = result.total;
      const before = parentIds.size;
      result.data.forEach((item) => parentIds.add(item.uuid));
      if (parentIds.size === before && result.data.length) break;
      for (let start = 0; start < result.data.length; start += 3) {
        await Promise.all(
          result.data.slice(start, start + 3).map(async (product) => {
            if (product.has_subproduct)
              product = await fetchYaakzProduct_(
                "https://www.yaakz.com/product/" + product.uuid,
                refresh,
              );
            for (const item of yaakzItems(product))
              if (!specialSet(item.title)) items.set(item.id, item);
          }),
        );
      }
      pages++;
      if (parentIds.size === total) {
        complete = true;
        break;
      }
      if (!result.data.length) break;
    }
    return {
      items: [...items.values()],
      total,
      pages,
      complete,
      title: query || "Yaakz new arrivals",
      search: !!query,
    };
  }

  async function fetchSeriesCategory_(id, url) {
    const items = new Map();
    let total = null,
      complete = false,
      pages = 0,
      title = "";
    for (let page = 1; page <= 20; page++) {
      let html;
      try {
        html = await fetchText_(
          url + (page > 1 ? (id === "phoenix" ? "?p=" : "?tskp=") + page : ""),
        );
      } catch (error) {
        if (!items.size) throw error;
        break;
      }
      if (page === 1) {
        total = catalogTotal(id, html);
        const heading =
          /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
          /<title\b[^>]*>([^<]*)<\/title>/i.exec(html);
        title = heading ? textHtml(heading[1]) : "";
      }
      const parsed = parseCatalog(id, html),
        before = items.size;
      parsed.forEach(function (item) {
        items.set(item.id, item);
      });
      pages++;
      if (total !== null && items.size === total) {
        complete = true;
        break;
      }
      if (!parsed.length) {
        if (page === 1 && total !== 0)
          throw new Error("Category markup changed");
        break;
      }
      if (items.size === before) break; // A repeated page must not masquerade as a complete catalog.
      const next = (html.match(/<a\b[^>]*>/gi) || []).some(function (anchor) {
        const href = attr(anchor, "href"),
          param = id === "phoenix" ? "p" : "tskp";
        return (
          href.indexOf(url) === 0 &&
          new RegExp("[?&]" + param + "=" + (page + 1) + "(?:&|$)").test(href)
        );
      });
      if (!next && (total === null || items.size >= total)) break;
    }
    return {
      items: Array.from(items.values()),
      total: total,
      pages: pages,
      complete: complete,
      title: title,
    };
  }

  async function fetchLuckpimSeries_(url) {
    const keyword = decodeURIComponent(url.split("?k=")[1]),
      session = await luckpimSession_("https://www.luckpim.com/");
    const result = await requestRemote(
      "https://www.luckpim.com/get/search_pin/key?page=1&limit=-1&keyword=" +
        encodeURIComponent(keyword),
      { headers: session },
    );
    if (result.status !== 200) throw new Error("Series search unavailable");
    const response = JSON.parse(result.body),
      data = response.data;
    if (
      response.status !== 200 ||
      !data ||
      !Array.isArray(data.list) ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0
    )
      throw new Error("Series search changed");
    const items = data.list.map(luckpimItem).filter(Boolean);
    return {
      items: items,
      total: data.total,
      pages: 1,
      complete: items.length === data.total,
      search: true,
    };
  }

  async function luckpimSession_(url) {
    const response = await requestRemote(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (response.status !== 200) throw new Error("Catalog unavailable");
    const tag =
        /<input\b[^>]*name=["']?__RequestVerificationToken["']?[^>]*>/i.exec(
          response.body,
        ),
      token = tag && attr(tag[0], "value");
    if (!token) throw new Error("Catalog token unavailable");
    const headers = response.headers,
      cookieHeader = headers["Set-Cookie"] || headers["set-cookie"] || [];
    return {
      "XSRF-TOKEN": token,
      Cookie: (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader])
        .map(function (v) {
          return String(v).split(";")[0];
        })
        .join("; "),
    };
  }

  async function fetchCatalog_(p) {
    let items = [];
    for (let page = 1; page <= 2; page++) {
      const url = p.url + (page > 1 ? "?tskp=" + page : "");
      // Phoenix uses p, First Page Pro uses tskp.
      const html = await fetchText_(
        p.id === "phoenix" && page > 1 ? p.url + "?p=" + page : url,
      );
      const parsed = parseCatalog(p.id, html);
      if (!parsed.length) {
        if (page === 1) throw new Error("Catalog unavailable");
        break;
      }
      items = items.concat(parsed);
    }
    const seen = {};
    return items
      .filter(function (item) {
        if (seen[item.id]) return false;
        seen[item.id] = true;
        return true;
      })
      .slice(0, p.id === "phoenix" ? 72 : 40);
  }

  async function fetchLuckpim_() {
    const session = await luckpimSession_(
      "https://www.luckpim.com/product/list/new",
    );
    let items = [];
    for (let page = 1; page <= 2; page++) {
      const result = await requestRemote(
        "https://www.luckpim.com/_api/getBookList?setting=new&page=" +
          page +
          "&limit=100",
        {
          headers: session,
        },
      );
      if (result.status !== 200) throw new Error("Catalog unavailable");
      const data = JSON.parse(result.body);
      if (data.sc !== 200 || !data.d || !Array.isArray(data.d.data))
        throw new Error("Catalog changed");
      data.d.data.forEach(function (book) {
        const item = luckpimItem(book);
        if (item) items.push(item);
      });
      if (page * 100 >= Number(data.d.total) || data.d.data.length < 100) break;
    }
    return items;
  }

  async function lookupNaiin_(canonical) {
    const html = await fetchText_(
      "https://www.naiin.com/search-result?title=" +
        encodeURIComponent(canonical),
    );
    const component = /<product-list\b[^>]*>/i.exec(html);
    if (!component) throw new Error("Search markup unavailable");
    let candidates;
    try {
      candidates = JSON.parse(attr(component[0], ":items"));
    } catch (e) {
      throw new Error("Search markup changed");
    }
    if (!Array.isArray(candidates)) throw new Error("Search markup changed");
    candidates = candidates
      .filter(function (v) {
        return (
          Number(v.ProductTypeId) === 1 && /^\d+$/.test(String(v.ProductID))
        );
      })
      .slice(0, 4);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i],
        url = "https://www.naiin.com/product/detail/" + candidate.ProductID;
      const page = await fetchText_(url),
        data = structuredBooks(page);
      const exact = data.find(function (b) {
        return [b.isbn, b.gtin13, b.sku].some(function (code) {
          return canonicalIsbn(code) === canonical;
        });
      });
      const metaIsbn = meta(page, "book:isbn");
      if (!exact && canonicalIsbn(metaIsbn) !== canonical) continue;
      const book = exact || {},
        title = book.name || candidate.ProductName || "";
      if (!title) continue;
      const parsed = splitBookTitle(title);
      return {
        title: title,
        series: parsed.series,
        volume: parsed.volume,
        type: parsed.type,
        publisher: names(book.publisher) || candidate.PublisherName || "",
        authors: names(book.author) || candidate.AuthorName || "",
        source: "Naiin",
        url: url,
        releaseDate: meta(page, "book:release_date"),
        coverUrl: safeCoverUrl(book.image || meta(page, "og:image")),
      };
    }
    return null;
  }

  async function lookupNaiinTitle_(book) {
    if (book.volume === "" || book.volume == null) return null;
    const html = await fetchText_(
      "https://www.naiin.com/search-result?title=" +
        encodeURIComponent(book.series + " เล่ม " + book.volume),
    );
    const component = /<product-list\b[^>]*>/i.exec(html);
    if (!component) throw new Error("Naiin search unavailable.");
    const candidates = JSON.parse(attr(component[0], ":items"));
    if (!Array.isArray(candidates)) throw new Error("Naiin search changed.");
    for (const candidate of candidates
      .filter(
        (item) =>
          Number(item.ProductTypeId) === 1 &&
          /^\d+$/.test(String(item.ProductID)),
      )
      .slice(0, 4)) {
      const url = "https://www.naiin.com/product/detail/" + candidate.ProductID;
      const page = await fetchText_(url);
      for (const product of structuredBooks(page)) {
        const title = product.name || candidate.ProductName || "";
        const parsed = splitBookTitle(title);
        const publisher = names(product.publisher) || candidate.PublisherName;
        if (
          specialSet(title) ||
          releaseBundle(title) ||
          parsed.volume === "" ||
          Number(parsed.volume) !== Number(book.volume) ||
          catalogSeriesKey(parsed.series) !== catalogSeriesKey(book.series) ||
          !publisher ||
          publisherKey(publisher) !== publisherKey(book.publisher) ||
          !parsed.type ||
          parsed.type !== book.type
        )
          continue;
        return {
          title,
          url,
          coverUrl: safeCoverUrl(product.image || meta(page, "og:image")),
        };
      }
    }
    return null;
  }

  async function fetchText_(url) {
    const r = await requestRemote(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (r.status !== 200) throw new Error("Website unavailable");
    return r.body;
  }

  async function fetchJson_(url) {
    const response = await requestRemote(url, {});
    if (response.status !== 200)
      throw new Error("Book lookup service returned " + response.status);
    return JSON.parse(response.body);
  }
  function cachedJson_(cache, key) {
    try {
      const json = cache.get(key);
      return json ? JSON.parse(json) : null;
    } catch (error) {
      return null;
    }
  }
  function cacheJson_(cache, key, value) {
    const json = JSON.stringify(value);
    cache.put(key, json, 604800);
  }
  return {
    lookupIsbn,
    getBookCover,
    getBookCoverOptions,
    getPublisherCatalog,
    getPublisherDirectory,
    getPublisherTitle,
    getPublisherReleases,
    getSeriesCatalog,
    getSeriesCategories,
  };
}
