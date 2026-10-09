"use client";
import { useState } from "react";

export default function DataManager({ counts, canSignOut }) {
  const [file, setFile] = useState(null),
    [review, setReview] = useState(null),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function upload(action) {
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
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.assign("/login");
  }
  return (
    <main className="data-page">
      <a className="text-btn" href="/">
        ← Your collection
      </a>
      <p className="eyebrow">Keep your library yours</p>
      <h1>Data &amp; backups</h1>
      <p className="intro">
        {counts.books} owned books · {counts.trash} recently removed ·{" "}
        {counts.savedReleases} saved releases
      </p>
      <section className="data-card">
        <h2>Download a backup</h2>
        <p>
          Save your books, recently removed volumes, saved releases, catalog
          links and dropdown choices in one file. You can restore it into an
          empty library.
        </p>
        <a className="btn primary" href="/api/backup" download>
          Download library backup
        </a>
      </section>
      <section className="data-card">
        <h2>Bring over your collection</h2>
        <p>
          In Google Sheets, choose{" "}
          <strong>File → Download → Microsoft Excel (.xlsx)</strong>. The full
          workbook includes the helper tabs for recently removed books, saved
          releases and linked series catalogs. CSV imports owned books only. A
          library JSON backup works too.
        </p>
        <p>
          Imports require an empty library and keep duplicate copies, gifts with
          a price of zero, blank prices and decimal volumes. Review the contents
          before saving.
        </p>
        <label htmlFor="importFile" className="sr-only">
          Collection file
        </label>
        <input
          id="importFile"
          type="file"
          accept=".xlsx,.csv,.json"
          onChange={(e) => {
            setFile(e.target.files[0] || null);
            setReview(null);
            setResult(null);
            setError("");
          }}
        />
        <div className="data-actions">
          <button
            className="btn"
            disabled={!file || busy}
            onClick={() => upload("preview")}
          >
            {busy ? "Reading file…" : "Review import"}
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {review && (
          <div aria-live="polite">
            <h3>Ready to import</h3>
            <p>
              {review.books} owned books · {review.trash} removed books ·{" "}
              {review.savedReleases} saved releases · {review.seriesCatalogs}{" "}
              catalog links
            </p>
            <ul>
              {review.sample.map((book, index) => (
                <li key={index}>
                  {book.series} ·{" "}
                  {book.volume === "" ? "Unnumbered" : `Volume ${book.volume}`}{" "}
                  · {book.type}
                </li>
              ))}
            </ul>
            {review.warnings.length > 0 && (
              <details>
                <summary>{review.warnings.length} things to check</summary>
                <ul>
                  {review.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => upload("import")}
            >
              Import this collection
            </button>
          </div>
        )}
        {result && (
          <p role="status">
            {result.alreadyImported
              ? "This file was already imported."
              : `Imported ${result.books} books.`}{" "}
            <a href="/">Open your shelf →</a>
          </p>
        )}
      </section>
      {canSignOut && (
        <button className="btn" onClick={logout}>
          Sign out
        </button>
      )}
    </main>
  );
}
