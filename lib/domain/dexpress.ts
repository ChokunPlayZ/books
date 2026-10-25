import { canonicalIsbn } from "./isbn.ts";
import { safeCoverUrl, safeProductUrl } from "./urls.ts";
import { releaseItem } from "./releases.ts";

type DexpressProduct = {
  id: string;
  full_url: string;
  name: string;
  barcode?: string;
  isbn?: string;
  has_sub?: number;
  category_id?: string;
  price?: number;
  price_old?: number;
  images?: string[];
  status?: { preorder?: number; soldout?: number; instock?: number };
};

export function dexpressProduct(html: string, productUrl: string) {
  const url = safeProductUrl(productUrl, "dexpress");
  if (!url) throw new Error("Invalid DEXpress product URL.");
  // Parse the storefront's JSON data literal, never execute its scripts. Only
  // the main product with this ID and URL can supply its barcode or gallery.
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const match = /\bvar\s+payload\s*=\s*(\{[^\r\n]*\})\s*;/.exec(script[1]);
    if (!match) continue;
    try {
      const data: DexpressProduct = JSON.parse(match[1]).pdata;
      if (
        !data ||
        String(data.id) !== url.split("/").pop() ||
        safeProductUrl(data.full_url, "dexpress") !== url ||
        typeof data.name !== "string" ||
        !data.name.trim()
      )
        continue;
      // Parent barcodes and images must not be assigned to selectable variants.
      if (data.has_sub)
        throw new Error("DEXpress product variants require review.");
      const type =
        String(data.category_id) === "2"
          ? "Manga (TH)"
          : String(data.category_id) === "3"
            ? "LN (TH)"
            : "";
      const item = releaseItem(
        "dexpress",
        data.name,
        url,
        data.price,
        canonicalIsbn(data.barcode) || canonicalIsbn(data.isbn),
        type,
      );
      item.coverUrl = safeCoverUrl(
        Array.isArray(data.images) ? data.images[0] : "",
        url,
      );
      item.availability = data.status?.preorder
        ? "Pre-order"
        : data.status?.soldout
          ? "Out of stock"
          : data.status?.instock
            ? "In stock"
            : "Check availability";
      return { item, data };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error("DEXpress product details could not be read.");
}
