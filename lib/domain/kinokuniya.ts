import { attr, names, structuredBooks, textHtml } from "./html.ts";
import { canonicalIsbn } from "./isbn.ts";
import { safeCoverUrl } from "./urls.ts";
import { splitBookTitle } from "./titles.ts";

export function kinokuniyaBook(html: string, isbn: string) {
  const fields = new Map<string, string>();
  for (const field of html.matchAll(
    /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
  ))
    fields.set(textHtml(field[1]).toLowerCase(), textHtml(field[2]));

  const statedIsbn = canonicalIsbn(fields.get("isbn"));
  if (!statedIsbn) throw new Error("Kinokuniya book ISBN unavailable.");
  if (statedIsbn !== isbn) return null;
  const url = "https://kinokuniya.co.th/products/" + isbn;
  // Recommendations must not supply another product's title or image.
  const product = structuredBooks(html).find((book) => {
    try {
      return (
        new URL(book.url, url).href === url &&
        [book.isbn, book.gtin, book.gtin13].some(
          (code) => canonicalIsbn(code) === isbn,
        )
      );
    } catch {
      return false;
    }
  });
  if (!product?.name) throw new Error("Kinokuniya book markup changed.");
  if (fields.get("item type")?.toLowerCase() !== "book") return null;

  const authors = new Set<string>();
  for (const link of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = link[0].slice(0, link[0].indexOf(">") + 1);
    if (attr(tag, "class").split(/\s+/).includes("product-meta__author-link"))
      authors.add(textHtml(link[0]));
  }
  const title = textHtml(product.name);
  const { series, volume } = splitBookTitle(title);
  const offer = Array.isArray(product.offers)
    ? product.offers[0]
    : product.offers;
  const price = offer?.price === "" ? NaN : Number(offer?.price ?? NaN);
  return {
    isbn,
    title,
    series,
    volume,
    // This multilingual store's titles alone do not establish the edition language.
    type: "",
    publisher: fields.get("publisher") || names(product.brand),
    authors: [...authors].filter(Boolean).join(", "),
    releaseDate: fields.get("publication date") || "",
    source: "Kinokuniya",
    price: Number.isFinite(price) && price >= 0 ? price : "",
    url,
    coverUrl: safeCoverUrl(product.image, url),
  };
}
