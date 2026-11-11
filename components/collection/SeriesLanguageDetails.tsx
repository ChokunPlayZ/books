"use client";

import { useTranslations } from "../PreferencesProvider";
import ExternalLink from "../ExternalLink";
import { seriesPath } from "../../lib/domain/navigation.ts";
import { languageName } from "../../lib/domain/series-detail.ts";
import type { SeriesInfo } from "../../lib/domain/series-info.ts";

export default function SeriesLanguageDetails({
  info,
  series,
}: {
  info: SeriesInfo;
  series: string;
}) {
  const t = useTranslations();
  return (
    <section id="seriesLanguages" className="series-language-section">
      <h3>{t("Titles & languages")}</h3>
      {!!info.titles.length && (
        <details className="series-info-aliases" open>
          <summary>{t("Titles from sources")}</summary>
          <ul>
            {info.titles.map((item) => (
              <li key={JSON.stringify(item)}>
                <span className="hint">{t(languageName(item.language))}</span>
                <span lang={item.language}>{item.title}</span>
                <ExternalLink href={item.url} target="_blank">
                  {item.source}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!info.editions.length && (
        <nav
          className="series-edition-links"
          aria-label={t("Linked language editions")}
        >
          <h3>{t("Linked language editions")}</h3>
          <p className="hint">
            {t(
              "Shared titles and synopsis choices. Owned volumes stay separate.",
            )}
          </p>
          <ul>
            {info.editions.map((edition) => (
              <li key={JSON.stringify([edition.series, edition.language])}>
                <a
                  href={seriesPath(edition.series)}
                  aria-current={edition.series === series ? "page" : undefined}
                >
                  {edition.series}
                </a>
                <span className="hint">
                  {t(languageName(edition.language))} ·{" "}
                  {t("{count} owned", { count: edition.count })}
                </span>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <p className="hint">
        {t(
          "Alternate titles do not confirm a licensed edition. Linked editions show only volumes in your library.",
        )}
      </p>
    </section>
  );
}
