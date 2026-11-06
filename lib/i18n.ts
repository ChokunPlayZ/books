import type { Locale } from "./preferences.ts";
import { thai } from "./locales/th.ts";

export type Translator = (
  message: string,
  values?: Record<string, string | number>,
) => string;

export function translator(locale: Locale): Translator {
  return (message, values) => {
    const text =
      locale === "th" && Object.hasOwn(thai, message) ? thai[message] : message;
    return values
      ? text.replace(/\{(\w+)\}/g, (token, key) => String(values[key] ?? token))
      : text;
  };
}
