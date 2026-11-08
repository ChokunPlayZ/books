import { romanize, romanizeSyllable } from "@pcampus/thai-romanization";

const words = new Intl.Segmenter("th", { granularity: "word" });

export function seriesSlug(series: string) {
  const text = series.replace(/[๐-๙]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x0e50),
  );
  const latin = [...words.segment(text)]
    .map(({ segment }) =>
      // Preserve Latin/numeric spans even when the segmenter joins scripts.
      segment.replace(/[ก-ฮะ-ฺเ-ๅ็-๎]+/g, (thai) => {
        // The romanizer otherwise splits short เ-็- syllables (เต็ม → te-om).
        const word = /^เ[ก-ฮ]็[ก-ฮ]$/.test(thai)
          ? romanizeSyllable(thai)
          : romanize(thai, { separator: "-", tone: "omit" });
        return "-" + word + "-";
      }),
    )
    .join("-");
  return (
    latin
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96)
      .replace(/-+$/, "") || "series"
  );
}

// A browser-safe, non-cryptographic discriminator for titles whose slugs match.
// Authorization always comes from the signed-in collection, never this suffix.
export function seriesUrlId(series: string) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(series))
    hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(36).padStart(7, "0");
}
