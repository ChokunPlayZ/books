import { canonicalIsbn } from "./isbn.ts";
import { meta, textHtml } from "./html.ts";
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
  return {
    ...releaseItem(
      "phoenix",
      title,
      url,
      meta(html, "product:price:amount"),
      canonical,
    ),
    isbn: canonical,
    coverUrl: safeCoverUrl(meta(html, "og:image")),
  };
}
