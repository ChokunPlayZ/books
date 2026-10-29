import type { StoredBook } from "../../lib/types.ts";

export default function SeriesHeader({
  series,
  books,
}: {
  series: string;
  books: StoredBook[];
}) {
  const owned = books.filter(
    (book) => (book.series.trim() || "Untitled series") === series,
  );
  const total = owned.reduce((sum, book) => sum + Number(book.price || 0), 0);
  return (
    <div id={"seriesHeader"} className={"series-header"}>
      <a id={"backSeries"} className={"text-btn"} href="/">
        {"← All series"}
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
            title="Download this series as JSON, including saved covers"
          >
            <svg aria-hidden="true">
              <use href="#i-download" />
            </svg>
            Export series
          </a>
          <button
            id="editTitleButton"
            className="btn"
            type="button"
            aria-label="Edit title details"
            title="Edit title details"
            disabled
          >
            <svg aria-hidden="true">
              <use href="#i-edit" />
            </svg>
            <span className="title-edit-label">Edit title details</span>
          </button>
          <button
            id="editVolumesButton"
            className="btn primary"
            type="button"
            aria-controls="seriesEditor"
            aria-expanded="false"
            disabled
          >
            Edit volumes
          </button>
        </div>
      </div>
      <div className={"series-summary-line"}>
        <p id={"seriesSummary"}>
          {owned.length} owned {owned.length === 1 ? "volume" : "volumes"} · ฿
          {new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
            total,
          )}{" "}
          recorded spending
        </p>
        <button
          id={"seriesCatalogToggle"}
          className={"text-btn"}
          aria-controls={"seriesMissing"}
          aria-expanded={"false"}
          hidden
        >
          {"Catalog details"}
        </button>
      </div>
    </div>
  );
}
