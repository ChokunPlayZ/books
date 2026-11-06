import { translator } from "../i18n.ts";
import { intlLocale } from "../preferences.ts";

export const locale = () =>
  typeof document !== "undefined" && document.documentElement?.lang === "th"
    ? "th"
    : "en";
export const formatLocale = () => intlLocale(locale());
export const t: ReturnType<typeof translator> = (message, values) =>
  translator(locale())(message, values);
