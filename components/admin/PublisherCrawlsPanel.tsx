"use client";

import { useEffect, useState } from "react";
import {
  CRAWL_MODES,
  type CrawlMode,
  type CrawlOverview,
} from "../../lib/crawls.ts";
import { useTranslations } from "../PreferencesProvider";
import { adminRpc } from "./rpc.ts";

export default function PublisherCrawlsPanel({
  onInspect,
}: {
  onInspect: (jobId: string, trigger: HTMLButtonElement) => void;
}) {
  const t = useTranslations();
  const [data, setData] = useState<CrawlOverview | null>(null);
  const [publisherId, setPublisherId] = useState("");
  const [mode, setMode] = useState<CrawlMode>("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false,
      refreshing = false;
    async function refresh() {
      if (refreshing || document.hidden) return;
      refreshing = true;
      try {
        const next = await adminRpc<CrawlOverview>("getPublisherCrawls");
        if (!disposed) setData(next);
      } catch (error) {
        if (!disposed) setError(error.message);
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  async function action(name: string, arg: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await adminRpc(name, arg);
      setData(await adminRpc("getPublisherCrawls"));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const source = data?.sources.find((s) => s.id === publisherId);
  return (
    <section aria-labelledby="publisherCrawlsHeading">
      <h2 id="publisherCrawlsHeading">{t("Publisher cache warm-up")}</h2>
      <p>
        {t(
          "Manual only. One background crawl at a time, with at least 10 seconds between requests. User lookups pause crawling before its next request; in-flight responses finish safely. No images are downloaded or libraries changed.",
        )}
      </p>
      <p>
        {t(
          "All means every series exposed by the supported directory. Publisher pagination limits or inaccessible pages are reported, never treated as complete coverage.",
        )}
      </p>
      {error && (
        <p role="alert" className="admin-error">
          {t(error)}
        </p>
      )}
      <form
        className="admin-filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            window.confirm(
              t(
                "Start this manual publisher crawl? It may take hours and will yield to user lookups.",
              ),
            )
          )
            void action("startPublisherCrawl", { publisherId, mode });
        }}
      >
        <label>
          {t("Publisher")}
          <select
            required
            value={publisherId}
            onChange={(e) => {
              setPublisherId(e.target.value);
              if (!data?.sources.find((s) => s.id === e.target.value)?.full)
                setMode("latest");
            }}
          >
            <option value="">{t("Choose a publisher")}</option>
            {data?.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.full ? "" : ` · ${t("Latest releases only")}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Crawl mode")}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as CrawlMode)}
          >
            {Object.entries(CRAWL_MODES).map(([id, label]) => (
              <option
                key={id}
                value={id}
                disabled={id !== "latest" && !source?.full}
              >
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy || !publisherId}>
          {t("Start crawl")}
        </button>
      </form>
      <div className="admin-records">
        {data?.crawls.map((crawl) => (
          <article className="admin-card" key={crawl.id}>
            <div className="admin-section-heading">
              <h3>
                {data.sources.find((s) => s.id === crawl.publisherId)?.name} ·{" "}
                {t(CRAWL_MODES[crawl.mode])}
              </h3>
              <span className={`admin-status is-${crawl.status}`}>
                {t(crawl.status)}
              </span>
            </div>
            <p>
              {crawl.processed} {t("processed")} · {crawl.remaining ?? "—"}{" "}
              {t("remaining")}{" "}
              {crawl.currentLabel && ` · ${crawl.currentLabel}`}
            </p>
            {crawl.error && <p className="admin-inline-error">{crawl.error}</p>}
            {!!crawl.warnings.length && (
              <ul className="admin-crawl-warnings">
                {crawl.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="admin-row-actions">
              {crawl.jobId && (
                <button
                  className="btn"
                  disabled={busy}
                  aria-haspopup="dialog"
                  onClick={(event) =>
                    onInspect(crawl.jobId, event.currentTarget)
                  }
                >
                  {t("Task details")}
                </button>
              )}
              {["running", "paused", "failed"].includes(crawl.status) && (
                <div className="admin-row-actions">
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      action("managePublisherCrawl", {
                        id: crawl.id,
                        action: crawl.status !== "running" ? "resume" : "pause",
                      })
                    }
                  >
                    {t(
                      crawl.status !== "running"
                        ? "Resume crawl"
                        : "Pause crawl",
                    )}
                  </button>
                  {crawl.status !== "failed" && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            t(
                              "Cancel this crawl? Already cached data will be kept.",
                            ),
                          )
                        )
                          void action("managePublisherCrawl", {
                            id: crawl.id,
                            action: "cancel",
                          });
                      }}
                    >
                      {t("Cancel crawl")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {data && !data.crawls.length && (
        <p>{t("No publisher crawls have been started.")}</p>
      )}
    </section>
  );
}
