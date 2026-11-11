import type { StoredBook } from "../../lib/types.ts";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function SeriesHeader({
  series,
  books,
}: {
  series: string;
  books: StoredBook[];
}) {
  const t = await getTranslations();
  const owned = books.filter(
    (book) => (book.series.trim() || "Untitled series") === series,
  );
  const total = owned.reduce((sum, book) => sum + Number(book.price || 0), 0);
  return (
    <div id={"seriesHeader"} className={"series-header"}>
      <a id={"backSeries"} className={"text-btn"} href="/">
        {t("← All series")}
      </a>
      <div className="series-title-line">
        <h1 id={"seriesTitle"}>{series}</h1>
        <div className="series-header-actions">
          <a
            id="exportSeriesButton"
            className="btn"
            href={"/api/backup?series=" + encodeURIComponent(series)}
            download
            hidden={!owned.length}
            title={t("Download this series as JSON, including saved covers")}
          >
            <svg aria-hidden="true">
              <use href="#i-download" />
            </svg>
            <span className="title-export-label">{t("Export series")}</span>
          </a>
          <button
            id="editTitleButton"
            className="btn"
            type="button"
            aria-label={t("Edit title details")}
            title={t("Edit title details")}
            disabled
          >
            <svg aria-hidden="true">
              <use href="#i-edit" />
            </svg>
            <span className="title-edit-label">{t("Edit title details")}</span>
          </button>
          <button
            id="editVolumesButton"
            className="btn primary"
            type="button"
            aria-controls="seriesEditor"
            aria-expanded="false"
            disabled
          >
            {t("Edit volumes")}
          </button>
        </div>
      </div>
      <div className={"series-summary-line"}>
        <p id={"seriesSummary"}>
          {t(
            owned.length === 1
              ? "{count} owned volume · ฿{total} recorded spending"
              : "{count} owned volumes · ฿{total} recorded spending",
            {
              count: owned.length,
              total: new Intl.NumberFormat("en", {
                maximumFractionDigits: 2,
              }).format(total),
            },
          )}
        </p>
        <button
          id={"seriesCatalogToggle"}
          className={"text-btn"}
          aria-controls={"seriesMissing"}
          aria-expanded={"false"}
          hidden
        >
          {t("Catalog details")}
        </button>
      </div>
    </div>
  );
}
