"use client";

import { useRef, useState } from "react";
import { useTranslations } from "../PreferencesProvider";
import ExternalLink from "../ExternalLink";
import type { MetadataSuggestion } from "../../lib/server/metadata-suggestions.ts";

export default function SuggestEditMenu({
  series,
  type,
  volumeKey = "",
}: {
  series: string;
  type: string;
  volumeKey?: string;
}) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [suggestions, setSuggestions] = useState<MetadataSuggestion[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const load = async () => {
    const response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "getMetadataSuggestions", arg: { series } }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.message || "Suggestions could not be loaded. Try again.",
      );
    setSuggestions(data.items);
  };
  return (
    <details
      className="suggest-edit"
      onToggle={(event) => {
        if (event.currentTarget.open)
          void load().catch((failure) => setError(failure.message));
      }}
    >
      <summary>{t("Suggest an edit")}</summary>
      <div className="suggest-edit-panel">
        <h3>{t("Suggest a correction")}</h3>
        <p className="hint">
          {t(
            "Suggestions go to a review queue. Current metadata and your owned copies are not changed.",
          )}
        </p>
        <form
          ref={form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            setSuccess(false);
            const values = new FormData(event.currentTarget);
            try {
              const response = await fetch("/api/rpc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: "suggestMetadataEdit",
                  arg: {
                    series,
                    type,
                    volumeKey,
                    field: values.get("field"),
                    proposed: values.get("proposed"),
                    sourceUrl: values.get("sourceUrl"),
                    note: values.get("note"),
                  },
                }),
              });
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.message ||
                    "Your suggestion could not be saved. Try again.",
                );
              setSuccess(true);
              form.current?.reset();
              await load();
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : String(failure),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>{t("Field to correct")}</span>
            <input
              name="field"
              list="suggestionFields"
              required
              maxLength={100}
              placeholder={t("Author, tag, ISBN, price…")}
            />
          </label>
          <datalist id="suggestionFields">
            {[
              "Title",
              "Author",
              "Artist",
              "Publisher",
              "Translator",
              "Genre",
              "Theme",
              "Synopsis",
              "Publication status",
              "Publication year",
              "Age rating",
              "Banner",
              "ISBN",
              "List price",
              "Pages",
              "Release date",
              "Language edition",
            ].map((field) => (
              <option key={field} value={field} />
            ))}
          </datalist>
          <label className="field">
            <span>{t("Proposed correction")}</span>
            <textarea name="proposed" required maxLength={8000} rows={3} />
          </label>
          <label className="field">
            <span>{t("Source URL (optional)")}</span>
            <input
              type="url"
              name="sourceUrl"
              maxLength={2000}
              placeholder="https://"
            />
          </label>
          <label className="field">
            <span>{t("Reason or context (optional)")}</span>
            <textarea name="note" maxLength={2000} rows={2} />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {t(error)}
            </p>
          )}
          {success && (
            <p role="status">{t("Suggestion saved · Pending review")}</p>
          )}
          <button className="btn primary" disabled={busy}>
            {t(busy ? "Saving…" : "Submit suggestion")}
          </button>
        </form>
        {suggestions.length > 0 && (
          <div className="suggestion-history">
            <h3>{t("Your suggestions")}</h3>
            <ul>
              {suggestions.map((item) => (
                <li key={item.id}>
                  <strong>{t(item.field)}</strong>
                  <span className="status">
                    {t(
                      item.status === "pending"
                        ? "Pending review"
                        : item.status === "reviewed"
                          ? "Reviewed"
                          : "Rejected",
                    )}
                  </span>
                  <p>{item.proposed}</p>
                  {item.source_url && (
                    <ExternalLink href={item.source_url} target="_blank">
                      {t("Source")}
                    </ExternalLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
