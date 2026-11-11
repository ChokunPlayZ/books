"use client";

import { useState } from "react";
import { useTranslations } from "../PreferencesProvider";
import ExternalLink from "../ExternalLink";
import type { MetadataSuggestion } from "../../lib/server/metadata-suggestions.ts";

export default function MetadataReviewQueue({
  initial,
}: {
  initial: MetadataSuggestion[];
}) {
  const t = useTranslations();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function rpc(name: string, arg: unknown) {
    const response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arg }),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        value.message || "The review could not be saved. Try again.",
      );
    return value;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="metadata-review-queue">
      <div className="series-info-heading">
        <h1>{t("Metadata suggestions")}</h1>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            run(async () =>
              setItems(
                (await rpc("getMetadataSuggestions", { all: true })).items,
              ),
            )
          }
        >
          {t("Refresh")}
        </button>
      </div>
      <p>
        {t(
          "Review the proposed correction against its source. Marking it reviewed records the outcome only; use the metadata tools to apply verified changes separately.",
        )}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      {!items.length && (
        <p className="empty">{t("No suggestions to review.")}</p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <h2>
              {item.series} · {t(item.field)}
            </h2>
            <p className="hint">
              {t(item.type)}
              {item.volume_key ? " · " + item.volume_key : ""} ·{" "}
              {new Date(Number(item.created_at)).toISOString().slice(0, 10)} ·{" "}
              {t(
                item.status === "pending"
                  ? "Pending review"
                  : item.status === "reviewed"
                    ? "Reviewed"
                    : "Rejected",
              )}
            </p>
            <p className="preserve-lines">{item.proposed}</p>
            {item.note && <p className="preserve-lines">{item.note}</p>}
            {item.source_url && (
              <ExternalLink href={item.source_url} target="_blank">
                {t("View source")}
              </ExternalLink>
            )}
            {item.status === "pending" && (
              <div className="series-review-actions">
                {["reviewed", "rejected"].map((status) => (
                  <button
                    key={status}
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await rpc("reviewMetadataSuggestion", {
                          id: item.id,
                          status,
                        });
                        setItems((previous) =>
                          previous.map((entry) =>
                            entry.id === item.id
                              ? {
                                  ...entry,
                                  status:
                                    status as MetadataSuggestion["status"],
                                }
                              : entry,
                          ),
                        );
                      })
                    }
                  >
                    {t(
                      status === "reviewed"
                        ? "Mark reviewed"
                        : "Reject suggestion",
                    )}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
