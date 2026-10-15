export default function SeriesHeader() {
  return (
    <div id={"seriesHeader"} className={"series-header"} hidden>
      <button id={"backSeries"} className={"text-btn"}>
        {"← All series"}
      </button>
      <div className="series-title-line">
        <h1 id={"seriesTitle"}></h1>
        <button id="editTitleButton" className="btn" type="button">
          Edit title details
        </button>
      </div>
      <div className={"series-summary-line"}>
        <p id={"seriesSummary"}></p>
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
