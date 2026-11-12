import { getTranslations } from "../../lib/server/preferences.ts";

export default async function SeriesEditor() {
  const t = await getTranslations();
  return (
    <form id="seriesEditor" className="series-editor" noValidate hidden>
      <div className="series-editor-heading">
        <h2 id="seriesEditorTitle" tabIndex={-1}>
          {t("Edit volume details")}
        </h2>
        <p id="seriesEditorHint" className="hint">
          {t(
            "Select a volume to edit all its details. Review your edits here, then save all changes together.",
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
            </tr>
          </thead>
          <tbody id="seriesEditRows" />
        </table>
      </div>
      <dialog
        id="seriesVolumeDialog"
        className="volume-editor-dialog"
        aria-labelledby="seriesVolumeTitle"
        aria-describedby="seriesVolumeHint"
      >
        <div className="dialog-head">
          <div>
            <h2 id="seriesVolumeTitle" tabIndex={-1} />
            <p id="seriesVolumeSubtitle" />
          </div>
          <button
            id="closeSeriesVolume"
            className="close"
            type="button"
            aria-label={t("Close volume details")}
          >
            <svg aria-hidden="true">
              <use href="#i-close" />
            </svg>
          </button>
        </div>
        <div id="seriesVolumeFields" className="dialog-body" />
        <div className="dialog-foot">
          <p id="seriesVolumeHint" className="hint">
            {t(
              "Edits are kept in the table. Save changes there when you’re finished.",
            )}
          </p>
          <div className="buttons">
            <button id="resetSeriesVolume" className="btn" type="button">
              {t("Reset this volume")}
            </button>
            <button id="doneSeriesVolume" className="btn primary" type="button">
              {t("Done")}
            </button>
          </div>
        </div>
      </dialog>
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
