import { canonicalIsbn } from "./isbn.ts";
import { meta, structuredBooks, textHtml } from "./html.ts";
import { releaseItem } from "./releases.ts";
import { safeProductUrl, safeCoverUrl } from "./urls.ts";

// Read the main product's labeled barcode, never a recommendation's ISBN.
export function phoenixBook(html: string, isbn: string, productUrl: string) {
  const canonical = canonicalIsbn(isbn);
  const url = safeProductUrl(productUrl, "phoenix");
  if (!canonical || !url) return null;
  const barcodes = [
    ...html.matchAll(
      /<div\b(?=[^>]*\bdata-th=["'](?:Barcode|ISBN)["'])[^>]*>([\s\S]*?)<\/div>/gi,
    ),
  ].map((match) => canonicalIsbn(textHtml(match[1])));
  const metadataIsbn = canonicalIsbn(meta(html, "book:isbn"));
  if (!barcodes.some(Boolean) && !metadataIsbn)
    throw new Error(
      "Phoenix product ISBN details are unavailable. Try again later.",
    );
  if (!barcodes.includes(canonical) && metadataIsbn !== canonical) return null;
  const title = textHtml(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || meta(html, "og:title"),
  );
  if (!title) throw new Error("Phoenix product details changed.");
  const product = structuredBooks(html).find(
    (book) => safeProductUrl(book.url, "phoenix") === url,
  );
  const offer = Array.isArray(product?.offers)
    ? product.offers[0]
    : product?.offers;
  return {
    ...releaseItem(
      "phoenix",
      title,
      url,
      meta(html, "product:price:amount"),
      canonical,
    ),
    isbn: canonical,
    currency: meta(html, "product:price:currency") || "THB",
    availability:
      meta(html, "product:availability") || offer?.availability || "",
    coverUrl: safeCoverUrl(meta(html, "og:image")),
  };
}
