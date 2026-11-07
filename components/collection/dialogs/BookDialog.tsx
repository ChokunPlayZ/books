import { getTranslations } from "../../../lib/server/preferences.ts";
import ExternalLink from "../../ExternalLink";

export default async function BookDialog() {
  const t = await getTranslations();
  return (
    <dialog id={"bookDialog"} aria-labelledby={"bookDialogTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"bookDialogTitle"} tabIndex={-1}>
            {t("Add to your shelf")}
          </h2>
          <p id={"bookDialogSubtitle"}>
            {t("Scan an ISBN or fill in the details yourself.")}
          </p>
        </div>
        <button
          className={"close"}
          id={"closeBook"}
          aria-label={t("Close book form")}
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
          <strong>{t("Looking up ISBN…")}</strong>
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
                <span className={"hint"}>{t("optional")}</span>
              </label>
              <div className={"isbn-line"}>
                <input
                  id={"isbn"}
                  name={"isbn"}
                  type={"text"}
                  inputMode={"text"}
                  enterKeyHint={"search"}
                  placeholder={t("978… or ISBN-10")}
                  maxLength={40}
                  autoComplete={"off"}
                />
                <button id={"lookupButton"} className={"btn"} type={"button"}>
                  {t("Look up")}
                </button>
                <button id={"scanButton"} className={"btn"} type={"button"}>
                  <svg aria-hidden={"true"}>
                    <use href={"#i-scan"} />
                  </svg>
                  {t("Scan")}
                </button>
              </div>
              <p className={"hint"}>
                {t("Scan a barcode or enter its ISBN to fill in book details.")}
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
              {t("Edit book details")}
            </button>
            <fieldset
              id="titleEntry"
              className="title-entry span-2"
              data-lookup-detail
            >
              <legend>{t("Title details")}</legend>
              <div className="form-grid">
                <div id="titleNameField" className="field span-2">
                  <label htmlFor="series">{t("Series name *")}</label>
                  <input
                    id="series"
                    name="series"
                    list="seriesOptions"
                    required
                    maxLength={500}
                    placeholder={t("Choose a title or enter a new one")}
                  />
                  <datalist id="seriesOptions" />
                </div>
                <div className="field" data-title-field>
                  <label htmlFor="type">{t("Type *")}</label>
                  <select id="type" name="type" required />
                </div>
                <div className="field" data-title-field>
                  <label htmlFor="publisher">{t("Publisher")}</label>
                  <input
                    id="publisher"
                    name="publisher"
                    list="publisherOptions"
                    maxLength={500}
                    placeholder={t("Choose or enter a publisher")}
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
                <label htmlFor="bookEdition">{t("Edition")}</label>
                <select id="bookEdition" />
              </div>
              <p className="hint">
                {t("Edit shared details from the title page.")}
              </p>
              <button
                id="toggleBookDetails"
                className="text-btn"
                type="button"
                aria-expanded="false"
              >
                {t("Edit other volume details")}
              </button>
            </div>
            <div className={"field"} data-lookup-detail>
              <label htmlFor={"volume"}>{t("Volume")}</label>
              <input
                id={"volume"}
                name={"volume"}
                type={"number"}
                inputMode={"decimal"}
                min={"0"}
                step={"any"}
                placeholder={t("e.g. 1 or 4.5")}
              />
            </div>
            <div className={"field"} data-lookup-detail>
              <label htmlFor={"status"}>{t("Reading status *")}</label>
              <select id={"status"} name={"status"} required></select>
            </div>
            <div className={"field purchase-field"}>
              <label htmlFor={"source"}>{t("Bought from")}</label>
              <input
                id={"source"}
                name={"source"}
                list={"sourceOptions"}
                maxLength={500}
                autoComplete="off"
                placeholder={t("Shop, book fair, or gift")}
                aria-describedby="sourceHint"
              />
              <datalist id={"sourceOptions"}></datalist>
              <p id="sourceHint" className="hint">
                {t("Enter where you bought this copy.")}
              </p>
            </div>
            <div className={"field purchase-field"} data-lookup-detail>
              <label htmlFor={"date"}>{t("Date bought")}</label>
              <input id={"date"} name={"date"} type={"date"} />
            </div>
            <fieldset className={"purchase-price span-2"}>
              <legend>{t("Purchase price")}</legend>
              <div className={"form-grid"}>
                <div className={"field span-2"}>
                  <label htmlFor={"price"}>{t("Price paid")}</label>
                  <input
                    id={"price"}
                    name={"price"}
                    type={"number"}
                    inputMode={"decimal"}
                    min={"0"}
                    step={"any"}
                    placeholder={"0.00"}
                  />
                  <p className={"hint"}>
                    {t("Use your collection’s currency.")}
                  </p>
                  <p id="listedPriceHint" className="hint" hidden />
                  <button
                    id="findBookPrices"
                    className="text-btn price-form-link"
                    type="button"
                  >
                    {t("Find lowest price ↗")}
                  </button>
                </div>
                <details
                  id={"priceCalculator"}
                  className={"price-calculator span-2"}
                  open
                  data-lookup-detail
                >
                  <summary>{t("Calculate a discounted price")}</summary>
                  <div className={"form-grid"}>
                    <div className={"field"}>
                      <label htmlFor={"regularPrice"}>
                        {t("Regular price")}{" "}
                        <span className={"hint"}>{t("optional")}</span>
                      </label>
                      <input
                        id={"regularPrice"}
                        type={"number"}
                        inputMode={"decimal"}
                        min={"0"}
                        step={"any"}
                        placeholder={t("Before discount")}
                      />
                    </div>
                    <div className={"field"}>
                      <label htmlFor={"discount"}>
                        {t("Discount")}{" "}
                        <span className={"hint"}>{t("optional")}</span>
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
                          aria-label={t("Discount type")}
                        >
                          <option value={"percent"}>{t("% off")}</option>
                          <option value={"amount"}>{t("Amount off")}</option>
                        </select>
                      </div>
                      <p id={"discountHint"} className={"hint"}>
                        {t("Enter a percentage from 0 to 100.")}
                      </p>
                    </div>
                    <p className={"hint span-2"}>
                      {t(
                        "Regular price and discount are used only for this calculation.",
                      )}
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
              <summary>{t("Pages, cover, notes & duplicate copy")}</summary>
              <div className="form-grid">
                <fieldset
                  id="metadataManager"
                  className="metadata-manager span-2"
                  data-series-detail
                >
                  <legend>{t("Book metadata")}</legend>
                  <div className="field">
                    <label htmlFor="msrp">{t("MSRP / list price")}</label>
                    <input
                      id="msrp"
                      name="msrp"
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder={t("Not available")}
                    />
                    <p className="hint">
                      {t(
                        "Separate from the shop price and your private price paid.",
                      )}
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="msrpCurrency">{t("MSRP currency")}</label>
                    <input
                      id="msrpCurrency"
                      name="msrpCurrency"
                      maxLength={3}
                      placeholder="THB, USD, JPY"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="edition">{t("Edition details")}</label>
                    <input
                      id="edition"
                      name="edition"
                      maxLength={500}
                      placeholder={t("Language, colour or edition")}
                    />
                    <p className="hint">
                      {t("Your edition label is private to your library.")}
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="pageCount">{t("Pages")}</label>
                    <input
                      id="pageCount"
                      name="pageCount"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      placeholder={t("Not recorded")}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="publisherUrl">{t("Publisher page")}</label>
                    <input
                      id="publisherUrl"
                      type="url"
                      maxLength={2000}
                      placeholder="https://…"
                    />
                    <ExternalLink
                      id="metadataPublisherLink"
                      target="_blank"
                      hidden
                    >
                      {t("Open publisher site ↗")}
                    </ExternalLink>
                  </div>
                  <div className="cover-editor">
                    <div id="metadataCoverPreview" />
                    <div className="field">
                      <label htmlFor="coverUrl">{t("Cover image URL")}</label>
                      <input
                        id="coverUrl"
                        type="url"
                        maxLength={2000}
                        placeholder={t(
                          "Use automatic cover, or enter an image URL",
                        )}
                      />
                      <p className="hint">
                        {t(
                          "Leave blank to use the automatic cover. New image URLs are downloaded when you save.",
                        )}
                      </p>
                      <button
                        id="pullPublisherCovers"
                        className="btn"
                        type="button"
                      >
                        {t("Pull covers")}
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
                    aria-label={t("Publisher and bookstore cover choices")}
                  />
                  <p className="hint">
                    {t("Choose a cover, then save your changes.")}
                  </p>
                </fieldset>
                <div className={"field span-2"} data-series-detail>
                  <label htmlFor={"note"}>{t("Notes")}</label>
                  <textarea
                    id={"note"}
                    name={"note"}
                    maxLength={2000}
                    placeholder={t("Special edition, a gift, a good find…")}
                  ></textarea>
                </div>
                <label className={"check span-2"} data-series-detail>
                  <input type={"checkbox"} id={"allowDuplicate"} />
                  {t("Another copy of an ISBN already on my shelf")}
                </label>
              </div>
            </details>
          </div>
        </div>
        <div className={"dialog-foot book-dialog-foot"}>
          <label className={"check span-2"} id={"keepAddingLabel"}>
            <input type={"checkbox"} id={"keepAdding"} />
            <span id={"keepAddingText"}>
              {t("Add another book after saving")}
            </span>
          </label>
          <button
            id={"removeButton"}
            className={"btn danger"}
            type={"button"}
            hidden
          >
            {t("Remove book")}
          </button>
          <div className={"buttons book-save-actions"}>
            <button id={"cancelBook"} className={"btn"} type={"button"}>
              {t("Cancel")}
            </button>
            <button id={"saveButton"} className={"btn primary"} type={"submit"}>
              {t("Add book")}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
