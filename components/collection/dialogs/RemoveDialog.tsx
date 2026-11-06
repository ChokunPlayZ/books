import { getTranslations } from "../../../lib/server/preferences.ts";

export default async function RemoveDialog() {
  const t = await getTranslations();
  return (
    <dialog id={"removeDialog"} aria-labelledby={"removeTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"removeTitle"}>{t("Remove from your shelf?")}</h2>
          <p>{t("You can restore this book from Recently removed.")}</p>
        </div>
        <button
          id={"closeRemove"}
          className={"close"}
          aria-label={t("Cancel removal")}
        >
          <svg aria-hidden={"true"}>
            <use href={"#i-close"} />
          </svg>
        </button>
      </div>
      <div className={"dialog-body"}>
        <p id={"removeName"} className={"remove-name"}></p>
        <p className={"hint"}>
          {t("Its price will be removed from your collection total.")}
        </p>
        <div
          id={"removeError"}
          className={"form-error"}
          role={"alert"}
          hidden
        ></div>
      </div>
      <div className={"dialog-foot"}>
        <div className={"buttons"}>
          <button id={"cancelRemove"} className={"btn"}>
            {t("Keep book")}
          </button>
          <button id={"confirmRemove"} className={"btn danger"}>
            {t("Remove book")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
