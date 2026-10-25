import { attr, structuredBooks, textHtml } from "./html.ts";
import { canonicalIsbn } from "./isbn.ts";
import { safeCoverUrl, safeProductUrl } from "./urls.ts";

export const LILY_HOUSE = "https://lily-house.com";

function bookType(classes: string, title: string) {
  if (/\bproduct_cat-merch\b/.test(classes)) return "";
  const language =
    /\bproduct_cat-english-book\b/.test(classes) ||
    /\(English (?:Version|Edition)\)/i.test(title)
      ? "EN"
      : "TH";
  if (
    /\bproduct_cat-manga\b/.test(classes) ||
    /^\s*(?:\(PRE[^)]*\)\s*)?\(COMIC\)/i.test(title)
  )
    return "Manga (" + language + ")";
  if (/\bproduct_cat-(?:novel|english-book)\b/.test(classes))
    return "LN (" + language + ")";
  return "";
}

function availability(value: string) {
  return /outofstock|OutOfStock/.test(value)
    ? "Out of stock"
    : /onbackorder|BackOrder|PreOrder|product_cat-pre-order|\(PRE(?:[- ]?ORDER)?\)/i.test(
          value,
        )
      ? "Pre-order"
      : /\binstock\b|InStock/.test(value)
        ? "In stock"
        : "Check availability";
}

export function lilyHousePage(html: string) {
  const list =
    /<ul\b[^>]*class=["'][^"']*\bproducts\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(
      html,
    );
  const cards = (list?.[1] || "").match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
  const products = cards.filter((card) =>
    /\btype-product\b/.test(
      attr(card.slice(0, card.indexOf(">") + 1), "class"),
    ),
  );
  const items = products.flatMap((card) => {
    const heading =
      /<h2\b[^>]*class=["'][^"']*\bwoocommerce-loop-product__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i.exec(
        card,
      );
    const title = heading ? textHtml(heading[1]) : "";
    const anchor = heading && /<a\b[^>]*>/i.exec(heading[1]);
    const url = safeProductUrl(
      anchor ? attr(anchor[0], "href") : "",
      "lilyhouse",
    );
    if (!url || !title) return [];
    const classes = attr(card.slice(0, card.indexOf(">") + 1), "class");
    const image = (card.match(/<img\b[^>]*>/gi) || []).find((tag) =>
      /\battachment-woocommerce_thumbnail\b/.test(attr(tag, "class")),
    );
    const amounts = [...card.matchAll(/<bdi\b[^>]*>([\s\S]*?)<\/bdi>/gi)];
    const amount = amounts.at(-1);
    const price = /\bproduct-type-variable\b/.test(classes)
      ? ""
      : amount
        ? textHtml(amount[1]).replace(/[^\d.]/g, "")
        : "";
    return [
      {
        title,
        url,
        price,
        type: bookType(classes, title),
        coverUrl: image
          ? safeCoverUrl(attr(image, "data-src") || attr(image, "src"), url)
          : "",
        availability: availability(classes + " " + title),
        variantGroup: /\bproduct-type-variable\b/.test(classes),
      },
    ];
  });
  const empty = /\bwoocommerce-no-products-found\b/.test(html);
  return {
    items,
    count: products.length,
    valid: !!list && products.length > 0 && products.length === items.length,
    empty,
  };
}

export function lilyHouseTotal(html: string) {
  if (/\bwoocommerce-no-products-found\b/.test(html)) return 0;
  const count =
    /<[^>]*class=["'][^"']*\bwoocommerce-result-count\b[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(
      html,
    );
  if (!count) return null;
  const text = textHtml(count[1]);
  const total =
    /(?:of|ทั้งหมด)\s*([\d,]+)/i.exec(text) ||
    /(?:Showing all|แสดงทั้งหมด)\s*([\d,]+)/i.exec(text) ||
    /^(?:Showing|แสดง)\s*(1)\s+(?:result|รายการ)/i.exec(text);
  return total ? Number(total[1].replace(/,/g, "")) : null;
}

export function lilyHousePageUrl(raw: string, page: number) {
  const url = new URL(raw);
  if (page > 1)
    url.pathname = url.pathname.replace(/\/$/, "") + "/page/" + page + "/";
  return url.href;
}

export function lilyHousePagination(html: string, base: string, page: number) {
  const nav =
    /<nav\b[^>]*class=["'][^"']*\bwoocommerce-pagination\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i.exec(
      html,
    );
  if (!nav) return { next: false, terminal: true };
  let last = page,
    next = false,
    valid = false;
  for (const tag of nav[1].match(/<(?:a|span)\b[^>]*>/gi) || []) {
    const classes = attr(tag, "class");
    if (/\bcurrent\b/.test(classes)) {
      const at = nav[1].indexOf(tag) + tag.length;
      valid =
        Number(textHtml(nav[1].slice(at, nav[1].indexOf("<", at)))) === page;
    }
    if (!/^<a\b/i.test(tag)) continue;
    try {
      const url = new URL(attr(tag, "href"), base);
      const number = /\/page\/(\d+)\/$/.exec(url.pathname);
      if (!number) continue;
      const n = Number(number[1]);
      if (url.href !== lilyHousePageUrl(base, n)) continue;
      last = Math.max(last, n);
      if (n === page + 1) next = true;
    } catch {}
  }
  return {
    next,
    terminal: valid && last === page && !/\bnext\s+page-numbers\b/.test(nav[1]),
  };
}

export function lilyHouseProduct(html: string, raw: string) {
  const url = safeProductUrl(raw, "lilyhouse");
  const data = structuredBooks(html).find(
    (product) =>
      ["Product", "Book"].includes(product["@type"]) &&
      safeProductUrl(product.url, "lilyhouse") === url,
  );
  const tag = (html.match(/<div\b[^>]*>/gi) || []).find((tag) =>
    /^product-\d+$/.test(attr(tag, "id")),
  );
  if (!url || !data || !tag || !textHtml(data.name || ""))
    throw new Error("Lily House product details could not be read.");
  const title = textHtml(data.name);
  const classes = attr(tag, "class");
  const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
  const covers = (Array.isArray(data.image) ? data.image : [data.image])
    .map((image) => safeCoverUrl(image, url))
    .filter(Boolean);
  // Product schema identifies the main book. Gallery images require that same
  // product's gallery scope; badges and recommendation images are excluded.
  const galleryTail = html.split(
    /<div\b[^>]*class=["'][^"']*\bwoocommerce-product-gallery__wrapper\b[^"']*["'][^>]*>/i,
  )[1];
  const galleryEnd =
    galleryTail?.search(
      /<div\b[^>]*class=["'][^"']*\bproduct-information\b/i,
    ) ?? -1;
  const gallery = galleryEnd >= 0 ? galleryTail.slice(0, galleryEnd) : "";
  for (const img of gallery.match(/<img\b[^>]*>/gi) || []) {
    if (/\bgtmpb-image\b/.test(attr(img, "class"))) continue;
    const image = safeCoverUrl(attr(img, "data-large_image"), url);
    if (image) covers.push(image);
  }
  return {
    title,
    url,
    type: bookType(classes, title),
    isbn:
      [data.isbn, data.gtin13, data.gtin].map(canonicalIsbn).find(Boolean) ||
      "",
    price: offer?.price ?? "",
    availability: availability(
      classes + " " + (offer?.availability || "") + " " + title,
    ),
    coverUrl: covers[0] || "",
    covers: [...new Set<string>(covers)],
    variantGroup: /\bproduct-type-variable\b/.test(classes),
  };
}
