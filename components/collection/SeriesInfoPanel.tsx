"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "../PreferencesProvider";
import ExternalLink from "../ExternalLink";
import { normalizeBookType } from "../../lib/domain/book-type.ts";
import type { StoredBook } from "../../lib/types.ts";
import type { SeriesInfo } from "../../lib/domain/series-info.ts";
import { preferredSynopses } from "../../lib/domain/metadata-source.ts";
import {
  languageName,
  metadataBrowsePath,
} from "../../lib/domain/series-detail.ts";
import CoverImage from "./CoverImage";
import MetadataFacts from "./MetadataFacts";
import SuggestEditMenu from "./SuggestEditMenu";
import SeriesLanguageDetails from "./SeriesLanguageDetails";

function emptyInfo(series: string, type: string): SeriesInfo {
  return {
    series,
    type,
    workId: "",
    titles: [],
    synopses: [],
    editions: [],
    candidates: [],
    warnings: [],
  };
}

async function rpc(
  name: string,
  arg: unknown,
  signal?: AbortSignal,
): Promise<SeriesInfo> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arg }),
    signal,
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.message || "The request could not finish.");
  return value;
}

function waitForDiscovery(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 1500);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export default function SeriesInfoPanel({
  series,
  books,
  userId,
  header,
  children,
}: {
  series: string;
  books: StoredBook[];
  userId: number;
  header: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations();
  const types = [
    ...new Set(
      books
        .filter((book) => book.series === series)
        .map((book) => normalizeBookType(book.type)),
    ),
  ];
  const [type, setType] = useState<string>(types[0] || "Others");
  const [info, setInfo] = useState<SeriesInfo>(() => emptyInfo(series, type));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(series.slice(0, 200));
  const [titleLanguage, setTitleLanguage] = useState("");
  const [synopsisLanguage, setSynopsisLanguage] = useState("");
  const [targetSeries, setTargetSeries] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const matchingDisclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (info?.candidates.length && matchingDisclosure.current)
      matchingDisclosure.current.open = true;
  }, [info?.candidates]);
  const key = userId + ":" + (info?.workId || series);
  const language = (code: string) => t(languageName(code));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setBusy(true);
    setInfo(emptyInfo(series, type));
    setError("");
    rpc("getSeriesInfo", { series, type }, controller.signal)
      .then(async (saved) => {
        if (controller.signal.aborted) return;
        setInfo(saved);
        setLoading(false);
        let discovered = await rpc(
          "pullSeriesInfo",
          { series, type, automatic: true },
          controller.signal,
        );
        while (discovered.discoveryJobId && !controller.signal.aborted) {
          await waitForDiscovery(controller.signal);
          discovered = await rpc(
            "getSeriesDiscovery",
            { series, type, id: discovered.discoveryJobId },
            controller.signal,
          );
        }
        if (!controller.signal.aborted) setInfo(discovered);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [series, type]);
  useEffect(() => {
    try {
      setTitleLanguage(
        localStorage.getItem("series-title-language:" + key) || "",
      );
      setSynopsisLanguage(
        localStorage.getItem("series-synopsis-language:" + key) || "",
      );
    } catch {}
  }, [key]);
  useEffect(() => {
    const title =
      info?.titles.find((item) => item.language === titleLanguage)?.title ||
      series;
    const heading = document.getElementById("seriesTitle");
    if (!heading) return;
    heading.dataset.translatedTitle = title;
    heading.textContent = title;
    heading.lang = titleLanguage || "";
    return () => {
      delete heading.dataset.translatedTitle;
      heading.textContent = series;
      heading.lang = "";
    };
  }, [info, titleLanguage, series]);
  useEffect(() => {
    const heading = document.getElementById("seriesTitle");
    if (!heading) return;
    const title = ["en", "ja-Latn", "ja"].flatMap((language) =>
      info.titles.filter(
        (item) =>
          item.language === language &&
          item.url === `https://anilist.co/manga/${info.workId.split(":")[1]}`,
      ),
    )[0];
    if (!title) return;
    heading.dataset.anilistSearch = title.title;
    window.dispatchEvent(new Event("series-metadata-ready"));
    return () => {
      delete heading.dataset.anilistSearch;
    };
  }, [info]);

  async function run(name: string, extra = {}) {
    setBusy(true);
    setError("");
    try {
      setInfo(await rpc(name, { series, type, ...extra }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  const synopses = preferredSynopses(info.synopses);
  const editionLanguage = info.editions.find(
    (edition) => edition.series === series,
  )?.language;
  const synopsis =
    synopses.find((item) => item.language === synopsisLanguage) ||
    synopses.find((item) => item.language === editionLanguage) ||
    synopses[0];
  const targets = [
    ...new Set(
      books
        .filter(
          (book) =>
            book.series !== series && normalizeBookType(book.type) === type,
        )
        .map((book) => book.series),
    ),
  ].sort();
  const languages = [
    ...new Set(info?.titles.map((item) => item.language) || []),
  ];
  const owned = books.filter((book) => book.series === series);
  const cover = owned.find((book) => book.coverId) || owned[0];
  const banner = info?.images?.find((image) => image.kind === "banner");
  const sourceCover = info?.images?.find((image) => image.kind === "cover");
  const facts = [
    ...(info?.facts || []),
    ...[...new Set(owned.map((book) => book.publisher).filter(Boolean))]
      .filter(
        (publisher) =>
          !info?.facts?.some(
            (fact) => fact.label === "Publisher" && fact.value === publisher,
          ),
      )
      .map((publisher) => ({
        label: "Publisher",
        value: publisher,
        source: t("Your library"),
        url:
          owned.find((book) => book.publisher === publisher)?.publisherUrl ||
          "",
      })),
  ];

  return (
    <section
      className="series-info"
      aria-label={t("Series languages & synopsis")}
      aria-busy={busy || loading}
    >
      <div
        className={
          "series-profile-hero" + (banner?.coverId ? " has-banner" : "")
        }
      >
        {banner?.coverId && (
          <div className="series-profile-banner">
            <img src={"/api/covers/" + banner.coverId} alt="" />
            <ExternalLink href={banner.sourceUrl} target="_blank">
              {t("Artwork")} · {banner.source}
            </ExternalLink>
          </div>
        )}
        <div className="series-profile-heading">
          <CoverImage
            id={cover?.coverId || sourceCover?.coverId}
            blurhash={cover?.coverBlurhash}
            className="series-profile-cover"
          >
            <span className="cover-placeholder">{t("No cover")}</span>
          </CoverImage>
          <div className="series-profile-title">
            {header}
            <div className="series-profile-tags">
              <a href={metadataBrowsePath("Format", type)}>{t(type)}</a>
              {info?.tags
                ?.filter((tag) => tag.kind !== "Spoiler tag")
                .map((tag) => (
                  <a
                    key={tag.name + tag.url}
                    href={metadataBrowsePath(tag.kind, tag.name)}
                    title={tag.source}
                  >
                    {tag.name}
                  </a>
                ))}
            </div>
          </div>
        </div>
      </div>
      <nav className="series-section-nav" aria-label={t("Series sections")}>
        <a href="#seriesMetadata">{t("Information")}</a>
        <a href="#bookList">{t("Owned volumes")}</a>
        <a href="#seriesLanguages">{t("Titles & languages")}</a>
        <a href="#seriesCorrections">{t("Corrections & sources")}</a>
      </nav>
      <div className="series-info-heading" id="seriesMetadata">
        <h2>{t("Series information")}</h2>
        <button
          className="btn"
          type="button"
          disabled={busy || loading}
          onClick={() => run("pullSeriesInfo")}
        >
          {t(busy ? "Finding series details…" : "Refresh details")}
        </button>
      </div>
      {loading && (
        <p className="hint" role="status">
          {t("Loading series details…")}
        </p>
      )}
      {busy && !loading && (
        <p className="hint" role="status">
          {t("Finding series details…")}
        </p>
      )}
      {error && (
        <p className="banner" role="alert">
          {t(error)}
        </p>
      )}
      {types.length > 1 && (
        <label className="field">
          <span>{t("Book type")}</span>
          <select
            value={type}
            disabled={busy}
            onChange={(event) => setType(event.target.value)}
          >
            {types.map((item) => (
              <option key={item}>{t(item)}</option>
            ))}
          </select>
        </label>
      )}
      {info && (
        <div className="series-information-grid">
          <div className="series-description-column">
            {languages.length > 0 && (
              <label className="field series-info-language">
                <span>{t("View series title in")}</span>
                <select
                  value={titleLanguage}
                  onChange={(event) => {
                    setTitleLanguage(event.target.value);
                    try {
                      localStorage.setItem(
                        "series-title-language:" + key,
                        event.target.value,
                      );
                    } catch {}
                  }}
                >
                  <option value="">{t("Collection title")}</option>
                  {languages.map((code) => (
                    <option key={code} value={code}>
                      {language(code)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {titleLanguage && (
              <p className="hint">
                {t("Collection title")}: {series}
              </p>
            )}
            {synopsis ? (
              <div className="series-synopsis">
                <h3>{t("Synopsis")}</h3>
                {synopses.length > 1 && (
                  <label className="field series-info-language">
                    <span>{t("Synopsis language")}</span>
                    <select
                      value={synopsis.language}
                      onChange={(event) => {
                        setSynopsisLanguage(event.target.value);
                        try {
                          localStorage.setItem(
                            "series-synopsis-language:" + key,
                            event.target.value,
                          );
                        } catch {}
                      }}
                    >
                      {synopses.map((item) => (
                        <option key={item.language} value={item.language}>
                          {language(item.language)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="series-synopsis-text" lang={synopsis.language}>
                  {synopsis.text}
                </p>
              </div>
            ) : (
              !loading &&
              !busy && <p className="hint">{t("No synopsis available yet.")}</p>
            )}
            {info.warnings.map((warning) => (
              <p className="hint" role="status" key={warning}>
                {t(warning)}
              </p>
            ))}
          </div>
          <aside className="series-fact-column">
            <h3>{t("Publication details")}</h3>
            <MetadataFacts facts={facts} />
            {!facts.length && (
              <p className="hint">{t("No publication details saved yet.")}</p>
            )}
            {info.tags?.some((tag) => tag.kind === "Spoiler tag") && (
              <details>
                <summary>{t("Spoiler tags")}</summary>
                <div className="series-profile-tags">
                  {info.tags
                    .filter((tag) => tag.kind === "Spoiler tag")
                    .map((tag) => (
                      <a
                        key={tag.name + tag.url}
                        href={metadataBrowsePath(tag.kind, tag.name)}
                      >
                        {tag.name}
                      </a>
                    ))}
                </div>
              </details>
            )}
            {!!info.links?.length && (
              <div className="series-source-links">
                <h3>{t("Read, buy & track")}</h3>
                {info.links.map((link) => (
                  <ExternalLink key={link.url} href={link.url} target="_blank">
                    {link.label}
                    {link.language !== "und"
                      ? " · " + language(link.language)
                      : ""}
                  </ExternalLink>
                ))}
              </div>
            )}
            <SeriesLanguageDetails info={info} series={series} />
          </aside>
          <div className="series-owned-content">{children}</div>
        </div>
      )}
      <div id="seriesCorrections" className="series-corrections">
        <SuggestEditMenu series={series} type={type} />
        <details className="series-source-import">
          <summary>{t("Add a publisher series source")}</summary>
          <form
            className="series-info-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run("pullSeriesInfo", { sourceUrl });
            }}
          >
            <label className="field">
              <span>{t("Phoenix Next series URL")}</span>
              <input
                type="url"
                required
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://www.phoenixnext.com/series/icecreamkanojo"
                maxLength={2000}
              />
            </label>
            <button className="btn" disabled={busy || loading}>
              {t("Pull source details")}
            </button>
          </form>
          <p className="hint">
            {t(
              "Use the publisher’s series page for its banner, creators, tags and synopsis. Choose the same original work.",
            )}
          </p>
        </details>
      </div>
      <details className="series-info-matching" ref={matchingDisclosure}>
        <summary>{t("Find or change a series link")}</summary>
        <p className="hint">
          {t(
            "Search English, Japanese or romaji. Select the same original work for each language edition.",
          )}
        </p>
        <form
          className="series-info-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run("pullSeriesInfo", { search });
          }}
        >
          <label className="field">
            <span>{t("Title on AniList")}</span>
            <input
              type="search"
              minLength={2}
              maxLength={200}
              required
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button className="btn" disabled={busy || loading}>
            {t("Find series")}
          </button>
        </form>
        {targets.length > 0 && (
          <form
            className="series-info-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run("linkSeriesInfo", { targetSeries });
            }}
          >
            <label className="field">
              <span>{t("Same series in your collection")}</span>
              <select
                required
                value={targetSeries}
                onChange={(event) => setTargetSeries(event.target.value)}
              >
                <option value="">{t("Choose a series")}</option>
                {targets.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button className="btn" disabled={busy || !targetSeries}>
              {t("Link editions")}
            </button>
          </form>
        )}
        {info?.workId && (
          <button
            className="text-btn"
            type="button"
            disabled={busy}
            onClick={() => run("unlinkSeriesInfo")}
          >
            {t("Remove series link")}
          </button>
        )}
        {!!info?.candidates.length && (
          <div className="series-info-candidates">
            <p>
              {t(
                "Choose the matching original series. No automatic link was made.",
              )}
            </p>
            <ul>
              {info.candidates.map((candidate) => (
                <li key={candidate.id}>
                  <div>
                    <strong>{candidate.title}</strong>
                    <p className="hint">{candidate.titles.join(" · ")}</p>
                    <ExternalLink href={candidate.url} target="_blank">
                      AniList
                    </ExternalLink>
                  </div>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      run("pullSeriesInfo", {
                        search: candidate.title.slice(0, 200),
                        mediaId: candidate.id,
                      })
                    }
                  >
                    {t("Use this series")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </section>
  );
}
