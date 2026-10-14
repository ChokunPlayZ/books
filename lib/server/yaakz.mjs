import {
  safeProductUrl_,
  safeCoverUrl_,
  releaseItem_,
  attr_,
  publisherKey_,
} from "../domain.mjs";

// Nuxt serializes public product data as JSON references. Never execute page scripts.
export function yaakzProducts(html) {
  const script = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).find(
    (tag) =>
      attr_(tag.slice(0, tag.indexOf(">") + 1), "id") === "__NUXT_DATA__",
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
  return Object.values(root?.pinia?.products?.products || {});
}

export function yaakzItems(product) {
  // Parent ranges use the latest volume's image. Only child records identify a volume.
  const records = product.has_subproduct ? product.subproducts : [product];
  if (!Array.isArray(records)) return [];
  return records.flatMap((record) => {
    const url = safeProductUrl_(
      "https://www.yaakz.com/product/" + record.uuid,
      "yaakz",
    );
    const title = record.title || record.name;
    if (!url || !title) return [];
    const category = product.category_name || "";
    const type =
      record.type ||
      (/นิยาย|novel/i.test(title + " " + category)
        ? "LN (TH)"
        : publisherKey_(category) === "yaakz"
          ? "Manga (TH)"
          : "");
    const item = releaseItem_(
      "yaakz",
      title,
      url,
      record.price,
      record.barcode,
      type,
    );
    item.coverUrl = safeCoverUrl_(record.images);
    item.availability = record.preorder_flag
      ? "Pre-order"
      : Number(record.remain) > 0
        ? "In stock"
        : "Check availability";
    item.source = "Yaakz";
    return [item];
  });
}
