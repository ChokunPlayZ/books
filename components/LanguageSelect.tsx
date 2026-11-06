"use client";

import { usePreferences, useTranslations } from "./PreferencesProvider";
import type { Locale } from "../lib/preferences.ts";

export default function LanguageSelect() {
  const { preferences, signedIn, saving, update } = usePreferences();
  const t = useTranslations();
  if (!signedIn) return null;
  return (
    <select
      className="language-select"
      aria-label={t("Language")}
      value={preferences.locale}
      disabled={saving}
      onChange={(event) =>
        void update({ locale: event.target.value as Locale })
      }
    >
      <option value="en" lang="en">
        English
      </option>
      <option value="th" lang="th">
        ไทย
      </option>
    </select>
  );
}
