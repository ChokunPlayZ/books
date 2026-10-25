import { safeProductUrl } from "./urls.ts";

// CollectionPage listings are distinct from unrelated product recommendations.
export function lnwProducts(html: string, publisherId: string) {
  const products = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const visit = (value) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(visit);
        if (value["@type"] === "Product") products.push(value);
        if (
          value["@type"] === "CollectionPage" &&
          value.mainEntity?.["@type"] === "ItemList"
        )
          for (const entry of value.mainEntity.itemListElement || [])
            if (entry.item?.["@type"] === "Product") products.push(entry.item);
        if (value["@graph"]) visit(value["@graph"]);
      };
      visit(JSON.parse(match[1]));
    } catch {}
  }
  return products.filter((product) => safeProductUrl(product.url, publisherId));
}

export function lnwTotal(html: string) {
  // Category pagination also has tsk-all; only the product count is relevant.
  const match =
    /แสดง(?:สินค้า|ชิ้น)ที่\s*[\d,]+\s*-\s*[\d,]+\s*จากทั้งหมด\s*<span\b[^>]*class=["'][^"']*\btsk-all\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i.exec(
      html,
    );
  return match ? Number(match[1].replace(/,/g, "")) : null;
}
