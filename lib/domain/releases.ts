import type { Release } from "../types.ts";
import { attr, textHtml, decodeHtml } from "./html.ts";
import { safePublisherTitleUrl, safeCoverUrl, safeProductUrl } from "./urls.ts";
import {
  catalogSeriesKey,
  splitBookTitle,
  splitFirstPageTitle,
  splitAnimagTitle,
  splitDexpressTitle,
  splitLilyHouseTitle,
  splitKodanshaTitle,
  releaseBundle,
} from "./titles.ts";
import { digest } from "./hash.ts";
import { PUBLISHERS } from "./constants.ts";
import { canonicalIsbn } from "./isbn.ts";
import { parsePageCount } from "./page-count.ts";
import { animagCategories, animagProducts, animagTotal } from "./animag.ts";
import { lnwProducts, lnwTotal } from "./lnwshop.ts";
import { lilyHousePage, lilyHouseTotal } from "./lilyhouse.ts";

export function parsePublisherTitles(id, html, sourceUrl) {
  if (id === "animag")
    return animagCategories(html, sourceUrl).map((category) => ({
      id: "animag:title:" + digest(category.url),
      publisherId: id,
      publisher: "Animag",
      series: category.title,
      title: category.title,
      type: category.type,
      url: category.url,
      categories: [{ url: category.url, type: category.type }],
      volume: "",
      isbn: "",
      coverUrl: "",
      directory: true,
    }));
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
  const entriesByTitle = [...titles.values()];
  return (
    id === "firstpage" ? splitFirstPageTitles(entriesByTitle) : entriesByTitle
  ).sort((a, b) => a.series.localeCompare(b.series));
}

// Also upgrades older cached directories that merged manga and novels by name.
export function splitFirstPageTitles<
  T extends {
    id: string;
    series: string;
    type: string;
    url: string;
    categories: { url: string; type?: string }[];
  },
>(titles: T[]): T[] {
  const entries = new Map<string, T>();
  for (const title of titles) {
    for (const category of title.categories) {
      const type = category.type || title.type || "";
      const key = catalogSeriesKey(title.series) + "\n" + type;
      if (!entries.has(key))
        entries.set(key, {
          ...title,
          id: "firstpage:title:" + digest(key),
          type,
          url: category.url,
          categories: [],
        });
      const entry = entries.get(key);
      if (!entry.categories.some((existing) => existing.url === category.url))
        entry.categories.push({ ...category, type });
    }
  }
  return [...entries.values()];
}

export function catalogTotal(id, html) {
  if (id === "lilyhouse") return lilyHouseTotal(html);
  if (id === "animag") return animagTotal(html);
  if (id === "dexpress") return lnwTotal(html);
  const pattern =
    id === "phoenix"
      ? /<span\b[^>]*class=["'][^"']*\btoolbar-number\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i
      : /<span\b[^>]*class=["'][^"']*\btsk-all\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i;
  // Phoenix shows the first item, last item and total in separate toolbar spans.
  const matches = [...html.matchAll(new RegExp(pattern.source, "gi"))];
  if (matches.length)
    return Math.max(
      ...matches.map((match) => Number(match[1].replace(/,/g, ""))),
    );
  // Empty Phoenix categories omit the toolbar and show this product-list message.
  if (
    id === "phoenix" &&
    (html.match(/<div\b[^>]*>/gi) || []).some((tag) => {
      const classes = attr(tag, "class").split(/\s+/);
      return ["message", "info", "empty"].every((name) =>
        classes.includes(name),
      );
    })
  )
    return 0;
  return null;
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
  const pageCount = parsePageCount(input.pageCount);
  if (pageCount !== "") item.pageCount = pageCount;
  if (p.id === "lilyhouse" && input.variantGroup) {
    item.variantGroup = true;
    item.special = true;
    item.isbn = "";
    item.volume = "";
  }
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
  const parsed =
    id === "kodansha"
      ? splitKodanshaTitle(title)
      : id === "firstpage"
        ? splitFirstPageTitle(title)
        : id === "animag"
          ? splitAnimagTitle(title)
          : id === "dexpress"
            ? splitDexpressTitle(title)
            : id === "lilyhouse"
              ? splitLilyHouseTitle(title)
              : splitBookTitle(title);
  const selectable = id === "dexpress" && /\?pid=\d+$/.test(url);
  const special =
    selectable ||
    /(?:special|complete|ultimate)(?:\s+combo)?\s*(?:set|edition)|box\s*set|limited|เซต|ชุด|ฉบับพิเศษ|ปกพิเศษ/i.test(
      title,
    ) ||
    (id === "dexpress" && /AUTOGRAPH\s+SET/i.test(title)) ||
    (id === "lilyhouse" &&
      /sprayed\s+edges|ปกนักแสดง|\bspecial\b/i.test(title)) ||
    (id === "kodansha" && /特装版|限定版|豪華版|セット|合本版/.test(title));
  const p = PUBLISHERS.find(function (p) {
    return p.id === id;
  });
  return {
    id: id + ":" + digest(url),
    publisherId: id,
    publisher: p.name,
    title: decodeHtml(title),
    series: parsed.series,
    volume: selectable ? "" : parsed.volume,
    type: selectable
      ? ""
      : id === "firstpage"
        ? parsed.type || type || ""
        : type || parsed.type,
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
    bundle:
      releaseBundle(title) ||
      (id === "lilyhouse" &&
        /(?:ชุด\s*\d+\s*เล่ม|\d+\s*เล่มจบ|\bset\b)/i.test(title)) ||
      (id === "dexpress" &&
        /AUTOGRAPH\s+SET|แพ(?:็ค|็ก|ค|ก)ชุด/i.test(title)) ||
      (id === "kodansha" && /セット|合本版/.test(title)),
    availability: "",
  };
}

export function parseCatalog(id, html, sourceUrl = "") {
  if (id === "lilyhouse")
    return lilyHousePage(html)
      .items.filter((item) => item.type)
      .map((item) => ({
        ...releaseItem(id, item.title, item.url, item.price, "", item.type),
        coverUrl: item.coverUrl,
        availability: item.availability,
        ...(item.variantGroup
          ? { variantGroup: true, special: true, volume: "" as const }
          : {}),
      }));
  if (id === "animag" || id === "dexpress") {
    const products = new Map(
      (id === "animag" ? animagProducts(html) : lnwProducts(html, id)).map(
        (product) => [safeProductUrl(product.url, id), product],
      ),
    );
    const page = id === "dexpress" && sourceUrl ? new URL(sourceUrl) : null;
    const category =
      page &&
      (/^\/category\/(\d+)/.exec(page.pathname)?.[1] ||
        page.searchParams.get("category_id"));
    const categoryType =
      category === "2" ? "Manga (TH)" : category === "3" ? "LN (TH)" : "";
    const items = [];
    for (const card of html
      .split(
        /<div\b(?=[^>]*class=["'][^"']*\bproductArea\b)(?=[^>]*class=["'][^"']*\bproductItem\b)[^>]*>/i,
      )
      .slice(1)) {
      const anchor =
        /<a\b[^>]*class=["'][^"']*\bgadgetThumbnail\b[^"']*["'][^>]*>/i.exec(
          card,
        );
      if (!anchor) continue;
      const url = safeProductUrl(attr(anchor[0], "href"), id);
      const product = products.get(url);
      const title = attr(anchor[0], "title");
      if (
        !url ||
        !title ||
        (id === "animag" &&
          !/\b(?:NOVEL|COMIC|MANGA|Animag)\b|นิยาย|การ์ตูน|ไลท์โนเวล/i.test(
            title,
          ))
      )
        continue;
      const priceTag =
        /<div\b[^>]*class=["'][^"']*\bproduct_price\b[^"']*["'][^>]*>/i.exec(
          card,
        )?.[0];
      const code =
        /<span\b[^>]*class=["']code["'][^>]*>([\s\S]*?)<\/span>/i.exec(
          card,
        )?.[1];
      const img = /<img\b[^>]*>/i.exec(card)?.[0] || "";
      const offer = Array.isArray(product?.offers)
        ? product.offers[0]
        : product?.offers;
      const item = releaseItem(
        id,
        title,
        url,
        priceTag ? attr(priceTag, "realprice") : offer?.price,
        product?.sku || textHtml(code || ""),
        categoryType,
      );
      if (/เลือกแบบสินค้า/.test(card)) item.variantGroup = true;
      item.coverUrl = safeCoverUrl(
        (Array.isArray(product?.image) ? product.image[0] : product?.image) ||
          attr(img, "data-src") ||
          attr(img, "src"),
        url,
      );
      item.availability = /พรีออ(?:ร์)?เดอร์|PRE[- ]?ORDER/i.test(title)
        ? "Pre-order"
        : /สินค้าหมด|OutOfStock/i.test(card + (offer?.availability || ""))
          ? "Out of stock"
          : /btn-add_to_cart|InStock/.test(card + (offer?.availability || ""))
            ? "In stock"
            : "Check availability";
      items.push(item);
    }
    return items;
  }
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

export function animagVariants(html: string, parentUrl: string) {
  const parent = safeProductUrl(parentUrl, "animag");
  if (!parent || new URL(parent).search) return [];
  return animagProducts(html).flatMap((product) => {
    const url = safeProductUrl(product.url, "animag");
    if (!url.startsWith(parent + "?pid=") || !textHtml(product.name || ""))
      return [];
    const offer = Array.isArray(product.offers)
      ? product.offers[0]
      : product.offers;
    const item = releaseItem(
      "animag",
      product.name,
      url,
      offer?.price,
      product.isbn || product.gtin13 || product.gtin || product.sku,
    );
    const pageCount = parsePageCount(product.numberOfPages);
    if (pageCount !== "") item.pageCount = pageCount;
    item.coverUrl = safeCoverUrl(
      Array.isArray(product.image) ? product.image[0] : product.image,
      url,
    );
    item.availability = /พรีออ(?:ร์)?เดอร์|PRE[- ]?ORDER/i.test(item.title)
      ? "Pre-order"
      : /OutOfStock/.test(offer?.availability || "")
        ? "Out of stock"
        : /InStock/.test(offer?.availability || "")
          ? "In stock"
          : "Check availability";
    return [item];
  });
}
