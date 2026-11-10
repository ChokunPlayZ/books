"use client";

import { useEffect, useRef, useState } from "react";
import { canonicalIsbn } from "../../lib/domain/isbn.ts";
import type {
  ScraperDebugResult,
  ScraperDebugSource,
} from "../../lib/scraper-debug.ts";
import { useTranslations } from "../PreferencesProvider";
import { RecordContent } from "./RecordContent";
import { adminRpc } from "./rpc.ts";

function RawData({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{title}</summary>
      {open && (
        <pre className="admin-debug-raw">
          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        </pre>
      )}
    </details>
  );
}

export default function ScraperDebugPanel() {
  const t = useTranslations();
  const [sources, setSources] = useState<ScraperDebugSource[]>([]);
  const [providerId, setProviderId] = useState("phoenix");
  const [isbn, setIsbn] = useState("");
  const [report, setReport] = useState<ScraperDebugResult | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    adminRpc<ScraperDebugSource[]>("getScraperDebugSources").then(
      (data) => {
        if (!disposed) setSources(data);
      },
      (error) => {
        if (!disposed) setError(error.message);
      },
    );
    return () => {
      disposed = true;
    };
  }, []);
  async function run() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      setReport(
        await adminRpc<ScraperDebugResult>("debugScraperIsbn", {
          isbn,
          providerId,
        }),
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `scraper-${report.providerId}-${report.isbn}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section aria-labelledby="scraperDebugHeading">
      <h2 id="scraperDebugHeading">{t("Scraper debugger")}</h2>
      <p>
        {t(
          "Enter an ISBN to run one provider from scratch and inspect its raw responses, parsed data and errors. Successful caches are bypassed; retry cooldowns still apply. No covers are downloaded, shared metadata replaced or library books changed.",
        )}
      </p>
      <form
        className="admin-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label>
          {t("ISBN")}
          <input
            value={isbn}
            onChange={(event) => setIsbn(event.target.value)}
            placeholder="9786164648357"
            required
            maxLength={100}
            disabled={busy}
          />
        </label>
        <label>
          {t("Provider")}
          <select
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            disabled={busy}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn primary"
          disabled={busy || !canonicalIsbn(isbn) || !sources.length}
        >
          {t(busy ? "Scraping…" : "Run fresh scrape")}
        </button>
      </form>
      {busy && (
        <p role="status">
          {t(
            "Waiting for the scraping queue. Long-running results remain available in Scraping queue.",
          )}
        </p>
      )}
      {error && (
        <p className="admin-error" role="alert">
          {t(error)}
        </p>
      )}
      {report && (
        <div className="admin-debug-report">
          <div className="admin-section-heading">
            <div>
              <h3>
                {report.isbn} ·{" "}
                {sources.find((source) => source.id === report.providerId)
                  ?.name || report.providerId}
              </h3>
              <p>
                {report.startedAt} · {report.durationMs} ms ·{" "}
                {report.responses.length} {t("Responses")}
              </p>
            </div>
            <button className="btn" onClick={download}>
              {t("Download debug report")}
            </button>
          </div>
          {report.error && (
            <div role="alert" className="admin-error">
              {report.error}
              <RawData title={t("Error stack")} value={report.stack} />
            </div>
          )}
          {!!report.cooldowns.length && (
            <div className="admin-card">
              <h3>{t("Retry cooldowns")}</h3>
              <RecordContent value={report.cooldowns} images={false} />
            </div>
          )}
          <article className="admin-card">
            <h3>{t("Parsed result")}</h3>
            <RecordContent value={report.result} images={false} />
            <RawData title={t("Raw JSON")} value={report.result} />
          </article>
          <h3>{t("Responses")}</h3>
          {report.responses.map((response, index) => (
            <article className="admin-card" key={index}>
              <h3>
                {index + 1}. {response.method} ·{" "}
                {response.status ?? t("Failed")} · {response.durationMs} ms
              </h3>
              <p className="admin-debug-url">{response.url}</p>
              <p>
                {response.contentType || "—"} ·{" "}
                {response.bytes.toLocaleString()} {t("bytes")}
              </p>
              {response.error && (
                <p className="admin-inline-error">{response.error}</p>
              )}
              {response.truncated && (
                <p className="admin-inline-error">
                  {t(
                    "Response capture was truncated at the report size limit. The parser received the complete bounded response.",
                  )}
                </p>
              )}
              <RawData title={t("Raw response body")} value={response.body} />
              <RawData title={t("Response headers")} value={response.headers} />
            </article>
          ))}
          <h3>{t("Parser snapshots")}</h3>
          {report.snapshots.map((snapshot, index) => (
            <article className="admin-card" key={index}>
              <h3 className="admin-debug-url">{snapshot.source}</h3>
              <RecordContent value={snapshot.value} images={false} />
              <RawData title={t("Raw JSON")} value={snapshot.value} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
