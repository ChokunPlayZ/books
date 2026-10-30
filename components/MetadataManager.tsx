"use client";

import { useEffect, useRef, useState } from "react";
import { CACHE_GROUPS } from "../lib/metadata";
import type {
  CacheEntry,
  CrawlResult,
  CrawlTarget,
  MetadataOverview,
  MetadataQuery,
} from "../lib/metadata";

async function rpc<T>(name: string, arg?: unknown): Promise<T> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arg }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "The request failed. Try again.");
  return data;
}
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const timestamp = (value: string | number) =>
  value
    ? new Date(value).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "Not recorded";

function CachedRecord({
  entry,
  disabled,
  onPurge,
}: {
  entry: CacheEntry;
  disabled: boolean;
  onPurge: () => void;
}) {
  const [preview, setPreview] = useState<{
    content: string;
    truncated: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function inspect() {
    if (preview) return;
    setLoading(true);
    setError("");
    try {
      setPreview(await rpc("getMetadataCacheEntry", { key: entry.key }));
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <li className="metadata-record">
      <details
        onToggle={(event) => {
          if (event.currentTarget.open) void inspect();
        }}
      >
        <summary>
          <span className="metadata-record-label">
            {entry.label}
            <small>
              {CACHE_GROUPS[entry.group]} · {size(entry.bytes)}
            </small>
          </span>
          <span className="metadata-record-state">
            {entry.expired
              ? "Expired"
              : entry.group === "cooldowns"
                ? "Cooling down"
                : "Retained"}
          </span>
        </summary>
        <div className="metadata-record-body">
          <dl>
            <div>
              <dt>Last checked</dt>
              <dd>{timestamp(entry.checkedAt)}</dd>
            </div>
            <div>
              <dt>
                {entry.group === "cooldowns" ? "Retry after" : "Retained until"}
              </dt>
              <dd>{timestamp(entry.expiresAt)}</dd>
            </div>
          </dl>
          <p className="metadata-key">{entry.key}</p>
          {loading && <p role="status">Loading cached content…</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <>
              <pre tabIndex={0} aria-label="Cached content">
                {preview.content}
              </pre>
              {preview.truncated && (
                <p className="hint">
                  Preview limited to the first 16,000 characters.
                </p>
              )}
            </>
          )}
          {entry.group !== "cooldowns" && (
            <button
              className="btn danger"
              disabled={disabled}
              onClick={onPurge}
            >
              Purge this record
            </button>
          )}
        </div>
      </details>
    </li>
  );
}

export default function MetadataManager({
  initial,
}: {
  initial: MetadataOverview;
}) {
  const [overview, setOverview] = useState(initial);
  const [query, setQuery] = useState<MetadataQuery>({
    group: "all",
    search: "",
    page: 1,
  });
  const [loading, setLoading] = useState(false),
    [purging, setPurging] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [kind, setKind] = useState<CrawlTarget["kind"] | "all">("all");
  const [targetId, setTargetId] = useState("all"),
    [fillMissing, setFillMissing] = useState(false);
  const [running, setRunning] = useState(false),
    [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [results, setResults] = useState<(CrawlResult & { label: string })[]>(
    [],
  );
  const [confirmPurge, setConfirmPurge] = useState(false);
  const stop = useRef(false),
    mounted = useRef(true),
    revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  async function reload(filters = query) {
    const current = ++revision.current;
    setLoading(true);
    try {
      const data = await rpc<MetadataOverview>("getMetadataOverview", filters);
      if (mounted.current && current === revision.current) setOverview(data);
    } catch (error) {
      if (mounted.current && current === revision.current)
        setError(error.message);
    } finally {
      if (mounted.current && current === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    setConfirmPurge(false);
    const timer = window.setTimeout(() => {
      void reload(query);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      revision.current++;
    };
    // Each response is guarded so an older search cannot replace a newer one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const eligible = overview.targets.filter(
    (target) => kind === "all" || target.kind === kind,
  );
  const queue =
    targetId === "all"
      ? eligible
      : eligible.filter((target) => target.id === targetId);
  async function purge(key?: string, expiredOnly?: boolean) {
    setPurging(true);
    setError("");
    setNotice("");
    setConfirmPurge(false);
    try {
      const result = await rpc<{ purged: number }>("purgeMetadataCache", {
        ...query,
        ...(expiredOnly ? { expiredOnly: true } : {}),
        ...(key ? { key } : {}),
      });
      setNotice(
        `Purged ${result.purged} cached record${result.purged === 1 ? "" : "s"}.`,
      );
      await reload();
    } catch (error) {
      setError(error.message);
    } finally {
      setPurging(false);
    }
  }
  async function recrawl() {
    if (!queue.length) return;
    const selected = [...queue];
    stop.current = false;
    setStopping(false);
    setRunning(true);
    setResults([]);
    setError("");
    setNotice("");
    setProgress({ done: 0, total: selected.length, label: selected[0].label });
    let done = 0;
    try {
      for (const target of selected) {
        if (stop.current) break;
        setProgress({ done, total: selected.length, label: target.label });
        let result: CrawlResult;
        try {
          result = await rpc<CrawlResult>("recrawlMetadata", {
            id: target.id,
            fillMissing,
          });
        } catch (error) {
          result = {
            id: target.id,
            filled: 0,
            status: "failed",
            message: error.message,
          };
        }
        done++;
        if (!mounted.current) break;
        setResults((previous) => [
          ...previous,
          { ...result, label: target.label },
        ]);
        setProgress({ done, total: selected.length, label: target.label });
      }
      if (mounted.current) {
        setNotice(
          `${stop.current ? "Stopped" : "Re-crawl finished"}. Checked ${done} of ${selected.length} sources.`,
        );
        await reload();
      }
    } finally {
      if (mounted.current) {
        setRunning(false);
        setStopping(false);
      }
    }
  }
  const locked = running || purging;
  const purgeable =
    overview.total -
    (query.group === "cooldowns"
      ? overview.total
      : query.group === "all" && !query.search && !query.expiredOnly
        ? overview.groups.find((group) => group.id === "cooldowns").count
        : 0);
  return (
    <section
      id="metadata-maintenance"
      className="metadata-maintenance"
      aria-labelledby="metadata-title"
    >
      <div className="metadata-heading">
        <div>
          <h2 id="metadata-title">Metadata &amp; cache</h2>
          <p>
            Inspect saved source data, refresh catalogs, and fill gaps in your
            books.
          </p>
        </div>
        <button
          className="btn"
          disabled={locked || loading}
          onClick={() => {
            setError("");
            void reload();
          }}
        >
          {loading ? "Reloading…" : "Reload status"}
        </button>
      </div>
      <div className="metadata-summary" aria-label="Cache status">
        <span>
          <strong>{overview.summary.count}</strong> cached records
        </span>
        <span>
          <strong>{size(overview.summary.bytes)}</strong> stored
        </span>
        <span>
          <strong>{overview.summary.expired}</strong> expired
        </span>
        <span>
          <strong>{overview.summary.cooldowns}</strong> sources cooling down
        </span>
      </div>
      <div className="metadata-crawl">
        <h3>Re-crawl sources</h3>
        <p>
          Fetch fresh data for your library ISBNs, linked series, and previously
          checked publisher feeds. Failed sources keep their retry cooldown.
        </p>
        <div className="metadata-coverage">
          {overview.coverage.books} owned books · {overview.coverage.withIsbn}{" "}
          with an ISBN · {overview.coverage.missingPages} missing pages ·{" "}
          {overview.coverage.missingCover} missing a cover ·{" "}
          {overview.coverage.missingLink} missing a publisher link
        </div>
        <div className="metadata-crawl-fields">
          <label>
            Source type
            <select
              value={kind}
              aria-label="Source type"
              disabled={locked}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
                setTargetId("all");
              }}
            >
              <option value="all">All source types</option>
              <option value="isbn">ISBN metadata</option>
              <option value="series">Linked series</option>
              <option value="releases">Release feeds</option>
              <option value="catalog">Publisher categories</option>
              <option value="directory">Publisher directories</option>
            </select>
          </label>
          <label>
            Source
            <select
              value={targetId}
              aria-label="Source"
              disabled={locked}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="all">All {eligible.length} sources</option>
              {eligible.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label} · {target.detail}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="metadata-fill">
          <input
            type="checkbox"
            checked={fillMissing}
            disabled={locked}
            onChange={(event) => setFillMissing(event.target.checked)}
          />
          <span>
            Fill missing book metadata
            <small>
              For exact ISBN matches, fill blank pages, covers, and publisher
              links. Existing values and collection details stay as you entered
              them.
            </small>
          </span>
        </label>
        <div className="metadata-actions">
          <button
            className="btn primary"
            disabled={locked || !queue.length}
            onClick={() => void recrawl()}
          >
            {running
              ? `Checking ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
              : `Re-crawl ${queue.length === 1 ? "source" : `${queue.length} sources`}`}
          </button>
          {running && (
            <button
              className="btn"
              disabled={stopping}
              onClick={() => {
                stop.current = true;
                setStopping(true);
              }}
            >
              {stopping
                ? "Stopping after this source…"
                : "Stop after current source"}
            </button>
          )}
        </div>
        {!overview.targets.length && (
          <p className="hint">
            Add a book with an ISBN, link a series catalog, or check a publisher
            feed to make it available here.
          </p>
        )}
        {running && (
          <div className="metadata-progress" role="status">
            <progress
              value={progress.done}
              max={progress.total}
              aria-label="Re-crawl progress"
            />
            <p>
              {progress.done} of {progress.total} checked · {progress.label}
              {stopping ? " · Stopping after this source" : ""}
            </p>
            <p className="hint">
              Keep this page open. Leaving stops the remaining queue after the
              current source.
            </p>
          </div>
        )}
        {results.length > 0 && (
          <details className="metadata-results" open>
            <summary>
              Re-crawl results ·{" "}
              {results.filter((result) => result.status === "updated").length}{" "}
              updated ·{" "}
              {results.filter((result) => result.status === "warning").length}{" "}
              with warnings ·{" "}
              {results.filter((result) => result.status === "failed").length}{" "}
              failed
            </summary>
            <ul>
              {results.map((result) => (
                <li key={result.id}>
                  <strong>{result.label}</strong>
                  <span
                    className={
                      result.status === "failed" ? "metadata-failed" : ""
                    }
                  >
                    {result.status === "updated"
                      ? "Updated"
                      : result.status === "warning"
                        ? "Warning"
                        : "Failed"}{" "}
                    · {result.message}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="metadata-notice" role="status">
          {notice}
        </p>
      )}
      <div className="metadata-cache">
        <h3>Cached records</h3>
        <p>
          Purging removes downloaded responses and lookup results. Your books,
          saved releases, catalog links, and stored cover images are kept.
          Cooldowns are protected.
        </p>
        <div className="metadata-filters">
          <label>
            Search records
            <input
              type="search"
              value={query.search}
              placeholder="ISBN, title, URL, or cache key"
              onChange={(event) =>
                setQuery({ ...query, search: event.target.value, page: 1 })
              }
            />
          </label>
          <label>
            Category
            <select
              value={query.group}
              aria-label="Category"
              onChange={(event) =>
                setQuery({
                  ...query,
                  group: event.target.value as MetadataQuery["group"],
                  page: 1,
                })
              }
            >
              <option value="all">All categories</option>
              {overview.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {CACHE_GROUPS[group.id]} ({group.count})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="metadata-cache-toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={!!query.expiredOnly}
              onChange={(event) =>
                setQuery({
                  ...query,
                  expiredOnly: event.target.checked,
                  page: 1,
                })
              }
            />
            Expired only
          </label>
          <div className="metadata-actions">
            <button
              className="btn"
              disabled={
                locked ||
                loading ||
                !overview.summary.expired ||
                query.group === "cooldowns"
              }
              onClick={() => void purge(undefined, true)}
            >
              Purge expired
            </button>
            <button
              className="btn danger"
              disabled={locked || loading || !purgeable}
              onClick={() => setConfirmPurge(true)}
            >
              Purge filtered records
            </button>
          </div>
        </div>
        {confirmPurge && (
          <div className="metadata-confirm">
            <p>
              Purge the records matching these filters? They will be fetched
              again when needed. Retry cooldowns will be kept.
            </p>
            <div className="metadata-actions">
              <button
                className="btn danger"
                disabled={locked || loading}
                onClick={() => void purge()}
              >
                Confirm purge
              </button>
              <button className="btn" onClick={() => setConfirmPurge(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div aria-busy={loading || purging}>
          <p className="hint">
            {overview.total} matching records · Values are retained for reuse;
            each source has its own refresh interval.
          </p>
          {overview.entries.length ? (
            <ul className="metadata-records">
              {overview.entries.map((entry) => (
                <CachedRecord
                  key={entry.key + entry.expiresAt}
                  entry={entry}
                  disabled={locked || loading}
                  onPurge={() => void purge(entry.key)}
                />
              ))}
            </ul>
          ) : (
            <p className="metadata-empty">
              {query.search || query.group !== "all" || query.expiredOnly
                ? "No records match these filters. Clear the search or choose another category."
                : "No cached records yet. ISBN lookups and publisher checks will appear here."}
            </p>
          )}
        </div>
        {overview.pages > 1 && (
          <nav className="metadata-pagination" aria-label="Cached record pages">
            <button
              className="btn"
              disabled={loading || overview.page === 1}
              onClick={() => setQuery({ ...query, page: overview.page - 1 })}
            >
              Previous
            </button>
            <span>
              Page {overview.page} of {overview.pages}
            </span>
            <button
              className="btn"
              disabled={loading || overview.page === overview.pages}
              onClick={() => setQuery({ ...query, page: overview.page + 1 })}
            >
              Next
            </button>
          </nav>
        )}
      </div>
    </section>
  );
}
