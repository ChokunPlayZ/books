import { createHash } from "node:crypto";
export const BOOK_APP = Object.freeze({
  headers: [
    "ISBN",
    "Series",
    "Type",
    "Publisher",
    "Status",
    "Volume",
    "Source",
    "Price",
    "Date",
    "Note",
  ],
  fields: [
    "isbn",
    "series",
    "type",
    "publisher",
    "status",
    "volume",
    "source",
    "price",
    "date",
    "note",
  ],
  statuses: ["Sealed", "Un Sealed", "Reading", "Read"],
  types: [
    "LN (EN)",
    "Manga (JP) (Color)",
    "Manga (TH)",
    "LN (TH)",
    "Manga (JP)",
    "Manga (TH) (Color)",
    "Other",
  ],
});
export const PUBLISHERS = Object.freeze([
  {
    id: "phoenix",
    name: "Phoenix Next",
    url: "https://www.phoenixnext.com/new-release.html",
    scope: "Latest 72 catalog listings",
  },
  {
    id: "firstpage",
    name: "First Page Pro",
    url: "https://www.firstpagepro.com/showroom/new",
    scope: "Latest 40 catalog listings",
  },
  {
    id: "luckpim",
    name: "Luckpim",
    url: "https://www.luckpim.com/product/list/new",
    scope: "Monthly new releases, up to 200 listings",
  },
]);
export function normalizeBook_(b) {
  const values = BOOK_APP.fields.map(function (key) {
    const value =
      b[key] === undefined || b[key] === null ? "" : String(b[key]).trim();
    if (value.length > (key === "note" ? 2000 : 500))
      throw new Error(key + " is too long.");
    return value;
  });
  if (!values[1]) throw new Error("Enter a series or book title.");
  values[0] = normalizeIsbn_(values[0]);
  if (!values[2]) throw new Error("Choose a book type.");
  if (!values[4]) throw new Error("Choose a reading status.");
  [5, 7].forEach(function (i) {
    if (values[i] !== "") {
      if (
        !/^\d+(?:\.\d+)?$/.test(values[i]) ||
        !Number.isFinite(Number(values[i]))
      ) {
        throw new Error(
          BOOK_APP.headers[i] + " must be a non-negative number.",
        );
      }
      values[i] = Number(values[i]);
    }
  });
  values[8] = values[8] ? dateSerial_(values[8]) : "";
  return values;
}

export function dateSerial_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Choose a valid date.");
  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    parts[0] < 1900 ||
    parts[0] > 9999 ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("Choose a valid date.");
  return Math.round((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

export function normalizeIsbn_(raw) {
  const value = String(raw === undefined || raw === null ? "" : raw)
    .trim()
    .replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (!value) return "";
  let sum = 0;
  if (/^\d{9}[\dX]$/.test(value)) {
    for (let i = 0; i < 10; i++)
      sum += (value[i] === "X" ? 10 : Number(value[i])) * (10 - i);
    if (sum % 11 === 0) return value;
  } else if (/^97[89]\d{10}$/.test(value)) {
    for (let i = 0; i < 13; i++) sum += Number(value[i]) * (i % 2 ? 3 : 1);
    if (sum % 10 === 0) return value;
  }
  throw new Error(
    "That ISBN is not valid. Scan the 978/979 barcode or enter a valid ISBN-10/ISBN-13.",
  );
}

export function canonicalIsbn_(raw) {
  let value;
  try {
    value = normalizeIsbn_(raw);
  } catch (e) {
    return "";
  }
  if (value.length !== 10) return value;
  const stem = "978" + value.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(stem[i]) * (i % 2 ? 3 : 1);
  return stem + ((10 - (sum % 10)) % 10);
}

export function stableJson_(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableJson_).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map(function (k) {
        return JSON.stringify(k) + ":" + stableJson_(v[k]);
      })
      .join(",") +
    "}"
  );
}

export function safeSeriesCatalogUrl_(raw, id) {
  const url = decodeHtml_(String(raw || "").trim());
  if (
    id === "phoenix" &&
    /^https:\/\/www\.phoenixnext\.com\/book-series\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.html$/.test(
      url,
    )
  )
    return url;
  const first =
    id === "firstpage" &&
    /^https:\/\/www\.firstpagepro\.com\/category\/(\d+)(?:\/[^?#]*)?\/?$/.exec(
      url,
    );
  if (first) return "https://www.firstpagepro.com/category/" + first[1];
  if (
    id === "luckpim" &&
    /^https:\/\/www\.luckpim\.com\/search_result\?k=[^&#]+$/.test(url)
  ) {
    try {
      const keyword = decodeURIComponent(url.split("?k=")[1]).trim();
      return keyword && keyword.length <= 500
        ? "https://www.luckpim.com/search_result?k=" +
            encodeURIComponent(keyword)
        : "";
    } catch (error) {}
  }
  return "";
}

export function publisherCatalogSource_(raw) {
  const url = decodeHtml_(String(raw || "").trim());
  for (const id of ["phoenix", "firstpage"]) {
    const category = safePublisherTitleUrl_(url, id);
    if (category) return { publisherId: id, url: category };
  }
  if (
    /^https:\/\/www\.phoenixnext\.com\/(?:gl|bl|manga|light-novel|book-series)\.html$/.test(
      url,
    )
  )
    return { publisherId: "phoenix", url };
  if (
    url === "https://www.firstpagepro.com/" ||
    url === "https://www.firstpagepro.com"
  )
    return { publisherId: "firstpage", url: "https://www.firstpagepro.com/" };
  throw new Error(
    "Use a Phoenix Next book category or First Page Pro category URL.",
  );
}

export function safePublisherTitleUrl_(raw, id) {
  const url = decodeHtml_(String(raw || ""));
  if (
    id === "phoenix" &&
    /^https:\/\/www\.phoenixnext\.com\/(?:book-series|gl|bl|manga|light-novel)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.html$/.test(
      url,
    )
  )
    return url;
  return safeSeriesCatalogUrl_(url, id);
}

export function parsePublisherTitles_(id, html, sourceUrl) {
  const candidates = new Map();
  for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    const tag = anchor.slice(0, anchor.indexOf(">") + 1),
      rawUrl = attr_(tag, "href");
    const url = safePublisherTitleUrl_(rawUrl, id);
    const title = textHtml_(
      anchor.slice(anchor.indexOf(">") + 1, anchor.lastIndexOf("</a>")),
    )
      .replace(/(?:\s*\([\d,]+\)\s*(?:รายการ|ชิ้น)|\s*\[[\d,]+\])\s*$/, "")
      .trim();
    if (!url || !title) continue;
    if (id === "phoenix") {
      const scope = new URL(sourceUrl).pathname.replace(/\.html$/, "");
      if (!new URL(url).pathname.startsWith(scope + "/") && url !== sourceUrl)
        continue;
    }
    const type =
      id === "firstpage"
        ? /\/light-novel/i.test(rawUrl)
          ? "LN (TH)"
          : /\/manga/i.test(rawUrl)
            ? "Manga (TH)"
            : ""
        : "";
    if (!candidates.has(url))
      candidates.set(url, {
        url,
        title,
        type,
        rawUrl,
        navPath: new URL(rawUrl).pathname
          .replace(/^\/category\/\d+/, "")
          .replace(/\/$/, ""),
      });
  }
  let entries = [...candidates.values()];
  if (id === "firstpage") {
    const selected = entries.find((entry) => entry.url === sourceUrl);
    if (selected)
      entries = entries.filter(
        (entry) =>
          entry.url === sourceUrl ||
          entry.navPath.startsWith(selected.navPath + "/"),
      );
    entries = entries.filter(
      (entry) =>
        !entries.some((other) => other.navPath.startsWith(entry.navPath + "/")),
    );
    if (sourceUrl === "https://www.firstpagepro.com/")
      entries = entries.filter(
        (entry) => entry.navPath.split("/").filter(Boolean).length >= 2,
      );
  }
  const titles = new Map();
  for (const entry of entries) {
    const key = catalogSeriesKey_(entry.title);
    const existing = titles.get(key);
    if (existing) {
      existing.categories.push({ url: entry.url, type: entry.type });
      if (existing.type !== entry.type) existing.type = "";
    } else
      titles.set(key, {
        id: id + ":title:" + digest_(key),
        publisherId: id,
        publisher: PUBLISHERS.find((p) => p.id === id).name,
        series: entry.title,
        title: entry.title,
        type: entry.type,
        url: entry.url,
        categories: [{ url: entry.url, type: entry.type }],
        volume: "",
        isbn: "",
        coverUrl: "",
        directory: true,
      });
  }
  return [...titles.values()].sort((a, b) => a.series.localeCompare(b.series));
}

export function safeCoverUrl_(raw, base) {
  if (Array.isArray(raw)) raw = raw[0];
  if (raw && typeof raw === "object") raw = raw.url || raw.contentUrl;
  if (!raw) return "";
  try {
    const url = new URL(decodeHtml_(String(raw)), base);
    const host = url.hostname;
    const allowed = [
      "www.phoenixnext.com",
      "www.firstpagepro.com",
      "www.luckpim.com",
      "books.google.com",
      "books.googleusercontent.com",
      "covers.openlibrary.org",
    ];
    if (
      !allowed.includes(host) &&
      !/^(?:[a-z0-9-]+\.)*(?:naiin\.com|lnwfile\.com)$/.test(host)
    )
      return "";
    if (url.protocol === "http:") url.protocol = "https:";
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.href.length > 2000
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}

export function publisherKey_(name) {
  const key = String(name || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  if (/phoenix|ฟีนิกซ์/.test(key)) return "phoenix";
  if (/firstpage|เฟิร์สเพจ/.test(key)) return "firstpage";
  if (/luckpim|รักพิมพ์/.test(key)) return "luckpim";
  return key;
}

export function volumeCoverKey_(book) {
  if (book.volume === "" || book.volume == null || !book.type) return "";
  return (
    "cover:volume:v1:" +
    digest_(
      JSON.stringify([
        book.publisherId || publisherKey_(book.publisher),
        catalogSeriesKey_(book.catalogSeries || book.series),
        book.type.replace(/\s*\(colou?r\)/gi, "").trim(),
        Number(book.volume),
      ]),
    )
  );
}

export function seriesCatalogRequest_(request) {
  request = request || {};
  const series = String(request.series || "").trim(),
    publisher = PUBLISHERS.find(function (p) {
      return p.id === request.publisherId;
    });
  if (!series || series.length > 500 || !publisher)
    throw new Error("Choose a series and a supported publisher.");
  const type = String(request.type || "").trim();
  if (type.length > 100) throw new Error("Choose a valid book type.");
  return {
    series: series,
    publisherId: publisher.id,
    type: type,
    refresh: request.refresh === true,
  };
}

export function catalogSeriesKey_(text) {
  return bookSeriesTitle_(text)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/@comic/gi, "")
    .replace(/(?:\s*\(\d+\)\s*รายการ|\s*\[\d+\])\s*$/, "")
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

export function bookSeriesTitle_(text) {
  return String(text || "")
    .replace(/^\[PRE-ORDER\]\s*/i, "")
    .replace(/^(?:\(LN\)|\(มังงะ\)|\(นิยาย\)|นิยาย|การ์ตูน)\s*/i, "")
    .replace(
      /^(?:(?:special|complete|ultimate|limited)(?:\s+combo)?\s+(?:set|edition)|box\s+set)\s+(?:[AB]\s+)?(?:\(Exclusive Pre-order Period\)\s*)?/i,
      "",
    )
    .replace(/\s*\((?:ฉบับพิเศษ|ปกพิเศษ)\)\s*$/i, "")
    .trim();
}

export function releaseBundle_(title) {
  return /box\s*set|ครบชุด|ยกชุด|(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*\d+(?:\.\d+)?\s*(?:[-–—~]|ถึง)\s*\d/i.test(
    title,
  );
}

export function parseSeriesCategories_(id, html) {
  const categories = new Map(),
    anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  anchors.forEach(function (anchor) {
    const url = safeSeriesCatalogUrl_(
      attr_(anchor.slice(0, anchor.indexOf(">") + 1), "href"),
      id,
    );
    const title = textHtml_(
      anchor.slice(anchor.indexOf(">") + 1, anchor.lastIndexOf("</a>")),
    )
      .replace(/(?:\s*\(\d+\)\s*รายการ|\s*\[\d+\])\s*$/, "")
      .trim();
    const rawUrl = attr_(anchor.slice(0, anchor.indexOf(">") + 1), "href");
    const type =
      id === "firstpage"
        ? /\/light-novel/i.test(rawUrl)
          ? "LN (TH)"
          : /\/manga/i.test(rawUrl)
            ? "Manga (TH)"
            : ""
        : "";
    if (url && title && !categories.has(url))
      categories.set(url, { title: title, url: url, type: type });
  });
  return Array.from(categories.values()).sort(function (a, b) {
    return a.title.localeCompare(b.title);
  });
}

export function matchSeriesCategory_(series, categories, type) {
  categories = categories.filter(function (category) {
    return (
      !type ||
      !category.type ||
      category.type.split(" (")[0] === type.split(" (")[0]
    );
  });
  const key = catalogSeriesKey_(series);
  const exact = categories.filter(function (c) {
    return catalogSeriesKey_(c.title) === key;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // Several formats can share the same title.
  const slug = categories.filter(function (c) {
    return (
      catalogSeriesKey_(
        c.url
          .split("/")
          .pop()
          .replace(/\.html$/, ""),
      ) === key
    );
  });
  return slug.length === 1 ? slug[0] : null;
}

export function catalogTotal_(id, html) {
  const pattern =
    id === "phoenix"
      ? /<span\b[^>]*class=["'][^"']*\btoolbar-number\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i
      : /<span\b[^>]*class=["'][^"']*\btsk-all\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i;
  // Phoenix shows the first item, last item and total in separate toolbar spans.
  const matches = [...html.matchAll(new RegExp(pattern.source, "gi"))];
  return matches.length
    ? Math.max(...matches.map((match) => Number(match[1].replace(/,/g, ""))))
    : null;
}

export function luckpimItem_(book) {
  if (!/^\d+$/.test(String(book.slug))) return null;
  const type = /นิยาย|novel/i.test(book.main_category || "")
    ? "LN (TH)"
    : /มังงะ|การ์ตูน/i.test(book.main_category || "")
      ? "Manga (TH)"
      : "";
  const item = releaseItem_(
    "luckpim",
    book.title,
    "https://www.luckpim.com/product/detail/" + book.slug,
    book.price_sale == null ? book.price : book.price_sale,
    "",
    type,
  );
  item.availability =
    book.pre_order === "T"
      ? "Pre-order"
      : Number(book.stock) > 0
        ? "In stock"
        : "Check availability";
  const gen = String(book.thumbnail_gen || "");
  if (/^[a-z0-9]{5,}$/i.test(gen) && book.thumbnail) {
    const filename = String(book.thumbnail).replace(/\.[^.]+$/, ".webp");
    item.coverUrl = safeCoverUrl_(
      "https://www.luckpim.com/stocks/product/d284x400/" +
        gen.slice(4, 6) +
        "/" +
        gen.slice(6, 8) +
        "/" +
        gen +
        "/" +
        encodeURIComponent(filename),
    );
  }
  return item;
}

export function cleanRelease_(input) {
  input = input || {};
  const p = PUBLISHERS.find(function (p) {
    return p.id === input.publisherId;
  });
  const url = safeProductUrl_(input.url, p && p.id);
  if (!p || !url || !String(input.title || "").trim())
    throw new Error(
      "This release is missing its publisher or book page. Refresh releases.",
    );
  const item = releaseItem_(
    p.id,
    String(input.title).slice(0, 500),
    url,
    input.price,
    input.isbn,
    input.type,
  );
  item.series = String(input.series || item.series).slice(0, 500);
  item.volume =
    input.volume === "" || input.volume === undefined
      ? item.volume
      : Number(input.volume);
  if (item.volume !== "" && (!Number.isFinite(item.volume) || item.volume < 0))
    throw new Error("Invalid release volume.");
  item.availability = String(input.availability || "").slice(0, 100);
  item.coverUrl = safeCoverUrl_(input.coverUrl);
  if (input.catalogSeries)
    item.catalogSeries = String(input.catalogSeries).slice(0, 500);
  if (input.catalogVariant) item.catalogVariant = true;
  return item;
}

export function safeProductUrl_(raw, id) {
  const url = decodeHtml_(String(raw || ""));
  const patterns = {
    phoenix: /^https:\/\/www\.phoenixnext\.com\/[a-zA-Z0-9_-]+\.html$/,
    firstpage:
      /^https:\/\/www\.firstpagepro\.com\/product\/(\d+)(?:\/[^?#]*)?$/,
    luckpim: /^https:\/\/www\.luckpim\.com\/product\/detail\/\d+\/?$/,
  };
  if (!patterns[id] || !patterns[id].test(url)) return "";
  if (id === "firstpage")
    return "https://www.firstpagepro.com/product/" + url.match(patterns[id])[1];
  return url.replace(/\/$/, "");
}

export function releaseItem_(id, title, url, price, isbn, type) {
  const parsed = splitBookTitle_(title);
  const special =
    /(?:special|complete|ultimate)(?:\s+combo)?\s*(?:set|edition)|box\s*set|limited|เซต|ชุด|ฉบับพิเศษ|ปกพิเศษ/i.test(
      title,
    );
  const p = PUBLISHERS.find(function (p) {
    return p.id === id;
  });
  return {
    id: id + ":" + digest_(url),
    publisherId: id,
    publisher: p.name,
    title: decodeHtml_(title),
    series: parsed.series,
    volume: parsed.volume,
    type: type || parsed.type,
    url: url,
    isbn: special ? "" : canonicalIsbn_(isbn) || "",
    price:
      price !== "" &&
      price !== null &&
      price !== undefined &&
      Number.isFinite(Number(price)) &&
      Number(price) >= 0
        ? Number(price)
        : "",
    special: special,
    bundle: releaseBundle_(title),
    availability: "",
  };
}

export function splitBookTitle_(raw) {
  let title = decodeHtml_(String(raw || ""))
    .replace(/\s+/g, " ")
    .trim();
  const type = /\(LN\)|\(นิยาย\)|^นิยาย|light\s*novel|ไลท์โนเวล/i.test(title)
    ? "LN (TH)"
    : /มังงะ|การ์ตูน|@COMIC|\(Mg\)/i.test(title)
      ? "Manga (TH)"
      : "";
  title = title
    .replace(/^\[PRE-ORDER\]\s*/i, "")
    .replace(/^(?:\(LN\)|\(มังงะ\)|\(นิยาย\)|นิยาย|การ์ตูน)\s*/i, "");
  const explicit = /(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*(\d+(?:\.\d+)?)/i.exec(
    title,
  );
  // Luckpim also uses bare volume numbers before ending/format labels or promotions.
  const suffix =
    /\s+(\d+(?:\.\d+)?)(?=\s*(?:$|(?:\([^)]*\)\s*)+$|\[|แถม|ฟรี|พร้อม))/i.exec(
      title,
    );
  const match = explicit || suffix;
  let series = match
    ? title.slice(0, match.index).trim()
    : title.replace(/\s*\((?:Mg|LN)\)\s*$/i, "").trim();
  series = bookSeriesTitle_(series.replace(/\s*[-–:]\s*$/, ""));
  return { series: series, volume: match ? Number(match[1]) : "", type: type };
}

export function parseCatalog_(id, html) {
  const items = [];
  // Images precede the title anchor on Phoenix. Associate them by product URL,
  // rather than accidentally taking the next product's image from a title chunk.
  const covers = new Map();
  for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    const url = safeProductUrl_(
      attr_(anchor.slice(0, anchor.indexOf(">") + 1), "href"),
      id,
    );
    const img = /<img\b[^>]*>/i.exec(anchor);
    if (url && img) {
      const cover = safeCoverUrl_(
        attr_(img[0], "data-src") || attr_(img[0], "src"),
        url,
      );
      if (cover) covers.set(url, cover);
    }
  }
  const cards =
    id === "firstpage"
      ? html
          .split(
            /<div\b[^>]*class=["'][^"']*\bproductArea\b[^"']*\bproductItem\b[^"']*["'][^>]*>/i,
          )
          .slice(1)
      : html
          .split(/<a\b(?=[^>]*\bclass=["'][^"']*\bproduct-item-link\b)[^>]*>/i)
          .slice(1);
  const anchors =
    id === "phoenix"
      ? html.match(
          /<a\b(?=[^>]*\bclass=["'][^"']*\bproduct-item-link\b)[^>]*>/gi,
        ) || []
      : [];
  cards.forEach(function (card, index) {
    let title,
      url,
      price = "",
      isbn = "";
    if (id === "firstpage") {
      const anchor =
        /<a\b[^>]*class=["'][^"']*gadgetThumbnail[^"']*["'][^>]*>/i.exec(card);
      if (!anchor) return;
      title = attr_(anchor[0], "title");
      url = attr_(anchor[0], "href");
      const ga = attr_(anchor[0], "GAEEPD");
      try {
        price = JSON.parse(ga).price;
      } catch (e) {}
    } else {
      title = textHtml_(card.slice(0, card.indexOf("</a>")));
      url = attr_(anchors[index] || "", "href");
      const amount = /data-price-amount=["']([\d.]+)["']/i.exec(card);
      price = amount ? amount[1] : "";
      const code = /isbnet=(\d{13})/.exec(card);
      isbn = code ? code[1] : "";
    }
    url = safeProductUrl_(url, id);
    if (url && title)
      items.push({
        ...releaseItem_(id, title, url, price, isbn),
        coverUrl: covers.get(url) || "",
      });
  });
  return items;
}

export function names_(v) {
  return (Array.isArray(v) ? v : v ? [v] : [])
    .map(function (x) {
      return typeof x === "string" ? x : x.name || "";
    })
    .filter(Boolean)
    .join(", ");
}

export function structuredBooks_(html) {
  const out = [],
    re =
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  function visit(v) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (v.isbn || v.gtin13 || v.sku) out.push(v);
    if (v["@graph"]) visit(v["@graph"]);
  }
  let match;
  while ((match = re.exec(html))) {
    try {
      visit(JSON.parse(match[1]));
    } catch (e) {}
  }
  return out;
}

export function meta_(html, property) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find(function (t) {
    return attr_(t, "property") === property;
  });
  return tag ? attr_(tag, "content") : "";
}

export function attr_(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    "(?:^|\\s)" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
    "i",
  ).exec(tag);
  return match
    ? decodeHtml_(
        match[1] === undefined
          ? match[2] === undefined
            ? match[3]
            : match[2]
          : match[1],
      )
    : "";
}

export function decodeHtml_(s) {
  return String(s)
    .replace(/&#(x[\da-f]+|\d+);/gi, function (_, n) {
      const code =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function textHtml_(s) {
  return decodeHtml_(String(s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function digest_(text) {
  return createHash("sha256").update(text).digest("base64url");
}
