"use client";
import { useState } from "react";
import Icon from "./Icon";
import AccountPreferences from "./AccountPreferences";
import LoadingStatus from "./LoadingStatus";
import { activity } from "../lib/client/activity.ts";
import type { ImportResult, ImportReview } from "../lib/types";
import { useTranslations } from "./PreferencesProvider";

type DataManagerProps = {
  counts: { books: number; trash: number; savedReleases: number };
};

export default function DataManager({ counts }: DataManagerProps) {
  const t = useTranslations();
  const [file, setFile] = useState<File | null>(null),
    [review, setReview] = useState<ImportReview | null>(null),
    [result, setResult] = useState<ImportResult | null>(null),
    [error, setError] = useState(""),
    [busyAction, setBusyAction] = useState<"preview" | "import" | null>(null);
  const busy = busyAction !== null;
  async function upload(action: "preview" | "import") {
    if (!file || busy) return;
    setBusyAction(action);
    setResult(null);
    setError("");
    const finish = activity.begin(
      action === "preview" ? "Reading file…" : "Importing your collection…",
    );
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("action", action);
      if (review) form.set("fingerprint", review.fingerprint);
      const response = await fetch("/api/import", {
          method: "POST",
          body: form,
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message);
      if (action === "preview") setReview(data);
      else {
        setResult(data);
        setReview(null);
      }
    } catch (err: unknown) {
      setError(
        t(err instanceof Error ? err.message : "Import failed. Try again."),
      );
    } finally {
      setBusyAction(null);
      finish();
    }
  }
  return (
    <>
      <div className="data-heading">
        <h1>{t("Data & backups")}</h1>
        <p className="intro">
          {t(
            "Manage your preferences, export your books, or bring over a collection.",
          )}
        </p>
      </div>
      <div className="data-overview" aria-label={t("Library records")}>
        <span>
          <strong>{counts.books}</strong> {t("owned books")}
        </span>
        <span>
          <strong>{counts.trash}</strong> {t("recently removed")}
        </span>
        <span>
          <strong>{counts.savedReleases}</strong> {t("saved releases")}
        </span>
      </div>
      <nav className="data-sections" aria-label={t("Data management")}>
        <a href="#account-preferences">{t("Account preferences")}</a>
        <a href="#library-backups">{t("Export & import")}</a>
      </nav>
      <AccountPreferences />
      <div id="library-backups" className="data-grid">
        <section className="data-card backup-card">
          <span className="data-icon">
            <Icon name="download" />
          </span>
          <p className="eyebrow">{t("Take a copy with you")}</p>
          <h2>{t("Export your books")}</h2>
          <p>
            {t(
              "Download your owned books with ISBNs, titles, book types, volumes, edition labels, reading status, purchase details and notes. Duplicate copies stay separate.",
            )}
          </p>
          <a className="btn primary" href="/api/backup" download>
            <Icon name="download" />
            {t("Export library")}
          </a>
          <p className="backup-note">
            <Icon name="archive" />
            {t(
              "Books and personal details only. Covers, publisher metadata, saved releases and removed books are not included.",
            )}
          </p>
        </section>
        <section className="data-card">
          <span className="data-icon">
            <Icon name="upload" />
          </span>
          <p className="eyebrow">{t("Give your books a new home")}</p>
          <h2>{t("Bring over your collection")}</h2>
          <p>
            {t(
              "In Google Sheets, choose File → Download → Microsoft Excel (.xlsx). CSV files, library JSON exports and older JSON backups work too. You can import into an empty library.",
            )}
          </p>
          <p>
            {t(
              "Imports require an empty library and keep duplicate copies, gifts with a price of zero, blank prices and decimal volumes. Review the contents before saving.",
            )}
          </p>
          <div className="import-picker">
            <label htmlFor="importFile">
              {t("Choose your collection file")}
            </label>
            <p id="importFormats" className="hint">
              {t("Excel workbook, CSV, JSON export or backup")}
            </p>
            <input
              id="importFile"
              type="file"
              accept=".xlsx,.csv,.json"
              aria-describedby="importFormats"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setReview(null);
                setResult(null);
                setError("");
              }}
            />
          </div>
          <div className="data-actions flex flex-wrap">
            <button
              className="btn"
              disabled={!file || busy}
              aria-busy={busyAction === "preview"}
              onClick={() => upload("preview")}
            >
              {t(busyAction === "preview" ? "Reading file…" : "Review import")}
            </button>
          </div>
          {busy && (
            <LoadingStatus
              className="import-loading"
              label={t(
                busyAction === "preview"
                  ? "Reading and checking your file…"
                  : "Importing your collection…",
              )}
              detail={t(
                busyAction === "preview"
                  ? "Preparing a preview. Your library has not changed yet."
                  : "Saving your books. Keep this page open until the import finishes.",
              )}
            />
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {review && (
            <div className="import-review" aria-live="polite">
              <h3>{t("Ready to import")}</h3>
              <p>
                {t(
                  "{books} owned books · {trash} removed books · {releases} saved releases · {catalogs} catalog links",
                  {
                    books: review.books,
                    trash: review.trash,
                    releases: review.savedReleases,
                    catalogs: review.seriesCatalogs,
                  },
                )}
              </p>
              <ul>
                {review.sample.map((book, index) => (
                  <li key={index}>
                    {book.series} ·{" "}
                    {book.volume === ""
                      ? t("Unnumbered")
                      : t("Volume {volume}", { volume: book.volume })}{" "}
                    · {book.type}
                  </li>
                ))}
              </ul>
              {review.warnings.length > 0 && (
                <details>
                  <summary>
                    {t("{count} things to check", {
                      count: review.warnings.length,
                    })}
                  </summary>
                  <ul>
                    {review.warnings.map((warning, index) => (
                      <li key={index}>{t(warning)}</li>
                    ))}
                  </ul>
                </details>
              )}
              <button
                className="btn primary"
                disabled={busy}
                aria-busy={busyAction === "import"}
                onClick={() => upload("import")}
              >
                {t(
                  busyAction === "import"
                    ? "Importing…"
                    : "Import this collection",
                )}
              </button>
            </div>
          )}
          {result && (
            <p className="import-success" role="status">
              {result.alreadyImported
                ? t("This file was already imported.")
                : t("Imported {count} books.", { count: result.books })}{" "}
              <a href="/">{t("Open your shelf →")}</a>
            </p>
          )}
        </section>
      </div>
    </>
  );
}
