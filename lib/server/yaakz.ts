import {
  safeProductUrl,
  safeCoverUrl,
  releaseItem,
  attr,
  publisherKey,
  PUBLISHERS,
} from "../domain.ts";
import { money } from "../domain/msrp.ts";

function yaakzPublisher(record, product) {
  const explicit =
    record.publisher_name ||
    record.publisher?.name ||
    (typeof record.publisher === "string" ? record.publisher : "") ||
    product.publisher_name ||
    product.publisher?.name ||
    (typeof product.publisher === "string" ? product.publisher : "");
  // Yaakz is a retailer as well as SIC's shop. Its category identifies the
  // publisher; the website hosting the product does not.
  const category = String(record.category_name || product.category_name || "");
  const label = String(explicit || category.split(/\s*\/\s*/)[0]).trim();
  const publisher = PUBLISHERS.find(
    (entry) => entry.id === publisherKey(label),
  );
  return (
    publisher?.name ||
    (!explicit &&
    /หนังสือ|มังงะ|การ์ตูน|นิยาย|new arrivals|best sellers/i.test(label)
      ? ""
      : label)
  );
}

// Nuxt serializes public product data as JSON references. Never execute page scripts.
export function yaakzProducts(html) {
  const script = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).find(
    (tag) => attr(tag.slice(0, tag.indexOf(">") + 1), "id") === "__NUXT_DATA__",
  );
  if (!script) throw new Error("Yaakz product data unavailable.");
  const values = JSON.parse(
    script.slice(script.indexOf(">") + 1, script.lastIndexOf("</script>")),
  );
  const memo = new Map();
  let count = 0;
  function read(index, depth = 0) {
    if (index < 0) return null;
    if (
      !Number.isInteger(index) ||
      index >= values.length ||
      depth > 80 ||
      ++count > 200000
    )
      throw new Error("Invalid Yaakz product data.");
    if (memo.has(index)) return memo.get(index);
    const value = values[index];
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value) && typeof value[0] === "string") {
      if (
        ["Reactive", "ShallowReactive", "Ref", "ShallowRef"].includes(value[0])
      )
        return read(value[1], depth + 1);
      return null;
    }
    const result = Array.isArray(value) ? [] : Object.create(null);
    memo.set(index, result);
    for (const [key, ref] of Object.entries(value))
      result[key] = read(ref, depth + 1);
    return result;
  }
  const root = read(0);
  return Object.values(root?.pinia?.products?.products || {}) as Record<
    string,
    unknown
  >[];
}

export function yaakzItems(product) {
  // Parent ranges use the latest volume's image. Only child records identify a volume.
  const records = product.has_subproduct ? product.subproducts : [product];
  if (!Array.isArray(records)) return [];
  return records.flatMap((record) => {
    const url = safeProductUrl(
      "https://www.yaakz.com/product/" + record.uuid,
      "yaakz",
    );
    const title = record.title || record.name;
    if (!url || !title) return [];
    const category = record.category_name || product.category_name || "";
    const type =
      record.type ||
      (/นิยาย|novel/i.test(title + " " + category)
        ? "LN (TH)"
        : /มังงะ|การ์ตูน|\b(?:manga|comic)\b/i.test(title + " " + category) ||
            publisherKey(category) === "yaakz"
          ? "Manga (TH)"
          : "");
    const item = releaseItem(
      "yaakz",
      title,
      url,
      record.price,
      record.barcode,
      type,
    );
    item.publisher = yaakzPublisher(record, product);
    // Never derive MSRP by reversing a discount: Yaakz may be permanently on
    // sale. Keep an unknown list price blank rather than copying record.price.
    item.msrp =
      [record.msrp, record.list_price, record.price_full, record.regular_price]
        .map(money)
        .find((price) => price !== "") ?? "";
    item.msrpCurrency = "THB";
    item.coverUrl = safeCoverUrl(record.images);
    item.availability = record.preorder_flag
      ? "Pre-order"
      : Number(record.remain) > 0
        ? "In stock"
        : "Check availability";
    item.source = "Yaakz";
    return [item];
  });
}
