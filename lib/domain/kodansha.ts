import { attr, meta, textHtml } from "./html.ts";
import { canonicalIsbn } from "./isbn.ts";
import { releaseItem } from "./releases.ts";
import { safeCoverUrl, safeProductUrl } from "./urls.ts";
import type { Release } from "../types.ts";
import { parsePageCount } from "./page-count.ts";

export const KODANSHA = "https://www.kodansha.co.jp";
export const KODANSHA_RELEASES = KODANSHA + "/comic/new-releases/p";

export function kodanshaCover(raw: string, productUrl: string) {
  const cover = safeCoverUrl(raw);
  return cover &&
    new URL(cover).hostname === "dvs-cover.kodansha.co.jp" &&
    new URL(cover).pathname.split("/")[1] === productUrl.split("/").pop()
    ? cover
    : "";
}

export function kodanshaListings(html: string) {
  const items = new Map<string, Release>();
  let cards = 0;
  for (const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const anchor = match[0];
    const tag = anchor.slice(0, anchor.indexOf(">") + 1);
    if (!attr(tag, "class").split(/\s+/).includes("app-product-list-item"))
      continue;
    cards++;
    const url = safeProductUrl(attr(tag, "href"), "kodansha");
    const title = textHtml(
      /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(anchor)?.[1] || "",
    );
    if (!url || !title)
      throw new Error("Kodansha listing identity unavailable.");
    if (/電子のみ/.test(textHtml(anchor))) continue;
    const item = releaseItem(
      "kodansha",
      title,
      url,
      "",
      "",
      url.includes("/book/") ? "Other" : undefined,
    );
    item.coverUrl = kodanshaCover(
      attr(/<img\b[^>]*>/i.exec(anchor)?.[0] || "", "src"),
      url,
    );
    items.set(url, item);
  }
  const total = /(?:全\s*)?([\d,]+)\s*件/.exec(
    textHtml(html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] || html),
  );
  if (!cards && (!total || Number(total[1].replaceAll(",", "")) !== 0))
    throw new Error("Kodansha listings unavailable.");
  return {
    items: [...items.values()],
    cards,
    total: total ? Number(total[1].replaceAll(",", "")) : null,
  };
}

export function kodanshaSeriesHeading(html: string) {
  const main = /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0] || "";
  const title = textHtml(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(main)?.[1] || "");
  const total = /全\s*([\d,]+)\s*件/.exec(textHtml(main));
  if (!title || !total) throw new Error("Kodansha series markup changed.");
  return { title, total: Number(total[1].replaceAll(",", "")) };
}

export function kodanshaSeriesPage(data: unknown) {
  const page = data as {
    products?: Record<string, unknown>[];
    productsCount?: number;
  };
  if (
    !Array.isArray(page?.products) ||
    page.productsCount !== 18 ||
    page.products.length > 19
  )
    throw new Error("Kodansha series response changed.");
  const more = page.products.length === 19;
  const records = page.products.slice(0, 18);
  const ids: string[] = [];
  const items = records.flatMap((record) => {
    const url = safeProductUrl(
      KODANSHA + "/" + record.category + "/products/" + record.product_code,
      "kodansha",
    );
    if (
      !url ||
      typeof record.name !== "string" ||
      !record.name.trim() ||
      !["pbook", "mixed", "ebook"].includes(String(record.state))
    )
      throw new Error("Kodansha product identity unavailable.");
    ids.push(url);
    if (record.state === "ebook") return [];
    const item = releaseItem(
      "kodansha",
      record.name,
      url,
      "",
      "",
      record.category === "book" ? "Other" : undefined,
    );
    item.coverUrl = kodanshaCover(String(record.imageUrl || ""), url);
    return [item];
  });
  return { items, ids, more };
}

export function kodanshaBook(html: string, rawIsbn: string, rawUrl: string) {
  const url = safeProductUrl(rawUrl, "kodansha");
  if (!url || safeProductUrl(meta(html, "og:url"), "kodansha") !== url)
    throw new Error("Kodansha book identity unavailable.");
  const isbn = canonicalIsbn(meta(html, "books:isbn"));
  if (!isbn) throw new Error("Kodansha print ISBN unavailable.");
  if (rawIsbn && canonicalIsbn(rawIsbn) !== isbn) return null;
  const main = /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0] || "";
  const title = textHtml(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(main)?.[1] || "");
  const print = /<h4\b[^>]*>\s*紙版\s*<\/h4>([\s\S]*?)(?=<h4\b|$)/i.exec(
    main,
  )?.[1];
  const fields = new Map(
    [
      ...(print || "").matchAll(
        /<h5\b[^>]*>([\s\S]*?)<\/h5>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi,
      ),
    ].map((match) => [textHtml(match[1]), textHtml(match[2])]),
  );
  if (!title || canonicalIsbn(fields.get("ISBN")) !== isbn)
    throw new Error("Kodansha print edition unavailable.");
  const item = releaseItem(
    "kodansha",
    title,
    url,
    "",
    isbn,
    url.includes("/book/") ? "Other" : undefined,
  );
  const authorsHtml = main.slice(
    main.indexOf("</h1>"),
    main.indexOf("</ul>", main.indexOf("</h1>")),
  );
  const authors = [
    ...authorsHtml.matchAll(
      /<a\b[^>]*href=["'][^"']*\/products\/search\?[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ].map((match) => textHtml(match[1]));
  const date = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(
    fields.get("発売日") || "",
  );
  return {
    ...item,
    isbn,
    source: "Kodansha JP",
    pageCount: parsePageCount(fields.get("ページ数")),
    authors: [...new Set(authors)].join(", "),
    releaseDate: date
      ? `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`
      : "",
    coverUrl: kodanshaCover(meta(html, "og:image"), url),
  };
}
