"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  groupSearchResults,
  type SearchResult,
} from "../../lib/domain/search.ts";
import { seriesPath } from "../../lib/domain/navigation.ts";
import { useTranslations } from "../PreferencesProvider";
import ExternalLink from "../ExternalLink";
import Icon from "../Icon";
import CoverImage from "./CoverImage";

function SearchCover({ item, query }: { item: SearchResult; query: string }) {
  const t = useTranslations();
  const frame = useRef<HTMLSpanElement>(null);
  const [resolved, setResolved] = useState<{
    source: string;
    coverId: string;
    coverBlurhash?: string;
  } | null>(null);

  useEffect(() => {
    if (item.coverId || !item.coverUrl || !frame.current) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "getSearchCover",
            arg: { query, id: item.id },
          }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = await response.json();
        if (!controller.signal.aborted)
          setResolved({ ...result, source: item.coverUrl });
      } catch {
        // A failed cover must not hide a usable search result.
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(frame.current);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [item.id, item.coverId, item.coverUrl, query]);

  const cover = resolved?.source === item.coverUrl ? resolved : null;
  return (
    <span ref={frame} className="universal-search-cover">
      <CoverImage
        id={item.coverId || cover?.coverId}
        blurhash={item.coverBlurhash || cover?.coverBlurhash}
        className="cover-frame shelf-cover volume-cover"
      >
        <span className="cover-placeholder">
          <Icon name="books" />
          <span className="placeholder-title">{item.title}</span>
          <span className="placeholder-label">{t("No cover")}</span>
        </span>
      </CoverImage>
    </span>
  );
}

function ResultLink({
  item,
  children,
  className,
}: {
  item: SearchResult;
  children: ReactNode;
  className?: string;
}) {
  if (item.librarySeries)
    return (
      <a className={className} href={seriesPath(item.librarySeries)}>
        {children}
      </a>
    );
  if (item.url)
    return (
      <ExternalLink className={className} href={item.url} target="_blank">
        {children}
      </ExternalLink>
    );
  return <div className={className}>{children}</div>;
}

function ResultLabel({ item }: { item: SearchResult }) {
  const t = useTranslations();
  return (
    <span className="universal-search-label" data-owned={item.owned}>
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
  );
}

function ResultSources({ item }: { item: SearchResult }) {
  const sources = item.sources.filter(
    (source) => source.url && source.id !== "library",
  );
  if (!sources.length) return null;
  return (
    <div className="universal-search-links">
      {sources.map((source) => (
        <ExternalLink
          key={source.id + source.url}
          href={source.url}
          target="_blank"
        >
          {source.name} ↗
        </ExternalLink>
      ))}
    </div>
  );
}

function ResultCard({ item, query }: { item: SearchResult; query: string }) {
  const t = useTranslations();
  return (
    <>
      <ResultLink item={item} className="universal-search-book">
        {item.kind === "title" ? (
          <SearchCover item={item} query={query} />
        ) : (
          <span className="universal-search-entity" aria-hidden="true">
            <Icon name={item.kind === "publisher" ? "books" : "search"} />
          </span>
        )}
        <h2 className="shelf-caption">{item.title}</h2>
      </ResultLink>
      <ResultLabel item={item} />
      {item.kind === "title" && (
        <>
          <p className="shelf-detail">
            {[
              item.volume !== ""
                ? t("Volume {volume}", { volume: item.volume })
                : "",
              t(item.edition || item.type),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {item.publisher && <p className="shelf-detail">{item.publisher}</p>}
          {item.isbn && (
            <p className="universal-search-isbn">ISBN {item.isbn}</p>
          )}
        </>
      )}
      <ResultSources item={item} />
    </>
  );
}

export default function SearchResults({
  results,
  query,
  grouped,
}: {
  results: SearchResult[];
  query: string;
  grouped: boolean;
}) {
  const t = useTranslations();
  const groups = grouped
    ? groupSearchResults(results)
    : results.map((item) => ({
        id: item.id,
        title: item.title,
        items: [item],
      }));
  return (
    <ol
      id="universalSearchResults"
      className="universal-search-results"
      aria-label={t("Search results")}
    >
      {groups.map((group) => {
        if (group.items.length === 1)
          return (
            <li key={group.id} className="universal-search-result">
              <ResultCard item={group.items[0]} query={query} />
            </li>
          );
        const representative =
          group.items.find((item) => item.coverId || item.coverUrl) ||
          group.items[0];
        return (
          <li
            key={group.id}
            className="universal-search-result universal-search-series"
          >
            <details className="universal-search-volumes">
              <summary>
                <SearchCover item={representative} query={query} />
                <h2 className="shelf-caption">{group.title}</h2>
                <span className="shelf-detail">
                  {[
                    representative.publisher,
                    t(representative.edition || representative.type),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {group.items.some((item) => item.owned) && (
                  <span className="universal-search-label" data-owned="true">
                    {t("In your library")}
                  </span>
                )}
                <span className="universal-search-group-action">
                  {t("View {count} matches", { count: group.items.length })}
                </span>
              </summary>
              <ol>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <ResultLink item={item} className="universal-search-volume">
                      <SearchCover item={item} query={query} />
                      <span>
                        <span className="shelf-caption">{item.title}</span>
                        <span className="shelf-detail">
                          {item.volume !== ""
                            ? t("Volume {volume}", { volume: item.volume })
                            : t("Series")}
                        </span>
                      </span>
                    </ResultLink>
                    <ResultLabel item={item} />
                    {item.isbn && (
                      <p className="universal-search-isbn">ISBN {item.isbn}</p>
                    )}
                    <ResultSources item={item} />
                  </li>
                ))}
              </ol>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
