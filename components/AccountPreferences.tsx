"use client";

import { usePreferences, useTranslations } from "./PreferencesProvider";
import LanguageSelect from "./LanguageSelect";
import {
  SERIES_TITLE_LANGUAGES,
  type SeriesTitleLanguage,
  type Theme,
} from "../lib/preferences.ts";
import { languageName } from "../lib/domain/series-detail.ts";

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
          "Your preferences are saved to your account and follow you across devices.",
        )}
      </p>
      <div className="preference-fields">
        <label className="field">
          <span>{t("Language")}</span>
          <LanguageSelect />
        </label>
        <label className="field">
          <span id="appearanceLabel">{t("Appearance")}</span>
          <select
            aria-labelledby="appearanceLabel"
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
        <label className="field">
          <span id="seriesTitleLanguageLabel">{t("View series title in")}</span>
          <select
            value={preferences.seriesTitleLanguage}
            disabled={saving}
            aria-labelledby="seriesTitleLanguageLabel"
            aria-describedby="seriesTitleLanguageHint"
            onChange={(event) =>
              void update({
                seriesTitleLanguage: event.target.value as SeriesTitleLanguage,
              })
            }
          >
            {SERIES_TITLE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {t(code ? languageName(code) : "Collection title")}
              </option>
            ))}
          </select>
          <span className="hint" id="seriesTitleLanguageHint">
            {t(
              "Applies to all series. Uses the collection title when this language is unavailable.",
            )}
          </span>
        </label>
      </div>
      <p className="hint" role="status">
        {t(saving ? "Saving…" : "Changes are saved automatically.")}
      </p>
    </section>
  );
}
