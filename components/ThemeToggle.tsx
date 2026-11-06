"use client";

import { usePreferences, useTranslations } from "./PreferencesProvider";
import Icon from "./Icon";

export default function ThemeToggle() {
  const { dark, saving, update } = usePreferences();
  const t = useTranslations();
  return (
    <button
      type="button"
      className="text-btn theme-toggle"
      aria-label={t("Dark theme")}
      aria-pressed={dark}
      title={t(dark ? "Switch to light theme" : "Switch to dark theme")}
      disabled={saving}
      onClick={() => void update({ theme: dark ? "light" : "dark" })}
    >
      <Icon name="moon" className="theme-moon" />
      <Icon name="sun" className="theme-sun" />
    </button>
  );
}
