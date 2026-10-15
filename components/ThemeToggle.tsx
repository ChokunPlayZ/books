"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { THEME_STORAGE_KEY } from "../lib/theme";
import Icon from "./Icon";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const preference = useRef<string | null>(null);

  useLayoutEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    try {
      preference.current = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {}

    function syncTheme() {
      const isDark =
        preference.current === "dark" ||
        (preference.current !== "light" && systemTheme.matches);
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      setDark(isDark);
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      preference.current = event.newValue;
      syncTheme();
    }

    syncTheme();
    systemTheme.addEventListener("change", syncTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      systemTheme.removeEventListener("change", syncTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function toggle() {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    preference.current = theme;
    setDark(theme === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }

  return (
    <button
      type="button"
      className="text-btn theme-toggle"
      aria-label="Dark theme"
      aria-pressed={dark}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
    >
      <Icon name="moon" className="theme-moon" />
      <Icon name="sun" className="theme-sun" />
    </button>
  );
}
