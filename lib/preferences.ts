export type Locale = "en" | "th";
export type Theme = "light" | "dark" | "system";
export const SERIES_TITLE_LANGUAGES = [
  "",
  "en",
  "th",
  "ja",
  "ja-Latn",
  "ko",
  "zh",
  "zh-Hant",
  "und",
] as const;
export type SeriesTitleLanguage = (typeof SERIES_TITLE_LANGUAGES)[number];
export type Preferences = {
  locale: Locale;
  theme: Theme;
  seriesTitleLanguage: SeriesTitleLanguage;
};

export const DEFAULT_PREFERENCES: Preferences = {
  locale: "en",
  theme: "system",
  seriesTitleLanguage: "",
};

export function intlLocale(locale: Locale) {
  return locale === "th" ? "th-TH" : "en-US";
}
