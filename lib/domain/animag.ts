import { attr, textHtml } from "./html.ts";
import { lnwProducts, lnwTotal } from "./lnwshop.ts";

// CollectionPage's ItemList is distinct from unrelated JSON-LD recommendations.
export function animagProducts(html: string) {
  return lnwProducts(html, "animag");
}

export function animagTotal(html: string) {
  return lnwTotal(html);
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
