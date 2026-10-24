import { attr, textHtml } from "./html.ts";
import { safeProductUrl } from "./urls.ts";

// CollectionPage's ItemList is distinct from unrelated JSON-LD recommendations.
export function animagProducts(html: string) {
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
  return products.filter((product) => safeProductUrl(product.url, "animag"));
}

export function animagTotal(html: string) {
  // Category pagination also has tsk-all; only the product count is relevant.
  const match =
    /แสดง(?:สินค้า|ชิ้น)ที่\s*[\d,]+\s*-\s*[\d,]+\s*จากทั้งหมด\s*<span\b[^>]*class=["'][^"']*\btsk-all\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i.exec(
      html,
    );
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export function animagCategories(
  html: string,
  sourceUrl = "https://www.animagshop.com/",
) {
  const select =
    /<select\b[^>]*name=["']category_id["'][^>]*>([\s\S]*?)<\/select>/i.exec(
      html,
    );
  if (!select) throw new Error("Animag’s title directory could not be read.");
  const roots = {
    "1": "LN (TH)",
    "2": "LN (TH)",
    "3": "LN (TH)",
    "4": "Manga (TH)",
    "190": "Manga (TH)",
  };
  const selected = /^\/category\/(\d+)/.exec(new URL(sourceUrl).pathname)?.[1];
  let parent = "";
  const categories = [];
  for (const match of select[1].matchAll(
    /<option\b([^>]*)>([\s\S]*?)<\/option>/gi,
  )) {
    const id = attr(match[1], "value");
    const label = textHtml(match[2]);
    // Top-level options start with a dash; children have leading NBSP indentation.
    if (/^-/.test(match[2])) parent = id;
    if (!/^\d+$/.test(id) || !roots[parent] || id === parent) continue;
    if (selected && selected !== parent && selected !== id) continue;
    const title = label.replace(/^[-•\s]+/, "").trim();
    if (title)
      categories.push({
        title,
        type: roots[parent],
        url: "https://www.animagshop.com/category/" + id,
      });
  }
  return categories;
}
