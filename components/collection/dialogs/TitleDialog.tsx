import { getTranslations } from "../../../lib/server/preferences.ts";

export default async function TitleDialog() {
  const t = await getTranslations();
  return (
    <dialog id="titleDialog" aria-labelledby="titleDialogTitle">
      <div className="dialog-head">
        <div>
          <h2 id="titleDialogTitle">{t("Title details")}</h2>
          <p>
            {t(
              "Shared by all volumes. Each edition keeps its own type and publisher.",
            )}
          </p>
        </div>
        <button
          id="closeTitle"
          className="close"
          aria-label={t("Close title details")}
        >
          <svg aria-hidden="true">
            <use href="#i-close" />
          </svg>
        </button>
      </div>
      <form id="titleForm">
        <div className="dialog-body">
          <div id="titleError" className="form-error" role="alert" hidden />
          <div className="field">
            <label htmlFor="titleSeries">{t("Series name *")}</label>
            <input id="titleSeries" required maxLength={500} />
          </div>
          <div id="titleEditions" className="title-editions" />
          <p id="titleSaveHint" className="hint" />
        </div>
        <div className="dialog-foot">
          <div className="buttons">
            <button id="cancelTitle" className="btn" type="button">
              {t("Cancel")}
            </button>
            <button id="saveTitleButton" className="btn primary" type="submit">
              {t("Save title details")}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
