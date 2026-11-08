"use client";

import { useState } from "react";
import Icon from "./Icon";
import { useTranslations } from "./PreferencesProvider";

export default function SignOutButton({ className = "btn" }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/logout", { method: "POST" });
      if (!response.ok) throw new Error("sign-out");
      window.location.assign("/login");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        aria-busy={busy}
        onClick={() => void signOut()}
      >
        <Icon name="logout" />
        {t(busy ? "Signing out…" : "Sign out")}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {t("Could not sign out. Please try again.")}
        </p>
      )}
    </>
  );
}
