export default function SeriesCatalogPanel() {
  return (
    <section
      id={"seriesMissing"}
      className={"series-missing"}
      aria-labelledby={"seriesMissingTitle"}
      hidden
    >
      <h2 id={"seriesMissingTitle"}>{"What you’re missing"}</h2>
      <p id={"seriesMissingSummary"} className={"hint"} role={"status"}></p>
      <div id={"seriesGaps"} className={"missing-editions"}></div>
      <div id={"seriesCatalogHeading"} className={"series-release-head"}>
        <div>
          <h3>{"Publisher catalog"}</h3>
        </div>
        <button id={"refreshSeriesReleases"} className={"btn"}>
          {"Refresh catalog"}
        </button>
      </div>
      <div
        id={"seriesReleaseError"}
        className={"banner"}
        role={"alert"}
        hidden
      ></div>
      <p id={"seriesReleaseStatus"} className={"hint"} role={"status"}></p>
      <details id={"seriesCatalogDetails"} className={"publisher-details"}>
        <summary>{"Sources & catalog settings"}</summary>
        <div id={"seriesReleaseSources"} className={"publisher-sources"}></div>
        <p className={"hint release-note"}>
          {
            "Shelf gaps use whole volume numbers up to your highest owned volume. Catalog checks include older listings in the publisher’s series category, or Luckpim’s full title search. Removed listings and unrecorded purchases can affect the comparison."
          }
        </p>
      </details>
      <div id={"seriesReleaseList"} className={"release-grid"}></div>
      <details id={"seriesReleaseReview"} className={"series-review"} hidden>
        <summary id={"seriesReleaseReviewSummary"}></summary>
        <div id={"seriesReleaseReviewList"} className={"release-grid"}></div>
      </details>
    </section>
  );
}
