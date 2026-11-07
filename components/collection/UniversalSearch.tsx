"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { seriesPath } from "../../lib/domain/navigation.ts";
import {
  runUniversalSearch,
  type SearchProgress,
} from "../../lib/client/universal-search.ts";
import Icon from "../Icon";
import ExternalLink from "../ExternalLink";
import { useTranslations } from "../PreferencesProvider";

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
        <label className="field" htmlFor="universalSearchQuery">
          <span>{t("Title, publisher or ISBN")}</span>
          <input
            id="universalSearchQuery"
            type="search"
            value={query}
            maxLength={200}
            placeholder={t("Search Thai, English or Japanese titles…")}
            enterKeyHint="search"
            autoComplete="off"
            aria-describedby={
              error
                ? "universalSearchHint universalSearchError"
                : "universalSearchHint"
            }
            aria-invalid={!!error}
            onChange={(event) => {
              pending.current?.abort();
              setQuery(event.target.value);
              setProgress(null);
              setError("");
              setLoading(false);
            }}
          />
        </label>
        <button className="btn primary" type="submit">
          <Icon name="search" />
          {t("Search")}
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
      <p className="universal-search-status" role="status" aria-live="polite">
        {loading && !progress
          ? t("Looking up known titles…")
          : progress
            ? loading
              ? t("{count} matches · Checking sources {done}/{total}…", {
                  count: progress.results.length,
                  done: completed,
                  total: progress.sources.length,
                })
              : t("{count} matches · Search complete", {
                  count: progress.results.length,
                })
            : ""}
      </p>
      {unavailable.length > 0 && (
        <p className="price-warning">
          {t("Could not check {sources}. Other matches are still available.", {
            sources: unavailable.map((source) => source.name).join(", "),
          })}
        </p>
      )}
      {progress && progress.results.length > 0 && (
        <ol
          className="universal-search-results"
          aria-label={t("Search results")}
        >
          {progress.results.map((item) => (
            <li key={item.id} className="universal-search-result">
              <div className="universal-search-result-heading">
                <h2>
                  {item.librarySeries ? (
                    <a href={seriesPath(item.librarySeries)}>{item.title}</a>
                  ) : item.url ? (
                    <ExternalLink href={item.url} target="_blank">
                      {item.title} ↗
                    </ExternalLink>
                  ) : (
                    item.title
                  )}
                </h2>
                <span className="universal-search-label">
                  {t(
                    item.owned
                      ? "In your library"
                      : item.kind === "publisher"
                        ? "Publisher"
                        : item.kind === "store"
                          ? "Bookshop"
                          : item.known
                            ? "Previously found"
                            : "Found online",
                  )}
                </span>
              </div>
              {item.kind === "title" && (
                <p className="hint">
                  {[
                    item.publisher,
                    t(item.type),
                    item.volume !== ""
                      ? t("Volume {volume}", { volume: item.volume })
                      : "",
                    item.isbn ? "ISBN " + item.isbn : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <div className="universal-search-links">
                {item.sources
                  .filter((source) => source.url && source.id !== "library")
                  .map((source) => (
                    <ExternalLink
                      key={source.id + source.url}
                      href={source.url}
                      target="_blank"
                    >
                      {source.name} ↗
                    </ExternalLink>
                  ))}
                {item.isbn && (
                  <a href={"/prices?isbn=" + item.isbn}>
                    {t("Compare prices")}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
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
        <div className="price-intro">
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
