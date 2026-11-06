"use client";
import { useState } from "react";
import Icon from "./Icon";
import LibraryBrand from "./LibraryBrand";
import ThemeToggle from "./ThemeToggle";
import LanguageSelect from "./LanguageSelect";
import AccountPreferences from "./AccountPreferences";
import MetadataManager from "./MetadataManager";
import type { MetadataOverview } from "../lib/metadata";
import type { ImportResult, ImportReview } from "../lib/types";
import { useTranslations } from "./PreferencesProvider";

type DataManagerProps = {
  counts: { books: number; trash: number; savedReleases: number };
  canSignOut: boolean;
  metadata: MetadataOverview | null;
};

export default function DataManager({
  counts,
  canSignOut,
  metadata,
}: DataManagerProps) {
  const t = useTranslations();
  const [file, setFile] = useState<File | null>(null),
    [review, setReview] = useState<ImportReview | null>(null),
    [result, setResult] = useState<ImportResult | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function upload(action: "preview" | "import") {
    if (!file) return;
    setBusy(true);
    setError("");
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
      setBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.assign("/login");
  }
  return (
    <>
      <header className="top data-header">
        <div className="top-inner flex items-center justify-between">
          <LibraryBrand />
          <div className="header-links">
            <LanguageSelect />
            <ThemeToggle />
            <a className="btn return-link" href="/">
              <Icon name="arrow" />
              {t("Your collection")}
            </a>
          </div>
        </div>
      </header>
      <main className="data-page">
        <div className="data-heading">
          <p className="eyebrow">{t("Keep your library yours")}</p>
          <h1>
            {t("Data & backups")}
            <span className="heading-dot">.</span>
          </h1>
          <p className="intro">
            {t(
              "Manage source metadata, maintain your cache, and keep a copy of your library.",
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
          {metadata && (
            <a href="#metadata-maintenance">{t("Metadata & cache")}</a>
          )}
          <a href="#library-backups">{t("Backups & import")}</a>
        </nav>
        <AccountPreferences />
        {metadata && <MetadataManager initial={metadata} />}
        <div id="library-backups" className="data-grid">
          <section className="data-card backup-card">
            <span className="data-icon">
              <Icon name="download" />
            </span>
            <p className="eyebrow">{t("Take a copy with you")}</p>
            <h2>{t("Download a backup")}</h2>
            <p>
              {t(
                "Save your books, recently removed volumes, saved releases, catalog links and dropdown choices in one file. You can restore it into an empty library.",
              )}
            </p>
            <a className="btn primary" href="/api/backup" download>
              <Icon name="download" />
              {t("Download library backup")}
            </a>
            <p className="backup-note">
              <Icon name="archive" />
              {t("One file. Your whole library.")}
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
                "In Google Sheets, choose File → Download → Microsoft Excel (.xlsx). The full workbook includes the helper tabs for recently removed books, saved releases and linked series catalogs. CSV imports owned books only. A library JSON backup works too.",
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
                {t("Excel workbook, CSV or a library JSON backup")}
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
                onClick={() => upload("preview")}
              >
                {t(busy ? "Reading file…" : "Review import")}
              </button>
            </div>
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
                  onClick={() => upload("import")}
                >
                  {t("Import this collection")}
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
        <footer className="data-footer">
          <span>
            <Icon name="lock" />
            {t("Stored in your library. Always yours.")}
          </span>
          {canSignOut && (
            <button className="text-btn" onClick={logout}>
              <Icon name="logout" />
              {t("Sign out")}
            </button>
          )}
        </footer>
      </main>
    </>
  );
}
