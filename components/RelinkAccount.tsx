"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "./PreferencesProvider";

export default function RelinkAccount() {
  const t = useTranslations();
  const [token, setToken] = useState("");
  useEffect(() => {
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    if (/^[a-f0-9]{64}$/.test(value)) setToken(value);
    window.history.replaceState(null, "", "/relink");
  }, []);
  return (
    <section className="admin-card">
      <h1>{t("Re-link your library")}</h1>
      <p>
        {t(
          "Continue with the destination Google account specified by your administrator. Your existing books, notes, saved releases and preferences will stay together. This replaces the old account's access and signs out its sessions. No libraries will be merged.",
        )}
      </p>
      {!token ? (
        <p role="alert">
          {t(
            "Open the complete invitation link from your administrator. Expired or used invitations require a new link.",
          )}
        </p>
      ) : (
        <form className="grid" method="post" action="/api/auth/google/relink">
          <input type="hidden" name="token" value={token} />
          <label className="admin-check">
            <input type="checkbox" name="confirmed" value="yes" required />
            {t(
              "I understand this replaces the Google account linked to my library.",
            )}
          </label>
          <button className="btn primary">
            {t("Choose destination Google account")}
          </button>
        </form>
      )}
    </section>
  );
}
