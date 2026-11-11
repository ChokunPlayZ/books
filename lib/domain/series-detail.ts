import { seriesPath } from "./navigation.ts";
import { textLanguage } from "./series-info.ts";

export function metadataBrowsePath(field: string, value: string) {
  return "/browse?" + new URLSearchParams({ field, value });
}
export function volumePath(series: string, key: string) {
  return seriesPath(series) + "/volumes/" + encodeURIComponent(key);
}
export function editionLanguage(book: { edition?: string; series: string }) {
  return (
    { TH: "th", EN: "en", JP: "ja" }[
      /\((TH|EN|JP)\)/i.exec(book.edition || "")?.[1].toUpperCase() || ""
    ] || textLanguage(book.series)
  );
}
export function languageName(code: string) {
  return (
    {
      en: "English",
      ja: "Japanese",
      "ja-Latn": "Romaji",
      th: "Thai",
      ko: "Korean",
      zh: "Chinese",
      "zh-Hant": "Traditional Chinese",
      und: "Language unspecified",
    }[code] || code
  );
}
export function formatMoney(value: unknown, currency = "") {
  if (value === "" || value == null || !Number.isFinite(Number(value)))
    return "";
  const number = new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
  }).format(Number(value));
  return currency ? currency.toUpperCase() + " " + number : number;
}
