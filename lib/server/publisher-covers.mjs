import { attr_, meta_, safeCoverUrl_, structuredBooks_ } from "../domain.mjs";

// Read publisher product galleries only; recommendation cards are unrelated books.
export function publisherCovers(html, pageUrl) {
  const covers = new Set();
  const add = (raw) => {
    const url = safeCoverUrl_(raw, pageUrl);
    if (url) covers.add(url);
  };
  // Phoenix Hyvä and Magento galleries expose the original image in JSON.
  for (const match of html.matchAll(
    /(?:initialImages\s*:|["']data["']\s*:)\s*(\[\s*\{[\s\S]*?\}\s*\])/g,
  )) {
    try {
      for (const image of JSON.parse(match[1]))
        if (!image.type || image.type === "image") add(image.full || image.img);
    } catch {}
  }
  if (!covers.size)
    for (const product of structuredBooks_(html))
      for (const image of Array.isArray(product.image)
        ? product.image
        : [product.image])
        add(image);
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    if (/\b(?:productImage|thumb|gallery-img)\b/i.test(attr_(tag, "class")))
      add(attr_(tag, "data-src") || attr_(tag, "src"));
  }
  // Some publishers expose only their primary product image.
  if (!covers.size) add(meta_(html, "og:image"));
  return [...covers];
}
