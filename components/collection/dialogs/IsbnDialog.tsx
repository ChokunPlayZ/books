import { getTranslations } from "../../../lib/server/preferences.ts";

export default async function IsbnDialog() {
  const t = await getTranslations();
  return (
    <dialog id={"isbnDialog"} aria-labelledby={"isbnDialogTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"isbnDialogTitle"}>{t("Add ISBN")}</h2>
          <p>{t("Add a barcode to a book already on your shelf.")}</p>
        </div>
        <button
          id={"closeIsbn"}
          className={"close"}
          aria-label={t("Close ISBN form")}
        >
          <svg aria-hidden={"true"}>
            <use href={"#i-close"} />
          </svg>
        </button>
      </div>
      <form id={"isbnForm"}>
        <div className={"dialog-body"}>
          <div className={"isbn-only-details"}>
            <h3 id={"isbnBookName"}></h3>
            <p id={"isbnBookDetails"}></p>
          </div>
          <div
            id={"isbnError"}
            className={"form-error"}
            role={"alert"}
            hidden
          ></div>
          <div className={"field"}>
            <label htmlFor={"linkIsbn"}>{t("ISBN for this volume")}</label>
            <div className={"isbn-line"}>
              <input
                id={"linkIsbn"}
                type={"text"}
                placeholder={t("978… or ISBN-10")}
                maxLength={40}
                required
                autoComplete={"off"}
              />
              <button id={"linkScanButton"} className={"btn"} type={"button"}>
                <svg aria-hidden={"true"}>
                  <use href={"#i-scan"} />
                </svg>
                {t("Scan barcode")}
              </button>
            </div>
          </div>
          <p className={"hint check-hint"}>
            {t("Check the volume, language and edition before saving.")}
          </p>
          <div className={"isbn-only-checks"}>
            <label className={"check"}>
              <input id={"linkAllowDuplicate"} type={"checkbox"} />
              {t("Another copy of an ISBN already on my shelf")}
            </label>
            <label className={"check"}>
              <input id={"linkNext"} type={"checkbox"} />
              {t(
                "Continue with the next volume in this series missing an ISBN",
              )}
            </label>
          </div>
        </div>
        <div className={"dialog-foot isbn-only-foot"}>
          <button id={"cancelIsbn"} className={"btn"} type={"button"}>
            {t("Cancel")}
          </button>
          <button
            id={"saveIsbnButton"}
            className={"btn primary"}
            type={"submit"}
          >
            {t("Save ISBN")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
