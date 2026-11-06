import { getTranslations } from "../../../lib/server/preferences.ts";

export default async function CheckDialog() {
  const t = await getTranslations();
  return (
    <dialog id={"checkDialog"} aria-labelledby={"checkTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"checkTitle"}>{t("Do I own this book?")}</h2>
          <p>{t("A quick shelf check while you're in the bookstore.")}</p>
        </div>
        <button
          id={"closeCheck"}
          className={"close"}
          aria-label={t("Close ownership checker")}
        >
          <svg aria-hidden={"true"}>
            <use href={"#i-close"} />
          </svg>
        </button>
      </div>
      <div className={"dialog-body"}>
        <form id={"checkForm"}>
          <div className={"field"}>
            <label htmlFor={"checkIsbn"}>{t("Bookstore ISBN")}</label>
            <div className={"isbn-line"}>
              <input
                id={"checkIsbn"}
                type={"text"}
                placeholder={t("978… or ISBN-10")}
                maxLength={40}
                autoComplete={"off"}
              />
              <button id={"checkIsbnButton"} className={"btn"} type={"submit"}>
                {t("Check")}
              </button>
              <button
                id={"checkScanButton"}
                className={"btn primary"}
                type={"button"}
              >
                <svg aria-hidden={"true"}>
                  <use href={"#i-scan"} />
                </svg>
                {t("Scan barcode")}
              </button>
            </div>
          </div>
        </form>
        <p className={"hint check-hint"}>
          {t("Scan with your camera, choose a barcode photo, or type an ISBN.")}
        </p>
        <div
          id={"checkError"}
          className={"form-error"}
          role={"alert"}
          hidden
        ></div>
        <div id={"ownershipResult"} role={"status"} hidden></div>
        <div className={"store-search"}>
          <label htmlFor={"checkSearch"}>
            {t("Search owned series or volumes")}
          </label>
          <input
            id={"checkSearch"}
            type={"search"}
            placeholder={t("Series name, volume, or publisher…")}
            autoComplete={"off"}
          />
          <p id={"checkSearchHint"} className={"store-result-note"}>
            {t("Useful for books you haven't added an ISBN to yet.")}
          </p>
          <div id={"checkSearchResults"}></div>
        </div>
      </div>
      <div className={"dialog-foot store-foot"}>
        <button id={"scanNextBook"} className={"btn primary"}>
          <svg aria-hidden={"true"}>
            <use href={"#i-scan"} />
          </svg>
          {t("Scan next book")}
        </button>
        <button id={"doneCheck"} className={"btn"}>
          {t("Done")}
        </button>
      </div>
    </dialog>
  );
}
