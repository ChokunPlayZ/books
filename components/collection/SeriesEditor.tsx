import { getTranslations } from "../../lib/server/preferences.ts";

export default async function SeriesEditor() {
  const t = await getTranslations();
  return (
    <form id="seriesEditor" className="series-editor" hidden>
      <div className="series-editor-heading">
        <h2 id="seriesEditorTitle" tabIndex={-1}>
          {t("Edit volume details")}
        </h2>
        <p id="seriesEditorHint" className="hint">
          {t(
            "Edit reading status and purchases in the table. Open Book details on any row to edit its volume number, ISBN, edition, notes and cover links. Save all changes together.",
          )}
        </p>
      </div>
      <div
        className="series-edit-scroll"
        role="region"
        aria-label={t("Editable owned volumes")}
        aria-describedby="seriesEditorHint"
        tabIndex={0}
      >
        <table className="series-edit-table">
          <caption className="sr-only">{t("Owned volume details")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Volume / edition")}</th>
              <th scope="col">{t("Reading status")}</th>
              <th scope="col">{t("Purchase date")}</th>
              <th scope="col">{t("Price paid (฿)")}</th>
              <th scope="col">{t("Bought from")}</th>
              <th scope="col">{t("Book details")}</th>
            </tr>
          </thead>
          <tbody id="seriesEditRows" />
        </table>
      </div>
      <div
        id="seriesSaveBar"
        className="series-save-bar"
        role="region"
        aria-label={t("Save volume changes")}
      >
        <div className="series-save-copy">
          <p id="seriesSaveStatus" role="status" aria-live="polite">
            {t("No unsaved changes")}
          </p>
          <p id="seriesSaveHint">{t("Your edits stay here until you save.")}</p>
          <div
            id="seriesEditError"
            className="form-error"
            role="alert"
            hidden
          />
        </div>
        <div className="buttons">
          <button id="cancelSeriesEdit" className="btn" type="button">
            {t("Done")}
          </button>
          <button
            id="saveSeriesEdits"
            className="btn primary"
            type="submit"
            disabled
          >
            {t("Save changes")}
          </button>
        </div>
      </div>
    </form>
  );
}
