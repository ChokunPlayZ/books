export default function BookDialog() {
  return (
    <dialog id={"bookDialog"} aria-labelledby={"bookDialogTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"bookDialogTitle"} tabIndex={-1}>
            {"Add to your shelf"}
          </h2>
          <p id={"bookDialogSubtitle"}>
            {"Scan an ISBN or fill in the details yourself."}
          </p>
        </div>
        <button
          className={"close"}
          id={"closeBook"}
          aria-label={"Close book form"}
        >
          <svg aria-hidden={"true"}>
            <use href={"#i-close"} />
          </svg>
        </button>
      </div>
      <div
        id="isbnLookupStatus"
        className="isbn-lookup-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        hidden
      >
        <span className="isbn-lookup-spinner" aria-hidden="true" />
        <div>
          <strong>Looking up ISBN…</strong>
          <p id="isbnLookupMessage" />
        </div>
      </div>
      <form id={"bookForm"}>
        <div className={"dialog-body"}>
          <div
            id={"formError"}
            className={"form-error"}
            role={"alert"}
            hidden
          ></div>
          <div className={"form-grid"}>
            <div
              className={"field isbn-entry span-2"}
              data-series-detail
              data-lookup-detail
            >
              <label htmlFor={"isbn"}>
                {"ISBN "}
                <span className={"hint"}>{"optional"}</span>
              </label>
              <div className={"isbn-line"}>
                <input
                  id={"isbn"}
                  name={"isbn"}
                  type={"text"}
                  inputMode={"text"}
                  enterKeyHint={"search"}
                  placeholder={"978… or ISBN-10"}
                  maxLength={40}
                  autoComplete={"off"}
                />
                <button id={"lookupButton"} className={"btn"} type={"button"}>
                  {"Look up"}
                </button>
                <button id={"scanButton"} className={"btn"} type={"button"}>
                  <svg aria-hidden={"true"}>
                    <use href={"#i-scan"} />
                  </svg>
                  {"Scan"}
                </button>
              </div>
              <p className={"hint"}>
                {"Scan a barcode or enter its ISBN to fill in book details."}
              </p>
            </div>
            <div
              id={"lookupResult"}
              className={"lookup span-2"}
              role={"status"}
              hidden
            ></div>
            <button
              id="toggleLookupDetails"
              className="text-btn span-2"
              type="button"
              aria-expanded="false"
              hidden
            >
              Edit book details
            </button>
            <fieldset
              id="titleEntry"
              className="title-entry span-2"
              data-lookup-detail
            >
              <legend>Title details</legend>
              <div className="form-grid">
                <div id="titleNameField" className="field span-2">
                  <label htmlFor="series">Series name *</label>
                  <input
                    id="series"
                    name="series"
                    list="seriesOptions"
                    required
                    maxLength={500}
                    placeholder="Choose a title or enter a new one"
                  />
                  <datalist id="seriesOptions" />
                </div>
                <div className="field" data-title-field>
                  <label htmlFor="type">Type *</label>
                  <select id="type" name="type" required />
                </div>
                <div className="field" data-title-field>
                  <label htmlFor="publisher">Publisher</label>
                  <input
                    id="publisher"
                    name="publisher"
                    list="publisherOptions"
                    maxLength={500}
                    placeholder="Choose or enter a publisher"
                  />
                  <datalist id="publisherOptions" />
                </div>
              </div>
            </fieldset>
            <div
              id="seriesDefaults"
              className="series-defaults span-2"
              data-lookup-detail
              hidden
            >
              <p id="seriesDefaultsText" role="status" />
              <div id="editionField" className="field">
                <label htmlFor="bookEdition">Edition</label>
                <select id="bookEdition" />
              </div>
              <p className="hint">Edit shared details from the title page.</p>
              <button
                id="toggleBookDetails"
                className="text-btn"
                type="button"
                aria-expanded="false"
              >
                Edit other volume details
              </button>
            </div>
            <div className={"field"} data-lookup-detail>
              <label htmlFor={"volume"}>{"Volume"}</label>
              <input
                id={"volume"}
                name={"volume"}
                type={"number"}
                inputMode={"decimal"}
                min={"0"}
                step={"any"}
                placeholder={"e.g. 1 or 4.5"}
              />
            </div>
            <div className={"field"} data-lookup-detail>
              <label htmlFor={"status"}>{"Reading status *"}</label>
              <select id={"status"} name={"status"} required></select>
            </div>
            <div className={"field purchase-field"}>
              <label htmlFor={"source"}>{"Bought from"}</label>
              <input
                id={"source"}
                name={"source"}
                list={"sourceOptions"}
                maxLength={500}
                autoComplete="off"
                placeholder={"Shop, book fair, or gift"}
                aria-describedby="sourceHint"
              />
              <datalist id={"sourceOptions"}></datalist>
              <p id="sourceHint" className="hint">
                Enter where you bought this copy.
              </p>
            </div>
            <div className={"field purchase-field"} data-lookup-detail>
              <label htmlFor={"date"}>{"Date bought"}</label>
              <input id={"date"} name={"date"} type={"date"} />
            </div>
            <fieldset className={"purchase-price span-2"}>
              <legend>{"Purchase price"}</legend>
              <div className={"form-grid"}>
                <div className={"field span-2"}>
                  <label htmlFor={"price"}>{"Price paid"}</label>
                  <input
                    id={"price"}
                    name={"price"}
                    type={"number"}
                    inputMode={"decimal"}
                    min={"0"}
                    step={"any"}
                    placeholder={"0.00"}
                  />
                  <p className={"hint"}>{"Use your collection’s currency."}</p>
                  <p id="listedPriceHint" className="hint" hidden />
                </div>
                <details
                  id={"priceCalculator"}
                  className={"price-calculator span-2"}
                  open
                  data-lookup-detail
                >
                  <summary>{"Calculate a discounted price"}</summary>
                  <div className={"form-grid"}>
                    <div className={"field"}>
                      <label htmlFor={"regularPrice"}>
                        {"Regular price "}
                        <span className={"hint"}>{"optional"}</span>
                      </label>
                      <input
                        id={"regularPrice"}
                        type={"number"}
                        inputMode={"decimal"}
                        min={"0"}
                        step={"any"}
                        placeholder={"Before discount"}
                      />
                    </div>
                    <div className={"field"}>
                      <label htmlFor={"discount"}>
                        {"Discount "}
                        <span className={"hint"}>{"optional"}</span>
                      </label>
                      <div className={"discount-line"}>
                        <input
                          id={"discount"}
                          type={"number"}
                          inputMode={"decimal"}
                          min={"0"}
                          max={"100"}
                          step={"any"}
                          placeholder={"0"}
                          aria-describedby={"discountHint"}
                        />
                        <select
                          id={"discountType"}
                          aria-label={"Discount type"}
                        >
                          <option value={"percent"}>{"% off"}</option>
                          <option value={"amount"}>{"Amount off"}</option>
                        </select>
                      </div>
                      <p id={"discountHint"} className={"hint"}>
                        {"Enter a percentage from 0 to 100."}
                      </p>
                    </div>
                    <p className={"hint span-2"}>
                      {
                        "Regular price and discount are used only for this calculation."
                      }
                    </p>
                  </div>
                </details>
                <p
                  id={"priceSummary"}
                  className={"hint span-2"}
                  role={"status"}
                  hidden
                  data-lookup-detail
                ></p>
              </div>
            </fieldset>
            <details
              id="bookExtras"
              className="book-extras span-2"
              data-series-detail
              data-lookup-detail
              open
            >
              <summary>Cover, notes &amp; duplicate copy</summary>
              <div className="form-grid">
                <fieldset
                  id="metadataManager"
                  className="metadata-manager span-2"
                  data-series-detail
                >
                  <legend>Cover &amp; publisher</legend>
                  <div className="field">
                    <label htmlFor="publisherUrl">Publisher page</label>
                    <input
                      id="publisherUrl"
                      type="url"
                      maxLength={2000}
                      placeholder="https://…"
                    />
                    <a
                      id="metadataPublisherLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      hidden
                    >
                      Open publisher site ↗
                    </a>
                  </div>
                  <div className="cover-editor">
                    <div id="metadataCoverPreview" />
                    <div className="field">
                      <label htmlFor="coverUrl">Cover image URL</label>
                      <input
                        id="coverUrl"
                        type="url"
                        maxLength={2000}
                        placeholder="Use automatic cover, or enter an image URL"
                      />
                      <p className="hint">
                        Leave blank to use the automatic cover. New image URLs
                        are downloaded when you save.
                      </p>
                      <button
                        id="pullPublisherCovers"
                        className="btn"
                        type="button"
                      >
                        Pull covers
                      </button>
                      <p
                        id="publisherCoversStatus"
                        className="hint"
                        role="status"
                      />
                    </div>
                  </div>
                  <div
                    id="publisherCoverChoices"
                    className="cover-choices"
                    aria-label="Publisher and bookstore cover choices"
                  />
                  <p className="hint">
                    Choose a cover, then save your changes.
                  </p>
                </fieldset>
                <div className={"field span-2"} data-series-detail>
                  <label htmlFor={"note"}>{"Notes"}</label>
                  <textarea
                    id={"note"}
                    name={"note"}
                    maxLength={2000}
                    placeholder={"Special edition, a gift, a good find…"}
                  ></textarea>
                </div>
                <label className={"check span-2"} data-series-detail>
                  <input type={"checkbox"} id={"allowDuplicate"} />
                  {"Another copy of an ISBN already on my shelf"}
                </label>
              </div>
            </details>
          </div>
        </div>
        <div className={"dialog-foot book-dialog-foot"}>
          <label className={"check span-2"} id={"keepAddingLabel"}>
            <input type={"checkbox"} id={"keepAdding"} />
            <span id={"keepAddingText"}>{"Add another book after saving"}</span>
          </label>
          <button
            id={"removeButton"}
            className={"btn danger"}
            type={"button"}
            hidden
          >
            {"Remove book"}
          </button>
          <div className={"buttons book-save-actions"}>
            <button id={"cancelBook"} className={"btn"} type={"button"}>
              {"Cancel"}
            </button>
            <button id={"saveButton"} className={"btn primary"} type={"submit"}>
              {"Add book"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
