"use client";

import Icon from "./Icon";
import { useTranslations } from "./PreferencesProvider";

export default function LibraryBrand() {
  const t = useTranslations();
  return (
    <a
      className="brand flex shrink-0 items-center no-underline"
      href="/"
      aria-label={t("meemai home")}
    >
      <span className="brand-mark">
        <Icon name="book" />
      </span>
      <span>
        <span className="brand-name">{t("meemai")}</span>
      </span>
    </a>
  );
}
