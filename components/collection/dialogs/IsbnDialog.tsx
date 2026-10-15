export default function IsbnDialog() {
  return (
    <dialog id={"isbnDialog"} aria-labelledby={"isbnDialogTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"isbnDialogTitle"}>{"Add ISBN"}</h2>
          <p>{"Add a barcode to a book already on your shelf."}</p>
        </div>
        <button
          id={"closeIsbn"}
          className={"close"}
          aria-label={"Close ISBN form"}
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
            <label htmlFor={"linkIsbn"}>{"ISBN for this volume"}</label>
            <div className={"isbn-line"}>
              <input
                id={"linkIsbn"}
                type={"text"}
                placeholder={"978… or ISBN-10"}
                maxLength={40}
                required
                autoComplete={"off"}
              />
              <button id={"linkScanButton"} className={"btn"} type={"button"}>
                <svg aria-hidden={"true"}>
                  <use href={"#i-scan"} />
                </svg>
                {"Scan barcode"}
              </button>
            </div>
          </div>
          <p className={"hint check-hint"}>
            {"Check the volume, language and edition before saving."}
          </p>
          <div className={"isbn-only-checks"}>
            <label className={"check"}>
              <input id={"linkAllowDuplicate"} type={"checkbox"} />
              {"Another copy of an ISBN already on my shelf"}
            </label>
            <label className={"check"}>
              <input id={"linkNext"} type={"checkbox"} />
              {"Continue with the next volume in this series missing an ISBN"}
            </label>
          </div>
        </div>
        <div className={"dialog-foot isbn-only-foot"}>
          <button id={"cancelIsbn"} className={"btn"} type={"button"}>
            {"Cancel"}
          </button>
          <button
            id={"saveIsbnButton"}
            className={"btn primary"}
            type={"submit"}
          >
            {"Save ISBN"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
