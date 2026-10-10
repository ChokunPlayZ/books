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
} from "../domain.mjs";

// Catalog caches are durable; failed refreshes keep the previous successful result.
export function createCatalogService(store, fetchImpl = globalThis.fetch) {
  const cache = store.cache;
  const savedSeriesCatalog_ = (spec) => store.savedSeriesCatalog(spec);
  // Re-read saved cache titles so parser fixes also apply before a refresh or outage.
  function reparseItems(result) {
    if (!result) return null;
    return {
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
  }
  function annotateSeriesItems(catalog, spec, category) {
    catalog.items.forEach((item) => {
      item.catalogSeries = spec.series;
      item.catalogVariant =
        catalogSeriesKey_(item.series) !== catalogSeriesKey_(category.title) &&
        catalogSeriesKey_(item.series) !== catalogSeriesKey_(spec.series);
    });
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
    const response = await fetchImpl(url, {
      ...options,
      headers: { "User-Agent": "Mozilla/5.0", ...options.headers },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
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

    const cached = cache.get("isbn:v2:" + canonical);
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
      cache.put("isbn:v2:" + canonical, JSON.stringify(result), 21600);
    return result;
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
      const html = await fetchText_(
        url + (page > 1 ? (id === "phoenix" ? "?p=" : "?tskp=") + page : ""),
      );
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
    getPublisherReleases,
    getSeriesCatalog,
    getSeriesCategories,
  };
}
