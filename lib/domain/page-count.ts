// Unknown, malformed and edition-dependent ranges stay blank.
export function parsePageCount(value: unknown): number | "" {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).normalize("NFKC").trim();
  const match =
    /^(\d+|\d{1,3}(?:,\d{3})+)\s*(?:pages?|pp?\.?|หน้า|ページ|頁)?$/i.exec(
      text,
    );
  if (!match) return "";
  const count = Number(match[1].replaceAll(",", ""));
  return Number.isSafeInteger(count) && count > 0 ? count : "";
}

export function normalizePageCount(value: unknown): number | "" {
  if (value == null || (typeof value === "string" && !value.trim())) return "";
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value).trim())
  )
    throw new Error("Pages must be a positive whole number or blank.");
  const count = parsePageCount(value);
  if (count === "")
    throw new Error("Pages must be a positive whole number or blank.");
  return count;
}
