import {
  BOOK_APP,
  PUBLISHERS,
  normalizeIsbn_,
  canonicalIsbn_,
  digest_,
  seriesCatalogRequest_,
  parseSeriesCategories_,
  matchSeriesCategory_,
  catalogSeriesKey_,
  catalogTotal_,
  parseCatalog_,
  releaseItem_,
  luckpimItem_,
  splitBookTitle_,
  attr_,
  structuredBooks_,
  meta_,
  names_,
  textHtml_,
  publisherCatalogSource_,
  safeCoverUrl_,
  volumeCoverKey_,
  parsePublisherTitles_,
  safePublisherTitleUrl_,
  safeProductUrl_,
} from "../domain.mjs";

// Catalog caches are durable; failed refreshes keep the previous successful result.
export function createCatalogService(store, fetchImpl = globalThis.fetch) {
  const cache = store.cache;
  const pendingCovers = new Map();
  const pendingTitles = new Map();
  function rememberCovers(items) {
    for (const item of items) {
      const cover = safeCoverUrl_(item.coverUrl);
      if (!cover || item.bundle || item.special) continue;
      const isbn = canonicalIsbn_(item.isbn),
        key = volumeCoverKey_(item);
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
      items: result.items.map((item) => ({
        ...item,
        ...releaseItem_(
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
        catalogSeriesKey_(item.series) !== catalogSeriesKey_(category.title) &&
        catalogSeriesKey_(item.series) !== catalogSeriesKey_(spec.series);
    });
    rememberCovers(catalog.items);
    return catalog;
  }
  async function requestRemote(url, options = {}) {
    const parsed = new URL(url);
    const allowed = [
      "www.phoenixnext.com",
      "www.firstpagepro.com",
      "www.luckpim.com",
      "www.naiin.com",
      "www.googleapis.com",
      "openlibrary.org",
    ];
    if (parsed.protocol !== "https:" || !allowed.includes(parsed.hostname))
      throw new Error("Unsupported catalog source.");
    const fetchOptions = {
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
      if (current.hostname !== "www.firstpagepro.com" || !location || hop === 3)
        throw new Error("Unsupported catalog redirect.");
      // This publisher sends raw UTF-8 Thai slugs in Location. Fetch exposes
      // header bytes as Latin-1; restore UTF-8 before URL percent-encoding.
      if (
        /[^\x00-\x7f]/.test(location) &&
        [...location].every((char) => char.charCodeAt(0) <= 255)
      ) {
        try {
          location = new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(location, (char) => char.charCodeAt(0)),
          );
        } catch {}
      }
      const next = new URL(location, current);
      const canonical = (value) =>
        safePublisherTitleUrl_(value.origin + value.pathname, "firstpage") ||
        safeProductUrl_(value.origin + value.pathname, "firstpage");
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
    const isbn = normalizeIsbn_(raw);
    if (!isbn) throw new Error("Enter or scan an ISBN first.");
    const canonical = canonicalIsbn_(isbn);

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
        const data = await fetchJson_(
          "https://www.googleapis.com/books/v1/volumes?q=isbn:" +
            encodeURIComponent(canonical) +
            "&maxResults=5",
        );
        const found = (data.items || []).find(function (item) {
          return ((item.volumeInfo || {}).industryIdentifiers || []).some(
            function (id) {
              return canonicalIsbn_(id.identifier) === canonical;
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
            coverUrl: safeCoverUrl_(
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
            coverUrl: safeCoverUrl_(
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
    const isbn = canonicalIsbn_(book.isbn),
      volumeKey = volumeCoverKey_(book);
    const key = isbn ? "cover:isbn:v1:" + isbn : volumeKey;
    const cached =
      (isbn && cache.get(key)) || (volumeKey && cache.get(volumeKey));
    if (cached) return { row, coverUrl: safeCoverUrl_(cached) };
    if (!isbn || cache.get("cover:miss:v1:" + isbn))
      return { row, coverUrl: "" };
    if (!pendingCovers.has(isbn)) {
      const pending = lookupIsbn(isbn)
        .then((result) => {
          const cover = safeCoverUrl_(result.details?.coverUrl);
          if (cover) cache.put(key, cover, 2592000);
          else if (!result.warnings.length)
            cache.put("cover:miss:v1:" + isbn, "1", 86400);
          return cover;
        })
        .finally(() => pendingCovers.delete(isbn));
      pendingCovers.set(isbn, pending);
    }
    return { row, coverUrl: await pendingCovers.get(isbn) };
  }

  async function getPublisherCatalog(request = {}) {
    const source = publisherCatalogSource_(
      request.url || "https://www.phoenixnext.com/gl.html",
    );
    const key = "publisher-catalog:v1:" + digest_(source.url);
    const previous = reparseItems(cachedJson_(cache, key));
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < 86400000
    )
      return previous;
    try {
      const catalog = await fetchSeriesCategory_(
        source.publisherId,
        source.url,
      );
      if (previous?.complete && !catalog.complete)
        throw new Error("Incomplete refresh");
      rememberCovers(catalog.items);
      const result = {
        ...catalog,
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

  async function getPublisherDirectory(request = {}) {
    const source = publisherCatalogSource_(
      request.url || "https://www.phoenixnext.com/gl.html",
    );
    const key = "publisher-directory:v1:" + digest_(source.url),
      previous = cachedJson_(cache, key);
    if (
      previous &&
      !request.refresh &&
      Date.now() - Date.parse(previous.checkedAt) < 86400000
    )
      return previous;
    try {
      const html = await fetchText_(source.url);
      const titles = parsePublisherTitles_(
        source.publisherId,
        html,
        source.url,
      );
      if (!titles.length) {
        // A pasted single-series category can omit its own link in navigation.
        const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
        if (!safePublisherTitleUrl_(source.url, source.publisherId) || !title)
          throw new Error("Directory markup unavailable");
        const name = textHtml_(title[1]);
        titles.push({
          id: source.publisherId + ":title:" + digest_(source.url),
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

  async function getPublisherTitle(request = {}) {
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
      categories.some((category) => !safePublisherTitleUrl_(category.url, id))
    )
      throw new Error("Choose a publisher title category.");
    const key = digest_(
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
      const items =
        publisher.id === "luckpim"
          ? await fetchLuckpim_()
          : await fetchCatalog_(publisher);
      if (!items.length) throw new Error("No book listings could be read.");
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
    const spec = seriesCatalogRequest_(request);
    const saved = savedSeriesCatalog_(spec),
      key =
        "series:v1:" +
        spec.publisherId +
        ":" +
        digest_(
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
      if (!category && spec.publisherId !== "luckpim") {
        const directory = await getSeriesCategories({
          publisherId: spec.publisherId,
        });
        category = matchSeriesCategory_(
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
            "https://www.luckpim.com/search_result?k=" +
            encodeURIComponent(spec.series),
        };
      const catalog =
        spec.publisherId === "luckpim"
          ? await fetchLuckpimSeries_(category.url)
          : await fetchSeriesCategory_(spec.publisherId, category.url);
      if (catalog.title) category = { title: catalog.title, url: category.url };
      annotateSeriesItems(catalog, spec, category);
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
      id === "luckpim"
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
      const categories = parseSeriesCategories_(id, await fetchText_(url));
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
        total = catalogTotal_(id, html);
        const heading =
          /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
          /<title\b[^>]*>([^<]*)<\/title>/i.exec(html);
        title = heading ? textHtml_(heading[1]) : "";
      }
      const parsed = parseCatalog_(id, html),
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
        const href = attr_(anchor, "href"),
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
    const items = data.list.map(luckpimItem_).filter(Boolean);
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
      token = tag && attr_(tag[0], "value");
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
      const parsed = parseCatalog_(p.id, html);
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
        const item = luckpimItem_(book);
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
      candidates = JSON.parse(attr_(component[0], ":items"));
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
        data = structuredBooks_(page);
      const exact = data.find(function (b) {
        return [b.isbn, b.gtin13, b.sku].some(function (code) {
          return canonicalIsbn_(code) === canonical;
        });
      });
      const metaIsbn = meta_(page, "book:isbn");
      if (!exact && canonicalIsbn_(metaIsbn) !== canonical) continue;
      const book = exact || {},
        title = book.name || candidate.ProductName || "";
      if (!title) continue;
      const parsed = splitBookTitle_(title);
      return {
        title: title,
        series: parsed.series,
        volume: parsed.volume,
        type: parsed.type,
        publisher: names_(book.publisher) || candidate.PublisherName || "",
        authors: names_(book.author) || candidate.AuthorName || "",
        source: "Naiin",
        url: url,
        releaseDate: meta_(page, "book:release_date"),
        coverUrl: safeCoverUrl_(book.image || meta_(page, "og:image")),
      };
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
    getPublisherCatalog,
    getPublisherDirectory,
    getPublisherTitle,
    getPublisherReleases,
    getSeriesCatalog,
    getSeriesCategories,
  };
}
