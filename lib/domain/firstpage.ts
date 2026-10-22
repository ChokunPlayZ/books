import { canonicalIsbn } from "./isbn.ts";
import { meta, names, structuredBooks, textHtml } from "./html.ts";
import { releaseItem } from "./releases.ts";
import { safeCoverUrl, safeProductUrl } from "./urls.ts";

export function firstPageBook(html: string, isbn: string, productUrl: string) {
  const canonical = canonicalIsbn(isbn);
  const url = safeProductUrl(productUrl, "firstpage");
  if (!canonical || !url) return null;
  // First Page stores the barcode as the product SKU. Match the product URL
  // before reading it so recommendations cannot supply another book's ISBN.
  const product = structuredBooks(html).find(
    (book) => safeProductUrl(book.url, "firstpage") === url,
  );
  const codes = product
    ? [product.isbn, product.gtin13, product.gtin, product.sku].map(
        canonicalIsbn,
      )
    : [];
  if (!codes.some(Boolean))
    throw new Error("First Page Pro product ISBN details are unavailable.");
  if (!codes.includes(canonical)) return null;
  const title = textHtml(product.name || "");
  if (!title) throw new Error("First Page Pro product details changed.");
  const offer = Array.isArray(product.offers)
    ? product.offers[0]
    : product.offers;
  const item = releaseItem("firstpage", title, url, offer?.price, canonical);
  if (!item.isbn || item.bundle) return null;
  return {
    ...item,
    authors: names(product.author),
    source: "First Page Pro",
    coverUrl: safeCoverUrl(
      (Array.isArray(product.image) ? product.image[0] : product.image) ||
        meta(html, "og:image"),
      url,
    ),
  };
}
