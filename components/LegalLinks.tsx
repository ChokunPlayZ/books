"use client";

import { useTranslations } from "./PreferencesProvider";

export default function LegalLinks() {
  const t = useTranslations();
  return (
    <nav className="legal-links" aria-label={t("Legal")}>
      <a href="/terms">{t("Terms of Service")}</a>
      <a href="/privacy">{t("Privacy Policy")}</a>
    </nav>
  );
}
