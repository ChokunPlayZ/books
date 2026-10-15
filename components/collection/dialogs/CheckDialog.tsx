export default function CheckDialog() {
  return (
    <dialog id={"checkDialog"} aria-labelledby={"checkTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"checkTitle"}>{"Do I own this book?"}</h2>
          <p>{"A quick shelf check while you're in the bookstore."}</p>
        </div>
        <button
          id={"closeCheck"}
          className={"close"}
          aria-label={"Close ownership checker"}
        >
          <svg aria-hidden={"true"}>
            <use href={"#i-close"} />
          </svg>
        </button>
      </div>
      <div className={"dialog-body"}>
        <form id={"checkForm"}>
          <div className={"field"}>
            <label htmlFor={"checkIsbn"}>{"Bookstore ISBN"}</label>
            <div className={"isbn-line"}>
              <input
                id={"checkIsbn"}
                type={"text"}
                placeholder={"978… or ISBN-10"}
                maxLength={40}
                autoComplete={"off"}
              />
              <button id={"checkIsbnButton"} className={"btn"} type={"submit"}>
                {"Check"}
              </button>
              <button
                id={"checkScanButton"}
                className={"btn primary"}
                type={"button"}
              >
                <svg aria-hidden={"true"}>
                  <use href={"#i-scan"} />
                </svg>
                {"Scan barcode"}
              </button>
            </div>
          </div>
        </form>
        <p className={"hint check-hint"}>
          {"Scan with your camera, choose a barcode photo, or type an ISBN."}
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
            {"Search owned series or volumes"}
          </label>
          <input
            id={"checkSearch"}
            type={"search"}
            placeholder={"Series name, volume, or publisher…"}
            autoComplete={"off"}
          />
          <p id={"checkSearchHint"} className={"store-result-note"}>
            {"Useful for books you haven't added an ISBN to yet."}
          </p>
          <div id={"checkSearchResults"}></div>
        </div>
      </div>
      <div className={"dialog-foot store-foot"}>
        <button id={"scanNextBook"} className={"btn primary"}>
          <svg aria-hidden={"true"}>
            <use href={"#i-scan"} />
          </svg>
          {"Scan next book"}
        </button>
        <button id={"doneCheck"} className={"btn"}>
          {"Done"}
        </button>
      </div>
    </dialog>
  );
}
