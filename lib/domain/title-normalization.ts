// Shared, browser-safe title normalization. Keep catalog hashing and parsing in titles.ts.
export function catalogSeriesKey(text) {
  return bookSeriesTitle(text)
    .replace(/\s*\((?:light\s*novel|novel|manga|comic)\)\s*$/i, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/@comic/gi, "")
    .replace(/(?:\s*\(\d+\)\s*รายการ|\s*\[\d+\])\s*$/, "")
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

export function bookSeriesTitle(text) {
  return String(text || "")
    .replace(/^\[PRE-ORDER\]\s*/i, "")
    .replace(/^(?:\(LN\)|\(มังงะ\)|\(นิยาย\)|นิยาย|การ์ตูน)\s*/i, "")
    .replace(
      /^(?:(?:special|complete|ultimate|limited)(?:\s+combo)?\s+(?:set|edition)|box\s+set)\s+(?:[AB]\s+)?(?:\(Exclusive Pre-order Period\)\s*)?/i,
      "",
    )
    .replace(/\s*\((?:ฉบับพิเศษ|ปกพิเศษ)\)\s*$/i, "")
    .trim();
}

export function seriesCategoryTitle(title) {
  return String(title || "")
    .replace(/\s+(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*\d+(?:\.\d+)?\s*$/i, "")
    .trim();
}

// Recognize only an explicit edition suffix, never arbitrary words in a title.
// This is for displaying alternatives, not for merging ownership or shelf gaps.
export function isRevisedEditionOf(title: string, series: string) {
  const normalized = String(title || "")
    .normalize("NFKC")
    .trim();
  const suffix = /\s*\((?:ฉบับปรับปรุง(?:ใหม่)?|revised\s+edition)\)\s*$/i;
  if (!suffix.test(normalized)) return false;
  const base = catalogSeriesKey(normalized.replace(suffix, ""));
  return (
    !!base &&
    base === catalogSeriesKey(String(series || "").replace(suffix, ""))
  );
}
