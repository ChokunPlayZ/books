import type { Release } from "../types.ts";
import { attr, textHtml, decodeHtml } from "./html.ts";
import { safePublisherTitleUrl, safeCoverUrl, safeProductUrl } from "./urls.ts";
import { catalogSeriesKey, splitBookTitle, releaseBundle } from "./titles.ts";
import { digest } from "./hash.ts";
import { PUBLISHERS } from "./constants.ts";
import { canonicalIsbn } from "./isbn.ts";

export function parsePublisherTitles(id, html, sourceUrl) {
  const candidates = new Map();
  for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    const tag = anchor.slice(0, anchor.indexOf(">") + 1),
      rawUrl = attr(tag, "href");
    const url = safePublisherTitleUrl(rawUrl, id);
    const title = textHtml(
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
    const key = catalogSeriesKey(entry.title);
    const existing = titles.get(key);
    if (existing) {
      existing.categories.push({ url: entry.url, type: entry.type });
      if (existing.type !== entry.type) existing.type = "";
    } else
      titles.set(key, {
        id: id + ":title:" + digest(key),
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

export function catalogTotal(id, html) {
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

export function luckpimItem(book) {
  if (!/^\d+$/.test(String(book.slug))) return null;
  const type = /นิยาย|novel/i.test(book.main_category || "")
    ? "LN (TH)"
    : /มังงะ|การ์ตูน/i.test(book.main_category || "")
      ? "Manga (TH)"
      : "";
  const item = releaseItem(
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
    item.coverUrl = safeCoverUrl(
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

export function cleanRelease(input) {
  input = input || {};
  const p = PUBLISHERS.find(function (p) {
    return p.id === input.publisherId;
  });
  const url = safeProductUrl(input.url, p && p.id);
  if (!p || !url || !String(input.title || "").trim())
    throw new Error(
      "This release is missing its publisher or book page. Refresh releases.",
    );
  const item = releaseItem(
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
  item.coverUrl = safeCoverUrl(input.coverUrl);
  if (input.catalogSeries)
    item.catalogSeries = String(input.catalogSeries).slice(0, 500);
  if (input.catalogVariant) item.catalogVariant = true;
  return item;
}

export function releaseItem(
  id,
  title,
  url,
  price,
  isbn,
  type?: string,
): Release {
  const parsed = splitBookTitle(title);
  const special =
    /(?:special|complete|ultimate)(?:\s+combo)?\s*(?:set|edition)|box\s*set|limited|เซต|ชุด|ฉบับพิเศษ|ปกพิเศษ/i.test(
      title,
    );
  const p = PUBLISHERS.find(function (p) {
    return p.id === id;
  });
  return {
    id: id + ":" + digest(url),
    publisherId: id,
    publisher: p.name,
    title: decodeHtml(title),
    series: parsed.series,
    volume: parsed.volume,
    type: type || parsed.type,
    url: url,
    isbn: special ? "" : canonicalIsbn(isbn) || "",
    price:
      price !== "" &&
      price !== null &&
      price !== undefined &&
      Number.isFinite(Number(price)) &&
      Number(price) >= 0
        ? Number(price)
        : "",
    special: special,
    bundle: releaseBundle(title),
    availability: "",
  };
}

export function parseCatalog(id, html) {
  const items = [];
  // Images precede the title anchor on Phoenix. Associate them by product URL,
  // rather than accidentally taking the next product's image from a title chunk.
  const covers = new Map();
  for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    const url = safeProductUrl(
      attr(anchor.slice(0, anchor.indexOf(">") + 1), "href"),
      id,
    );
    const img = /<img\b[^>]*>/i.exec(anchor);
    if (url && img) {
      const cover = safeCoverUrl(
        attr(img[0], "data-src") || attr(img[0], "src"),
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
      title = attr(anchor[0], "title");
      url = attr(anchor[0], "href");
      const ga = attr(anchor[0], "GAEEPD");
      try {
        price = JSON.parse(ga).price;
      } catch (e) {}
    } else {
      title = textHtml(card.slice(0, card.indexOf("</a>")));
      url = attr(anchors[index] || "", "href");
      const amount = /data-price-amount=["']([\d.]+)["']/i.exec(card);
      price = amount ? amount[1] : "";
      const code = /isbnet=(\d{13})/.exec(card);
      isbn = code ? code[1] : "";
    }
    url = safeProductUrl(url, id);
    if (url && title)
      items.push({
        ...releaseItem(id, title, url, price, isbn),
        coverUrl: covers.get(url) || "",
      });
  });
  return items;
}
