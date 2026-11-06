export type Locale = "en" | "th";
export type Theme = "light" | "dark" | "system";
export type Preferences = { locale: Locale; theme: Theme };

export const DEFAULT_PREFERENCES: Preferences = {
  locale: "en",
  theme: "system",
};

export function intlLocale(locale: Locale) {
  return locale === "th" ? "th-TH" : "en-US";
}
