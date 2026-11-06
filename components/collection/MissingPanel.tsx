import Icon from "../Icon";
import { seriesPath } from "../../lib/domain/navigation.ts";
import { LIST_BATCH_SIZE } from "../../lib/domain/lists.ts";
import { collectionGaps } from "../../lib/client/matching.ts";
import type { StoredBook } from "../../lib/types.ts";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function MissingPanel({ books }: { books: StoredBook[] }) {
  const t = await getTranslations();
  const groups = collectionGaps(books);
  return (
    <section id="missingPanel" aria-labelledby="missingTitle">
      <div className="release-heading">
        <div>
          <p className="eyebrow">{t("Complete your series")}</p>
          <h1 id="missingTitle">{t("What’s missing")}</h1>
          <p className="intro">
            {t("Every volume you don’t have, grouped by series.")}
          </p>
        </div>
      </div>
      <p className="missing-note">
        {t(
          "Publisher catalogs show unowned volumes, including those beyond your highest owned volume. Shelf gaps are included too. Languages and publishers are checked separately.",
        )}
      </p>
      <div className="toolbar missing-filters">
        <div className="search">
          <svg aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <label htmlFor="missingSearch" className="sr-only">
            {t("Search missing series")}
          </label>
          <input
            id="missingSearch"
            type="search"
            placeholder={t("Search series, type or publisher…")}
          />
        </div>
        <label htmlFor="missingSort" className="sr-only">
          {t("Sort missing series")}
        </label>
        <select id="missingSort" defaultValue="series">
          <option value="series">{t("Series A–Z")}</option>
          <option value="missing">{t("Most missing")}</option>
        </select>
        <button
          id="refreshMissingCatalogs"
          className="btn"
          type="button"
          disabled
        >
          {t("Refresh catalogs")}
        </button>
        <button
          id="refreshButton"
          className="btn refresh"
          type="button"
          aria-label={t("Refresh missing volumes")}
          title={t("Refresh missing volumes")}
        >
          <svg aria-hidden="true">
            <use href="#i-refresh" />
          </svg>
        </button>
      </div>
      <p id="missingCatalogStatus" className="missing-summary" role="status">
        {t(
          books.length
            ? "Publisher catalogs will be checked when this page opens."
            : "Add a series to check its publisher catalog.",
        )}
      </p>
      <details
        id="missingCoverage"
        className="publisher-details missing-coverage"
        hidden={!books.length}
      >
        <summary id="missingCoverageSummary">{t("Catalog coverage")}</summary>
        <ul id="missingCoverageList"></ul>
        <p className="hint">
          {t(
            "Unavailable catalogs and uncertain editions can be reviewed on each series page.",
          )}
        </p>
      </details>
      <p id="missingSummary" className="missing-summary" role="status">
        {t("{count} missing volumes across {series} series", {
          count: groups.reduce((sum, group) => sum + group.missing, 0),
          series: groups.length,
        })}
      </p>
      <div id="missingList" className="missing-list">
        {groups.length ? (
          groups.slice(0, LIST_BATCH_SIZE).map((group) => (
            <article className="missing-series" key={group.series}>
              <header className="missing-series-heading">
                <h2>
                  <a href={seriesPath(group.series)}>{group.series}</a>
                </h2>
                <span className="missing-total">
                  {t("{count} missing", { count: group.missing })}
                </span>
              </header>
              {group.editions.map((edition, index) => (
                <div className="missing-series-edition" key={index}>
                  <h3>
                    {[edition.type, edition.publisher]
                      .filter(Boolean)
                      .join(" · ") || t("Edition not recorded")}
                  </h3>
                  <p className="hint">
                    {t("Missing {count} volumes through volume {highest}", {
                      count: edition.missing,
                      highest: edition.highest,
                    })}
                  </p>
                  <div
                    className="missing-ranges"
                    aria-label={t("Missing volumes")}
                  >
                    {edition.ranges.map(([from, to]) => (
                      <button
                        className="btn missing-volume"
                        type="button"
                        key={from}
                        disabled
                      >
                        {t("Vol.")} {from}
                        {to > from ? "–" + to : ""} +
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <a
                className="missing-series-link"
                href={seriesPath(group.series)}
              >
                {t("View series & catalog →")}
              </a>
            </article>
          ))
        ) : (
          <div className="empty">
            <span className="empty-icon">
              <Icon name="check" />
            </span>
            <h2>
              {t(
                books.length
                  ? "Checking publisher catalogs…"
                  : "Your shelf starts here",
              )}
            </h2>
            <p>
              {t(
                books.length
                  ? "Unowned catalog volumes will appear as checks finish, including volumes beyond your shelf."
                  : "Add volumes to your collection to see what’s missing.",
              )}
            </p>
            <a className="btn" href="/">
              {t("View collection")}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
