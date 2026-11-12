"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  JOB_STATUSES,
  type JobDetail,
  type QueueOverview,
  type QueueQuery,
} from "../../lib/queue.ts";
import {
  CACHE_GROUPS,
  type MetadataOverview,
  type MetadataQuery,
  type CachePreview,
} from "../../lib/metadata.ts";
import {
  SYSTEM_RESOURCES,
  PRIVATE_SYSTEM_RESOURCES,
  type SystemOverview,
  type SystemRecords,
  type SystemResource,
} from "../../lib/admin.ts";
import { canonicalIsbn } from "../../lib/domain/isbn.ts";
import { formatBytes } from "../../lib/admin-presentation.ts";
import { usePreferences, useTranslations } from "../PreferencesProvider";
import PublisherCrawlsPanel from "./PublisherCrawlsPanel";
import AdminUsersPanel from "./AdminUsersPanel";
import ScraperDebugPanel from "./ScraperDebugPanel";
import { RecordCard, RecordContent } from "./RecordContent";
import AdminDialog from "./AdminDialog";

async function rpc<T>(name: string, arg?: unknown): Promise<T> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arg }),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "The request failed. Please try again.");
  return data;
}
const formatTime = (value: number | string | null) =>
  value
    ? new Date(value)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC")
    : "—";

function Pager({
  page,
  pages,
  disabled,
  onPage,
}: {
  page: number;
  pages: number;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  const t = useTranslations();
  return (
    <div className="admin-pager">
      <button
        className="btn"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t("Previous")}
      </button>
      <span>
        {page} / {pages}
      </span>
      <button
        className="btn"
        disabled={disabled || page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {t("Next")}
      </button>
    </div>
  );
}

export default function AdminPanel({
  initialQueue,
  initialMetadata,
  initialSystem,
  initialRecords,
}: {
  initialQueue: QueueOverview;
  initialMetadata: MetadataOverview;
  initialSystem: SystemOverview;
  initialRecords: SystemRecords;
}) {
  const t = useTranslations();
  const { preferences } = usePreferences();
  const locale = preferences.locale === "th" ? "th-TH" : "en-GB";
  const [tab, setTab] = useState<
    "queue" | "crawls" | "debug" | "users" | "metadata" | "records"
  >("queue");
  const [queue, setQueue] = useState(initialQueue);
  const [queueQuery, setQueueQuery] = useState<QueueQuery>({
    status: "all",
    search: "",
    page: 1,
  });
  const [metadata, setMetadata] = useState(initialMetadata);
  const [metadataQuery, setMetadataQuery] = useState<MetadataQuery>({
    group: "all",
    search: "",
    page: 1,
  });
  const [system, setSystem] = useState(initialSystem);
  const [records, setRecords] = useState(initialRecords);
  const [recordQuery, setRecordQuery] = useState({
    resource: "users" as SystemResource,
    search: "",
    page: 1,
    confirmed: false,
  });
  const [selected, setSelected] = useState<JobDetail | null>(null);
  const selectedId = useRef<string | null>(null);
  const selectedEventPage = useRef(1);
  const jobTrigger = useRef<HTMLButtonElement | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const previewRequest = useRef(0);
  const [preview, setPreview] = useState<
    (CachePreview & { key: string }) | null
  >(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [target, setTarget] = useState("");
  const [fillMissing, setFillMissing] = useState(false);
  const [isbn, setIsbn] = useState("");
  const [live, setLive] = useState(true);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const nextQueue = await rpc<QueueOverview>("getScrapeQueue", queueQuery);
    if (generation !== refreshGeneration.current) return;
    setQueue(nextQueue);
    if (tab === "metadata") {
      const next = await rpc<MetadataOverview>(
        "getMetadataOverview",
        metadataQuery,
      );
      if (generation === refreshGeneration.current) setMetadata(next);
    } else if (tab === "records") {
      const [overview, next] = await Promise.all([
        rpc<SystemOverview>("getSystemOverview"),
        rpc<SystemRecords>("getSystemRecords", recordQuery),
      ]);
      if (generation === refreshGeneration.current) {
        setSystem(overview);
        setRecords(next);
      }
    }
    if (selectedId.current) {
      const id = selectedId.current;
      const next = await rpc<JobDetail>("getScrapeJob", {
        id,
        eventPage: selectedEventPage.current,
      });
      if (selectedId.current === id && generation === refreshGeneration.current)
        setSelected(next);
    }
  }, [queueQuery, metadataQuery, recordQuery, tab]);

  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    const update = async () => {
      if (refreshing || busyRef.current || document.hidden) return;
      refreshing = true;
      try {
        await refresh();
      } catch (err) {
        if (!disposed) setError(err.message);
      } finally {
        refreshing = false;
      }
    };
    void update();
    const timer = live
      ? setInterval(() => {
          void update();
        }, 5000)
      : undefined;
    return () => {
      disposed = true;
      clearInterval(timer);
      refreshGeneration.current++;
    };
  }, [refresh, live]);

  async function action(
    operation: () => Promise<unknown>,
    message = "Changes saved.",
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(message);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function openJob(id: string, eventPage = 1) {
    await action(async () => {
      selectedId.current = id;
      selectedEventPage.current = eventPage;
      const next = await rpc<JobDetail>("getScrapeJob", { id, eventPage });
      if (selectedId.current === id) setSelected(next);
    }, "");
  }
  function jobAction(id: string, kind: "fasttrack" | "cancel" | "retry") {
    void action(
      () => rpc("manageScrapeJob", { id, action: kind }),
      kind === "fasttrack"
        ? "Task fast-tracked. Running work and source cooldowns are unchanged."
        : kind === "cancel"
          ? "Task cancelled."
          : "Task queued again.",
    );
  }
  function inspectCache(key: string, offset?: number) {
    const request = ++previewRequest.current;
    return action(async () => {
      const data = await rpc<CachePreview>("getMetadataCacheEntry", {
        key,
        offset,
        search: offset === undefined ? metadataQuery.search : undefined,
        confirmed: metadataQuery.confirmed === true,
      });
      if (request === previewRequest.current) setPreview({ key, ...data });
    }, "");
  }

  return (
    <main className="admin-page" id="adminMain">
      <div className="data-heading">
        <p className="eyebrow">{t("Administrator workspace")}</p>
        <h1>
          {t("Administration")}
          <span className="heading-dot">.</span>
        </h1>
        <p className="intro">
          {t(
            "Inspect system-wide activity, manage scraping, and maintain shared metadata.",
          )}
        </p>
      </div>
      <div className="admin-toolbar">
        <nav aria-label={t("Administration sections")} className="admin-tabs">
          {(
            [
              ["queue", "Scraping queue"],
              ["crawls", "Publisher crawls"],
              ["debug", "Scraper debugger"],
              ["users", "Users"],
              ["metadata", "Metadata & caches"],
              ["records", "System records"],
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              className="btn"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {t(title)}
            </button>
          ))}
        </nav>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
          />
          {t("Live updates")}
        </label>
        <button
          className="btn"
          disabled={busy}
          onClick={() => action(refresh, "View updated.")}
        >
          {t("Refresh view")}
        </button>
      </div>
      {error && !selected && !preview && (
        <div className="admin-error" role="alert">
          {t(error)}
        </div>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {t(notice)}
        </p>
      )}

      {tab === "debug" && <ScraperDebugPanel />}
      {tab === "queue" && (
        <section aria-labelledby="queueHeading">
          <div className="admin-section-heading">
            <div>
              <h2 id="queueHeading">{t("Scraping queue")}</h2>
              <p>
                {queue.paused
                  ? t(
                      "Paused — running tasks finish safely; waiting tasks stay queued.",
                    )
                  : t(
                      "Running — up to two scraping tasks at a time across all app instances.",
                    )}
              </p>
            </div>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                action(
                  () => rpc("manageScrapeQueue", { paused: !queue.paused }),
                  queue.paused ? "Queue resumed." : "Queue paused.",
                )
              }
            >
              {t(queue.paused ? "Resume queue" : "Pause queue")}
            </button>
          </div>
          <div className="admin-counts">
            {JOB_STATUSES.map((status) => (
              <button
                key={status}
                className="admin-count"
                aria-pressed={queueQuery.status === status}
                onClick={() =>
                  setQueueQuery({ ...queueQuery, status, page: 1 })
                }
              >
                <strong>{queue.counts[status]}</strong>
                {t(status)}
              </button>
            ))}
          </div>
          <form
            className="admin-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setQueueQuery({
                ...queueQuery,
                search: String(form.get("search") || ""),
                page: 1,
              });
            }}
          >
            <label>
              {t("Task status")}
              <select
                aria-label={t("Task status")}
                value={queueQuery.status}
                onChange={(e) =>
                  setQueueQuery({
                    ...queueQuery,
                    status: e.target.value as QueueQuery["status"],
                    page: 1,
                  })
                }
              >
                <option value="all">{t("All statuses")}</option>
                {JOB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Search tasks")}
              <input
                name="search"
                type="search"
                placeholder={t("Target, account or task ID")}
              />
            </label>
            <button className="btn" disabled={busy}>
              {t("Search")}
            </button>
          </form>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <caption>
                {queue.total} {t("tasks matching filters")}
              </caption>
              <thead>
                <tr>
                  {[
                    "Task",
                    "Account",
                    "Status",
                    "Attempts",
                    "Timing",
                    "Actions",
                  ].map((h) => (
                    <th key={h} scope="col">
                      {t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queue.jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <button
                        className="admin-text-button"
                        disabled={busy}
                        aria-haspopup="dialog"
                        onClick={(event) => {
                          jobTrigger.current = event.currentTarget;
                          void openJob(job.id);
                        }}
                      >
                        {job.label}
                      </button>
                      <small>{job.id}</small>
                      {job.error && (
                        <p className="admin-inline-error">{job.error}</p>
                      )}
                    </td>
                    <td>
                      {job.username}
                      <small>#{job.userId}</small>
                    </td>
                    <td>
                      <span className={`admin-status is-${job.status}`}>
                        {t(job.status)}
                      </span>
                      {job.priority >= 100 && (
                        <small>{t("Fast-tracked")}</small>
                      )}
                      {job.kind === "crawlPublisher" && (
                        <small>
                          {t("Background · yields to user lookups")}
                        </small>
                      )}
                    </td>
                    <td>
                      {job.attempts} / {job.maxAttempts}
                    </td>
                    <td>
                      <small>
                        {t("Queued")}: {formatTime(job.createdAt)}
                      </small>
                      {job.status === "queued" &&
                        job.availableAt > Date.now() && (
                          <small>
                            {t("Not before")}: {formatTime(job.availableAt)}
                          </small>
                        )}
                      {job.startedAt && (
                        <small>
                          {t("Started")}: {formatTime(job.startedAt)}
                        </small>
                      )}
                      {job.finishedAt && (
                        <small>
                          {t("Finished")}: {formatTime(job.finishedAt)}
                        </small>
                      )}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        {job.status === "queued" &&
                          job.kind !== "crawlPublisher" && (
                            <>
                              <button
                                className="btn"
                                disabled={
                                  busy ||
                                  job.priority >= 100 ||
                                  job.kind === "crawlPublisher"
                                }
                                onClick={() => jobAction(job.id, "fasttrack")}
                              >
                                {t("Fast-track")}
                              </button>
                              <button
                                className="btn"
                                disabled={busy}
                                onClick={() => jobAction(job.id, "cancel")}
                              >
                                {t("Cancel")}
                              </button>
                            </>
                          )}
                        {job.kind !== "crawlPublisher" &&
                          ["failed", "cancelled", "succeeded"].includes(
                            job.status,
                          ) && (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => jobAction(job.id, "retry")}
                            >
                              {t("Requeue")}
                            </button>
                          )}
                        {job.status === "running" && (
                          <small>
                            {t(
                              job.kind === "crawlPublisher"
                                ? "Use Publisher crawls to pause or cancel."
                                : "Finishes safely; cannot be preempted.",
                            )}
                          </small>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!queue.jobs.length && (
                  <tr>
                    <td colSpan={6}>
                      {t("No scraping tasks match these filters.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={queue.page}
            pages={queue.pages}
            disabled={busy}
            onPage={(page) => setQueueQuery({ ...queueQuery, page })}
          />
        </section>
      )}

      {tab === "crawls" && (
        <PublisherCrawlsPanel
          onInspect={(id, trigger) => {
            jobTrigger.current = trigger;
            void openJob(id);
          }}
        />
      )}
      {tab === "users" && <AdminUsersPanel />}
      {tab === "metadata" && (
        <section aria-labelledby="metadataHeading">
          <h2 id="metadataHeading">{t("Metadata & caches")}</h2>
          <p>
            {t(
              "Shared metadata and account-scoped caches across the system. Source cooldowns and stored library records are protected.",
            )}
          </p>
          <div className="admin-counts">
            <span className="admin-count">
              <strong>{metadata.summary.count}</strong>
              {t("Cache entries")}
            </span>
            <span className="admin-count">
              <strong>{formatBytes(metadata.summary.bytes, locale)}</strong>
              {t("Cached data")}
            </span>
            <span className="admin-count">
              <strong>{metadata.summary.expired}</strong>
              {t("Expired")}
            </span>
            <span className="admin-count">
              <strong>{metadata.summary.cooldowns}</strong>
              {t("Active cooldowns")}
            </span>
          </div>
          <section className="admin-card">
            <h3>{t("Force re-scrape")}</h3>
            <p>
              {t(
                "Bypasses freshness caches, never source retry cooldowns. New work is queued and remains visible here.",
              )}
            </p>
            <form
              className="admin-filters"
              onSubmit={(e) => {
                e.preventDefault();
                if (!canonicalIsbn(isbn)) {
                  setError("Enter a valid ISBN.");
                  return;
                }
                void action(
                  () =>
                    rpc("enqueueScrapeTask", {
                      kind: "lookupIsbn",
                      arg: { isbn: canonicalIsbn(isbn) },
                    }),
                  "Re-scrape queued. See the scraping queue for progress.",
                );
              }}
            >
              <label>
                {t("ISBN")}
                <input
                  value={isbn}
                  onChange={(e) => setIsbn(e.target.value)}
                  placeholder="978…"
                  required
                />
              </label>
              <button className="btn" disabled={busy}>
                {t("Re-scrape ISBN")}
              </button>
            </form>
            <form
              className="admin-filters"
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  () =>
                    rpc("enqueueMetadataRecrawl", { id: target, fillMissing }),
                  "Re-scrape queued. See the scraping queue for progress.",
                );
              }}
            >
              <label>
                {t("Known source")}
                <select
                  aria-label={t("Known source")}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  required
                >
                  <option value="">{t("Choose a source")}</option>
                  {metadata.targets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.kind} · {item.label} · {item.detail}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={fillMissing}
                  onChange={(e) => setFillMissing(e.target.checked)}
                />
                {t("Fill blank metadata in my library only")}
              </label>
              <button className="btn" disabled={busy || !target}>
                {t("Queue re-scrape")}
              </button>
            </form>
            <p>
              {t(
                "Known sources include this cache page and your own library. Use cache search to find another source.",
              )}
            </p>
          </section>
          <form
            className="admin-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setMetadataQuery({
                ...metadataQuery,
                search: String(form.get("search") || ""),
                page: 1,
              });
              setPreview(null);
            }}
          >
            <label>
              {t("Cache category")}
              <select
                aria-label={t("Cache category")}
                value={metadataQuery.group}
                onChange={(e) =>
                  setMetadataQuery({
                    ...metadataQuery,
                    group: e.target.value as MetadataQuery["group"],
                    page: 1,
                  })
                }
              >
                <option value="all">{t("All categories")}</option>
                {Object.entries(CACHE_GROUPS).map(([id, name]) => (
                  <option key={id} value={id}>
                    {t(name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Search cache")}
              <input
                type="search"
                name="search"
                placeholder={t("Title, ISBN, URL or response text")}
              />
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={metadataQuery.includePrivate || false}
                onChange={(e) => {
                  if (
                    e.target.checked &&
                    !window.confirm(
                      t(
                        "Include account-scoped caches? These may contain private series names. Confirm before loading.",
                      ),
                    )
                  )
                    return;
                  setPreview(null);
                  setMetadataQuery({
                    ...metadataQuery,
                    includePrivate: e.target.checked,
                    confirmed: e.target.checked,
                    page: 1,
                  });
                }}
              />
              {t("Include private caches")}
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={metadataQuery.expiredOnly || false}
                onChange={(e) =>
                  setMetadataQuery({
                    ...metadataQuery,
                    expiredOnly: e.target.checked,
                    page: 1,
                  })
                }
              />
              {t("Expired only")}
            </label>
            <button className="btn" disabled={busy}>
              {t("Search")}
            </button>
          </form>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <caption>
                {metadata.total} {t("cache entries matching filters")}
              </caption>
              <thead>
                <tr>
                  {[
                    "Cached record",
                    "Category",
                    "Freshness",
                    "Size",
                    "Actions",
                  ].map((h) => (
                    <th key={h} scope="col">
                      {t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metadata.entries.map((entry) => (
                  <tr key={entry.key}>
                    <td>
                      {entry.label}
                      <small>{entry.key}</small>
                    </td>
                    <td>{t(CACHE_GROUPS[entry.group])}</td>
                    <td>
                      {entry.expired
                        ? t("Expired")
                        : entry.expiresAt === 0
                          ? t("Permanent")
                          : formatTime(entry.expiresAt)}
                      <small>
                        {t("Checked")}: {formatTime(entry.checkedAt)}
                      </small>
                    </td>
                    <td>{formatBytes(entry.bytes, locale)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          className="btn"
                          disabled={busy}
                          aria-haspopup="dialog"
                          onClick={(event) => {
                            previewTrigger.current = event.currentTarget;
                            void inspectCache(entry.key);
                          }}
                        >
                          {t("Inspect")}
                        </button>
                        {entry.group !== "cooldowns" && (
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  t(
                                    "Purge this cache entry? Library records and stored covers will not be deleted.",
                                  ),
                                )
                              )
                                void action(
                                  () =>
                                    rpc("purgeMetadataCache", {
                                      key: entry.key,
                                      includePrivate:
                                        metadataQuery.includePrivate,
                                      confirmed: metadataQuery.confirmed,
                                    }),
                                  "Cache entry purged.",
                                );
                            }}
                          >
                            {t("Purge")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!metadata.entries.length && (
                  <tr>
                    <td colSpan={5}>
                      {t("No cache entries match these filters.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={metadata.page}
            pages={metadata.pages}
            disabled={busy}
            onPage={(page) => setMetadataQuery({ ...metadataQuery, page })}
          />
          {preview && (
            <AdminDialog
              title={t("Cache preview")}
              returnFocus={previewTrigger.current}
              error={error}
              onClose={() => {
                previewRequest.current++;
                setPreview(null);
              }}
            >
              <p className="admin-record-key">{preview.key}</p>
              <RecordContent
                value={preview.data}
                markup={
                  metadata.entries.find((entry) => entry.key === preview.key)
                    ?.group === "responses"
                }
                field={
                  metadata.entries.find((entry) => entry.key === preview.key)
                    ?.group === "covers"
                    ? "coverUrl"
                    : ""
                }
              />
              {preview.truncated && (
                <div className="admin-pager">
                  <button
                    className="btn"
                    disabled={busy || preview.offset === 0}
                    onClick={() =>
                      inspectCache(
                        preview.key,
                        Math.max(0, preview.offset - 16000),
                      )
                    }
                  >
                    {t("Previous text")}
                  </button>
                  <span>
                    {preview.offset + 1}–
                    {Math.min(preview.offset + 16000, preview.totalCharacters)}{" "}
                    / {preview.totalCharacters}
                  </span>
                  <button
                    className="btn"
                    disabled={busy || preview.nextOffset === null}
                    onClick={() =>
                      inspectCache(preview.key, preview.nextOffset!)
                    }
                  >
                    {t("Next text")}
                  </button>
                </div>
              )}
            </AdminDialog>
          )}
        </section>
      )}

      {tab === "records" && (
        <section aria-labelledby="recordsHeading">
          <h2 id="recordsHeading">{t("System records")}</h2>
          <p>
            {t(
              "Read-only inspection across all accounts, including private library records. Credentials and session secrets are never shown.",
            )}
          </p>
          <div className="admin-counts">
            {(["users", "books", "covers", "cache", "sessions"] as const).map(
              (key) => (
                <span key={key} className="admin-count">
                  <strong>{system.counts[key]}</strong>
                  {t(
                    key === "cache"
                      ? "Cache entries"
                      : key === "sessions"
                        ? "Session records"
                        : SYSTEM_RESOURCES[key],
                  )}
                </span>
              ),
            )}
          </div>
          <form
            className="admin-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setRecordQuery({
                ...recordQuery,
                search: String(form.get("search") || ""),
                page: 1,
              });
            }}
          >
            <label>
              {t("Record category")}
              <select
                aria-label={t("Record category")}
                value={recordQuery.resource}
                onChange={(e) => {
                  const resource = e.target.value as SystemResource;
                  const privateRecords =
                    PRIVATE_SYSTEM_RESOURCES.includes(resource);
                  if (
                    privateRecords &&
                    !window.confirm(
                      t(
                        "Load private library records? This action is restricted to administrators.",
                      ),
                    )
                  )
                    return;
                  setRecords({
                    resource,
                    rows: [],
                    total: 0,
                    page: 1,
                    pages: 1,
                  });
                  setRecordQuery({
                    resource,
                    search: "",
                    page: 1,
                    confirmed: privateRecords,
                  });
                }}
              >
                {Object.entries(SYSTEM_RESOURCES).map(([id, name]) => (
                  <option key={id} value={id}>
                    {t(name)} ({system.counts[id]})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Search records")}
              <input
                type="search"
                name="search"
                key={recordQuery.resource}
                placeholder={t("Account, title, ISBN or record ID")}
              />
            </label>
            <button className="btn" disabled={busy}>
              {t("Search")}
            </button>
          </form>
          <p>
            {records.total} {t("records matching filters")}
          </p>
          <div className="admin-records">
            {records.rows.map((row, index) => (
              <RecordCard
                key={`${records.resource}-${records.page}-${index}`}
                row={row}
                resource={records.resource}
              />
            ))}
            {!records.rows.length && (
              <p>{t("No system records match these filters.")}</p>
            )}
          </div>
          <Pager
            page={records.page}
            pages={records.pages}
            disabled={busy}
            onPage={(page) => setRecordQuery({ ...recordQuery, page })}
          />
        </section>
      )}
      {selected && (
        <AdminDialog
          title={`${t("Task details")}: ${selected.label}`}
          returnFocus={jobTrigger.current}
          error={error}
          onClose={() => {
            selectedId.current = null;
            setSelected(null);
          }}
        >
          <p>
            {selected.id} · {selected.username} · {t(selected.status)}
          </p>
          {selected.error && (
            <div className="admin-error" role="alert">
              <h4>{t("Failure reason")}</h4>
              <p>{selected.error}</p>
            </div>
          )}
          <ol className="admin-events" tabIndex={0}>
            {selected.events.map((event) => (
              <li key={event.id}>
                <time>{formatTime(event.createdAt)}</time> — {event.message}
                {event.actor ? ` · ${event.actor}` : ""}
              </li>
            ))}
          </ol>
          {selected.eventPages > 1 && (
            <Pager
              page={selected.eventPage}
              pages={selected.eventPages}
              disabled={busy}
              onPage={(eventPage) => {
                if (eventPage > 1) setLive(false);
                void openJob(selected.id, eventPage);
              }}
            />
          )}
          <section className="admin-task-content">
            <h4>{t("Task input")}</h4>
            <RecordContent value={selected.payload} />
          </section>
          <section className="admin-task-content">
            <h4>{t("Task result")}</h4>
            {selected.result === null ? (
              <p className="admin-empty-value">{t("No result yet.")}</p>
            ) : (
              <RecordContent value={selected.result} />
            )}
          </section>
        </AdminDialog>
      )}
    </main>
  );
}
