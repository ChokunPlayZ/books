"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { translator } from "../lib/i18n.ts";
import type { Preferences } from "../lib/preferences.ts";
import { THEME_STORAGE_KEY } from "../lib/theme.ts";

type PreferenceContext = {
  preferences: Preferences;
  dark: boolean;
  saving: boolean;
  error: string;
  signedIn: boolean;
  update: (changes: Partial<Preferences>) => Promise<void>;
};
const Context = createContext<PreferenceContext | null>(null);

export default function PreferencesProvider({
  userId,
  initial,
  children,
}: {
  userId: number | null;
  initial: Preferences;
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState(initial);
  const [dark, setDark] = useState(initial.theme === "dark");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const storageKey =
    userId === null ? THEME_STORAGE_KEY : `books-preferences:${userId}`;

  useEffect(() => {
    setPreferences(initial);
  }, [initial]);

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    function apply() {
      const isDark =
        preferences.theme === "dark" ||
        (preferences.theme === "system" && system.matches);
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      setDark(isDark);
    }
    function sync(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      if (userId === null) {
        const theme = event.newValue;
        setPreferences((previous) => ({
          ...previous,
          theme: theme === "light" || theme === "dark" ? theme : "system",
        }));
      } else {
        // Storage is only a signal. The account on the server is authoritative.
        void fetch("/api/preferences", { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) return;
            const next: Preferences = await response.json();
            if (next.locale !== preferences.locale) window.location.reload();
            else setPreferences(next);
          })
          .catch(() => {});
      }
    }
    if (userId === null) {
      try {
        const theme = localStorage.getItem(THEME_STORAGE_KEY);
        if (
          (theme === "dark" || theme === "light") &&
          theme !== preferences.theme
        ) {
          setPreferences((previous) => ({ ...previous, theme }));
          return;
        }
      } catch {}
    }
    apply();
    system.addEventListener("change", apply);
    window.addEventListener("storage", sync);
    return () => {
      system.removeEventListener("change", apply);
      window.removeEventListener("storage", sync);
    };
  }, [preferences, storageKey, userId]);

  const update = useCallback(
    async (changes: Partial<Preferences>) => {
      if (pending.current) return;
      pending.current = true;
      setSaving(true);
      setError("");
      try {
        let next = { ...preferences, ...changes };
        if (userId !== null) {
          const response = await fetch("/api/preferences", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(changes),
          });
          if (!response.ok) throw new Error("save");
          next = await response.json();
        }
        try {
          localStorage.setItem(
            storageKey,
            userId === null ? next.theme : JSON.stringify(next),
          );
        } catch {}
        if (next.locale !== preferences.locale) {
          window.location.reload();
          return;
        }
        setPreferences(next);
      } catch {
        setError(
          translator(preferences.locale)(
            "Preferences could not be saved. Please try again.",
          ),
        );
      } finally {
        pending.current = false;
        setSaving(false);
      }
    },
    [preferences, storageKey, userId],
  );

  return (
    <Context.Provider
      value={{
        preferences,
        dark,
        saving,
        error,
        signedIn: userId !== null,
        update,
      }}
    >
      {children}
      {error && (
        <p className="preference-error form-error" role="alert">
          {error}
        </p>
      )}
    </Context.Provider>
  );
}

export function usePreferences() {
  const context = useContext(Context);
  if (!context) throw new Error("PreferencesProvider is required.");
  return context;
}

export function useTranslations() {
  const { preferences } = usePreferences();
  return useMemo(() => translator(preferences.locale), [preferences.locale]);
}
