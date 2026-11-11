"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  runUniversalSearch,
  type SearchProgress,
} from "../../lib/client/universal-search.ts";
import Icon from "../Icon";
import SearchResults from "./SearchResults";
import SearchQueryInput from "./SearchQueryInput";
import { useTranslations } from "../PreferencesProvider";
import LoadingStatus from "../LoadingStatus";
import { activity } from "../../lib/client/activity.ts";

export default function UniversalSearch({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const t = useTranslations();
  const [query, setQuery] = useState(initialQuery);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [grouped, setGrouped] = useState(true);
  const pending = useRef<AbortController | null>(null);

  const search = useCallback(
    async (raw: string) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      const query = raw.trim();
      setError("");
      setProgress(null);
      if (query.length < 2 || query.length > 200) {
        setLoading(false);
        setError(t("Enter a title, publisher or ISBN (2–200 characters)."));
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("q", query);
      window.history.replaceState(null, "", url);
      setLoading(true);
      const finish = activity.begin("Searching…", controller.signal);
      try {
        await runUniversalSearch({
          query,
          signal: controller.signal,
          onProgress: setProgress,
          rpc: async (name, arg, signal) => {
            const response = await fetch("/api/rpc", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, arg }),
              signal,
            });
            if (response.status === 401) {
              window.location.assign(
                "/login?returnTo=" +
                  encodeURIComponent(url.pathname + url.search),
              );
              throw new Error("Sign in to open your library.");
            }
            const data = await response.json();
            if (!response.ok)
              throw new Error(
                data.message || "Search could not finish. Try again.",
              );
            return data;
          },
        });
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            t(
              cause instanceof Error
                ? cause.message
                : "Search could not finish. Try again.",
            ),
          );
      } finally {
        finish();
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (initialQuery.trim()) void search(initialQuery);
    return () => pending.current?.abort();
  }, [initialQuery, search]);

  const completed =
    progress?.sources.filter((source) => source.status !== "pending").length ||
    0;
  const unavailable =
    progress?.sources.filter((source) => source.status === "unavailable") || [];
  return (
    <section
      className="universal-search"
      aria-labelledby="universalSearchTitle"
    >
      <div className="release-heading">
        <div>
          <h1 id="universalSearchTitle">{t("Search everywhere")}</h1>
          <p className="release-note">
            {t(
              "Your library first. Then publishers and bookshops, without waiting.",
            )}
          </p>
        </div>
      </div>
      <form
        className="universal-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
        }}
      >
        <SearchQueryInput
          query={query}
          error={error}
          searching={loading}
          onChange={(value) => {
            pending.current?.abort();
            setQuery(value);
            setProgress(null);
            setError("");
            setLoading(false);
          }}
        />
        <button
          className="btn primary"
          type="submit"
          disabled={loading}
          aria-busy={loading}
        >
          {!loading && <Icon name="search" />}
          {t(loading ? "Searching…" : "Search")}
        </button>
      </form>
      <p id="universalSearchHint" className="hint">
        {t(
          "Known matches appear first. Better matches move up as sources respond.",
        )}
      </p>
      {error && (
        <p id="universalSearchError" className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="universal-search-toolbar">
        {loading ? (
          <LoadingStatus
            className="universal-search-loading"
            label={t("Searching…")}
            detail={
              progress
                ? t("{count} matches · Checking sources {done}/{total}…", {
                    count: progress.results.length,
                    done: completed,
                    total: progress.sources.length,
                  })
                : t("Looking up known titles…")
            }
            completed={completed}
            total={progress?.sources.length}
          />
        ) : (
          <p className="universal-search-status" role="status">
            {progress &&
              !error &&
              t("{count} matches · Search complete", {
                count: progress.results.length,
              })}
          </p>
        )}
        <button
          className="btn universal-search-group-toggle"
          type="button"
          aria-pressed={grouped}
          aria-controls={
            progress?.results.length ? "universalSearchResults" : undefined
          }
          onClick={() => setGrouped((value) => !value)}
        >
          <Icon name="books" />
          {t("Group series")}
        </button>
      </div>
      {unavailable.length > 0 && (
        <p className="price-warning">
          {t("Could not check {sources}. Other matches are still available.", {
            sources: unavailable.map((source) => source.name).join(", "),
          })}
        </p>
      )}
      {progress && progress.results.length > 0 && (
        <SearchResults
          results={progress.results}
          query={progress.query}
          grouped={grouped}
        />
      )}
      {progress && !progress.results.length && (
        <div className="empty">
          <h2>
            {t(loading ? "No known matches yet" : "No matching titles found")}
          </h2>
          <p>
            {t(
              loading
                ? "Publishers and bookshops are still being checked."
                : "Try another title, part of a name or an ISBN.",
            )}
          </p>
        </div>
      )}
      {!progress && !loading && !error && (
        <div className="universal-search-intro">
          <h2>{t("One search, across your book world.")}</h2>
          <p>
            {t(
              "Find books you own, previously discovered titles, and new listings from sources that match your search language.",
            )}
          </p>
        </div>
      )}
      {!!progress?.sources.length && (
        <details className="price-sources">
          <summary>
            {t("Search sources ({count})", { count: progress.sources.length })}
          </summary>
          <ul>
            {progress.sources.map((source) => (
              <li key={source.id}>
                <strong>{source.name}</strong>
                <span className="hint">
                  {t(
                    source.status === "pending"
                      ? "Checking…"
                      : source.status === "unavailable"
                        ? "Unavailable"
                        : source.status === "partial"
                          ? "First results checked"
                          : "Checked",
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
