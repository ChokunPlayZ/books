"use client";

import { usePreferences, useTranslations } from "./PreferencesProvider";
import LanguageSelect from "./LanguageSelect";
import type { Theme } from "../lib/preferences.ts";

export default function AccountPreferences() {
  const { preferences, saving, update } = usePreferences();
  const t = useTranslations();
  return (
    <section
      id="account-preferences"
      className="data-card account-preferences"
      aria-labelledby="preferencesTitle"
    >
      <h2 id="preferencesTitle">{t("Account preferences")}</h2>
      <p>
        {t(
          "Your language and appearance are saved to your account and follow you across devices.",
        )}
      </p>
      <div className="preference-fields">
        <label className="field">
          <span>{t("Language")}</span>
          <LanguageSelect />
        </label>
        <label className="field">
          <span>{t("Appearance")}</span>
          <select
            value={preferences.theme}
            disabled={saving}
            onChange={(event) =>
              void update({ theme: event.target.value as Theme })
            }
          >
            <option value="system">{t("Use device setting")}</option>
            <option value="light">{t("Light")}</option>
            <option value="dark">{t("Dark")}</option>
          </select>
        </label>
      </div>
      <p className="hint" role="status">
        {t(saving ? "Saving…" : "Changes are saved automatically.")}
      </p>
    </section>
  );
}
