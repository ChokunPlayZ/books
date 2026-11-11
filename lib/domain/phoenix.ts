import { canonicalIsbn } from "./isbn.ts";
import { meta, structuredBooks, textHtml } from "./html.ts";
import { releaseItem } from "./releases.ts";
import { safeProductUrl, originalCoverUrl } from "./urls.ts";
import { parsePageCount } from "./page-count.ts";
import { money, productMsrp } from "./msrp.ts";
import { htmlPublicationFacts } from "./series-sources.ts";

function phoenixPriceHtml(html: string) {
  // Hyvä's main product uses initPrice<ID>(); recommendation cards use
  // initPriceBox(). Keep their list prices out of this edition's metadata.
  const start = /<div\b[^>]*\bx-data=["']initPrice\d+\(\)["'][^>]*>/i.exec(
    html,
  );
  if (!start) return "";
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start.index + start[0].length;
  let depth = 1;
  for (let tag; (tag = tags.exec(html));) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (!depth) return html.slice(start.index, tags.lastIndex);
  }
  return "";
}

function phoenixMsrp(html: string, product?: Record<string, any>) {
  const priceHtml = phoenixPriceHtml(html);
  // Older Magento markup exposes data-price-type="oldPrice" directly.
  const explicit = productMsrp(priceHtml || html, product);
  if (explicit !== "") return explicit;
  const oldPrice =
    /<(div|span)\b(?=[^>]*\bclass=["'][^"']*\bold-price\b)[^>]*>([\s\S]*?)<\/\1>/i.exec(
      priceHtml,
    )?.[2];
  return money(/^฿\s*([\d,]+(?:\.\d+)?)$/.exec(textHtml(oldPrice || ""))?.[1]);
}

// Read the main product's labeled barcode, never a recommendation's ISBN.
export function phoenixBook(html: string, isbn: string, productUrl: string) {
  const url = safeProductUrl(productUrl, "phoenix");
  if (!url || (isbn && !canonicalIsbn(isbn))) return null;
  const barcodes = [
    ...html.matchAll(
      /<div\b(?=[^>]*\bdata-th=["'](?:Barcode|ISBN)["'])[^>]*>([\s\S]*?)<\/div>/gi,
    ),
  ].map((match) => canonicalIsbn(textHtml(match[1])));
  const metadataIsbn = canonicalIsbn(meta(html, "book:isbn"));
  const codes = [...new Set([...barcodes, metadataIsbn].filter(Boolean))];
  // A title-only lookup may learn the ISBN, but conflicting edition barcodes
  // must never be resolved by simply picking the first one.
  const canonical = canonicalIsbn(isbn) || (codes.length === 1 ? codes[0] : "");
  if (!barcodes.some(Boolean) && !metadataIsbn)
    throw new Error(
      "Phoenix product ISBN details are unavailable. Try again later.",
    );
  if (!barcodes.includes(canonical) && metadataIsbn !== canonical) return null;
  if (!canonical) return null;
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
  const facts = htmlPublicationFacts(html, "Phoenix Next", url, false);
  return {
    ...releaseItem(
      "phoenix",
      title,
      url,
      meta(html, "product:price:amount"),
      canonical,
    ),
    isbn: canonical,
    isbnVerified: true,
    pageCount: parsePageCount(product?.numberOfPages),
    currency: meta(html, "product:price:currency") || "THB",
    msrp: phoenixMsrp(html, product),
    msrpCurrency: meta(html, "product:price:currency") || "THB",
    availability:
      meta(html, "product:availability") ||
      offer?.availability ||
      facts.find((fact) => /^StockStatus$/i.test(fact.label))?.value ||
      "",
    coverUrl: originalCoverUrl(meta(html, "og:image")),
    facts,
  };
}
