import { getTranslations } from "../../lib/server/preferences.ts";

export default async function SeriesCatalogPanel() {
  const t = await getTranslations();
  return (
    <details
      id={"seriesMissing"}
      className={"series-missing series-catalog-options"}
      hidden
    >
      <summary id={"seriesMissingTitle"}>{t("Catalog details")}</summary>
      <p id={"seriesMissingSummary"} className={"hint"} role={"status"}></p>
      <div id={"seriesGaps"} className={"missing-editions"}></div>
      <div id={"seriesCatalogHeading"} className={"series-release-head"}>
        <div>
          <h3>{t("Publisher catalog")}</h3>
        </div>
        <button id={"refreshSeriesReleases"} className={"btn"}>
          {t("Refresh catalog")}
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
        <summary>{t("Sources & catalog settings")}</summary>
        <div id={"seriesReleaseSources"} className={"publisher-sources"}></div>
        <p className={"hint release-note"}>
          {t(
            "Shelf gaps use whole volume numbers up to your highest owned volume. Catalog checks include older listings in the publisher’s series category, or Luckpim’s full title search. Removed listings and unrecorded purchases can affect the comparison.",
          )}
        </p>
      </details>
      <div id={"seriesReleaseList"} className={"release-grid"}></div>
      <section
        id={"seriesRevisedEditions"}
        className={"series-revised-editions"}
        aria-labelledby={"seriesRevisedTitle"}
        hidden
      >
        <h3 id={"seriesRevisedTitle"}>{t("Revised editions")}</h3>
        <p className={"hint"}>
          {t(
            "Publisher-listed alternatives. These do not change your owned books or missing-volume counts.",
          )}
        </p>
        <ul id={"seriesRevisedList"} className={"series-revised-list"}></ul>
      </section>
      <details id={"seriesReleaseReview"} className={"series-review"} hidden>
        <summary id={"seriesReleaseReviewSummary"}></summary>
        <div id={"seriesReleaseReviewList"} className={"release-grid"}></div>
      </details>
    </details>
  );
}
