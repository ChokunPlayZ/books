export default function CollectionShell() {
  return (
    <>
      <svg className={"sr-only"} aria-hidden={"true"}>
        <defs>
          <symbol id={"i-books"} viewBox={"0 0 24 24"}>
            <path
              d={"M4 4h4v16H4zM10 6h4v14h-4zM16 4l4-1 4 16-4 1zM4 8h4M10 10h4"}
            />
          </symbol>
          <symbol id={"i-plus"} viewBox={"0 0 24 24"}>
            <path d={"M12 5v14M5 12h14"} />
          </symbol>
          <symbol id={"i-scan"} viewBox={"0 0 24 24"}>
            <path
              d={
                "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 8v8M10 8v8M14 8v8M17 8v8"
              }
            />
          </symbol>
          <symbol id={"i-search"} viewBox={"0 0 24 24"}>
            <circle cx={"10.5"} cy={"10.5"} r={"6.5"} />
            <path d={"m16 16 5 5"} />
          </symbol>
          <symbol id={"i-edit"} viewBox={"0 0 24 24"}>
            <path d={"m15 4 5 5M4 20l4-1L21 6l-3-3L5 16z"} />
          </symbol>
          <symbol id={"i-close"} viewBox={"0 0 24 24"}>
            <path d={"m6 6 12 12M6 18 18 6"} />
          </symbol>
          <symbol id={"i-refresh"} viewBox={"0 0 24 24"}>
            <path
              d={
                "M20 7v5h-5M4 17v-5h5M5.5 7a7.5 7.5 0 0 1 13-1L20 9M4 15l1.5 3a7.5 7.5 0 0 0 13-1"
              }
            />
          </symbol>
          <symbol id={"i-check"} viewBox={"0 0 24 24"}>
            <path d={"m5 12 4 4L19 6"} />
          </symbol>
          <symbol id={"i-wallet"} viewBox={"0 0 24 24"}>
            <path d={"M20 7H4V4h14v3M4 7v13h16V7M20 11h-6v5h6"} />
          </symbol>
          <symbol id={"i-grid"} viewBox={"0 0 24 24"}>
            <path d={"M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"} />
          </symbol>
        </defs>
      </svg>
      <header className={"top"}>
        <div className={"top-inner"}>
          <div className={"brand"}>
            <div className={"brand-mark"}>
              <svg aria-hidden={"true"}>
                <use href={"#i-books"} />
              </svg>
            </div>
            <div>
              <div className={"brand-name"}>{"Book Collection"}</div>
            </div>
          </div>
          <div className={"top-actions"}>
            <a id={"dataLink"} className={"text-btn"} href={"/data"}>
              {"Data & backups"}
            </a>
            <button id={"checkBookButton"} className={"btn"} disabled>
              <svg aria-hidden={"true"}>
                <use href={"#i-scan"} />
              </svg>
              {"Check a book"}
            </button>
            <button id={"addButton"} className={"btn primary"} disabled>
              <svg aria-hidden={"true"}>
                <use href={"#i-plus"} />
              </svg>
              {"Add book"}
            </button>
          </div>
        </div>
      </header>
      <main>
        <div id={"pageError"} className={"banner"} role={"alert"} hidden></div>
        <div id={"collectionHeading"} className={"sr-only"}>
          <h1>{"Your collection"}</h1>
        </div>
        <section
          id={"collectionStats"}
          className={"stats"}
          aria-label={"Collection overview"}
        >
          <div className={"stat"}>
            <div className={"stat-label"}>{"Books"}</div>
            <div id={"bookCount"} className={"stat-value"}>
              {"—"}
            </div>
          </div>
          <div className={"stat"}>
            <div className={"stat-label"}>{"Series"}</div>
            <div id={"seriesCount"} className={"stat-value"}>
              {"—"}
            </div>
          </div>
          <div className={"stat"}>
            <div className={"stat-label"}>{"Read"}</div>
            <div id={"readCount"} className={"stat-value"}>
              {"—"}
            </div>
            <div id={"readNote"} className={"stat-note"}>
              {"Marked as Read"}
            </div>
          </div>
          <div className={"stat"}>
            <div className={"stat-label"}>{"Spent (฿)"}</div>
            <div id={"spent"} className={"stat-value"}>
              {"—"}
            </div>
            <div id={"priceNote"} className={"stat-note"}>
              {"From your recorded purchases"}
            </div>
          </div>
        </section>
        <div className={"tabs"} aria-label={"Collection views"}>
          <button
            id={"collectionTab"}
            className={"tab active"}
            aria-pressed={"true"}
          >
            {"Collection "}
            <span id={"activeCount"} className={"sr-only"}>
              {"—"}
            </span>
          </button>
          <button id={"releasesTab"} className={"tab"} aria-pressed={"false"}>
            {"New releases "}
            <span id={"releaseCount"} className={"tab-count"} hidden>
              {"—"}
            </span>
          </button>
          <button id="discoverTab" className="tab" aria-pressed="false">
            Discover titles
          </button>
          <button
            id={"trashTab"}
            className={"tab"}
            aria-pressed={"false"}
            aria-label={"Recently removed"}
          >
            {"Removed "}
            <span id={"trashCount"} className={"tab-count"} hidden>
              {"0"}
            </span>
          </button>
        </div>
        <div id={"seriesHeader"} className={"series-header"} hidden>
          <button id={"backSeries"} className={"text-btn"}>
            {"← All series"}
          </button>
          <h1 id={"seriesTitle"}></h1>
          <div className={"series-summary-line"}>
            <p id={"seriesSummary"}></p>
            <button
              id={"seriesCatalogToggle"}
              className={"text-btn"}
              aria-controls={"seriesMissing"}
              aria-expanded={"false"}
              hidden
            >
              {"Catalog details"}
            </button>
          </div>
        </div>
        <section
          id={"seriesMissing"}
          className={"series-missing"}
          aria-labelledby={"seriesMissingTitle"}
          hidden
        >
          <h2 id={"seriesMissingTitle"}>{"What you’re missing"}</h2>
          <p id={"seriesMissingSummary"} className={"hint"} role={"status"}></p>
          <div id={"seriesGaps"} className={"missing-editions"}></div>
          <div id={"seriesCatalogHeading"} className={"series-release-head"}>
            <div>
              <h3>{"Publisher catalog"}</h3>
            </div>
            <button id={"refreshSeriesReleases"} className={"btn"}>
              {"Refresh catalog"}
            </button>
          </div>
          <div
            id={"seriesReleaseError"}
            className={"banner"}
            role={"alert"}
            hidden
          ></div>
          <p id={"seriesReleaseStatus"} className={"hint"} role={"status"}></p>
          <details id={"seriesCatalogDetails"} className={"publisher-details"}>
            <summary>{"Sources & catalog settings"}</summary>
            <div
              id={"seriesReleaseSources"}
              className={"publisher-sources"}
            ></div>
            <p className={"hint release-note"}>
              {
                "Shelf gaps use whole volume numbers up to your highest owned volume. Catalog checks include older listings in the publisher’s series category, or Luckpim’s full title search. Removed listings and unrecorded purchases can affect the comparison."
              }
            </p>
          </details>
          <div id={"seriesReleaseList"} className={"release-grid"}></div>
          <details
            id={"seriesReleaseReview"}
            className={"series-review"}
            hidden
          >
            <summary id={"seriesReleaseReviewSummary"}></summary>
            <div
              id={"seriesReleaseReviewList"}
              className={"release-grid"}
            ></div>
          </details>
        </section>
        <div id={"collectionBrowser"}>
          <div className={"toolbar"}>
            <div className={"search"}>
              <svg aria-hidden={"true"}>
                <use href={"#i-search"} />
              </svg>
              <label htmlFor={"search"} className={"sr-only"}>
                {"Search your collection"}
              </label>
              <input
                id={"search"}
                type={"search"}
                placeholder={"Search series, ISBN, publisher or notes…"}
                autoComplete={"off"}
              />
            </div>
            <label htmlFor={"typeFilter"} className={"filter-label"}>
              {"Filter by type"}
            </label>
            <select id={"typeFilter"}>
              <option value={""}>{"All types"}</option>
            </select>
            <label htmlFor={"statusFilter"} className={"filter-label"}>
              {"Filter by status"}
            </label>
            <select id={"statusFilter"}>
              <option value={""}>{"All statuses"}</option>
            </select>
            <button
              id={"refreshButton"}
              className={"btn refresh"}
              aria-label={"Refresh collection"}
            >
              <svg aria-hidden={"true"}>
                <use href={"#i-refresh"} />
              </svg>
            </button>
          </div>
          <div className={"list-label"}>
            <span id={"resultCount"}>{"Loading your collection"}</span>
            <span id={"listRight"}>{"Your volumes"}</span>
          </div>
          <section
            id={"bookList"}
            className={"collection"}
            aria-label={"Books"}
          >
            <div className={"loading"}>{"Opening your shelf…"}</div>
          </section>
          <div id={"pagination"} className={"pagination"} hidden>
            <span id={"pageInfo"}></span>
            <div className={"buttons"}>
              <button id={"previousPage"} className={"btn"}>
                {"Previous"}
              </button>
              <button id={"nextPage"} className={"btn"}>
                {"Next"}
              </button>
            </div>
          </div>
        </div>
        <section id={"releasesPanel"} aria-label={"Publisher releases"} hidden>
          <div className={"release-heading"}>
            <h1>{"New releases"}</h1>
            <div className={"buttons"}>
              <button id={"refreshReleases"} className={"btn"}>
                {"Refresh releases"}
              </button>
            </div>
          </div>
          <details className={"publisher-details"}>
            <summary id={"publisherCheckSummary"}>
              {"Publisher sources & check times"}
            </summary>
            <div id={"publisherSources"} className={"publisher-sources"}></div>
            <p className={"release-note"}>
              {
                "Catalog listings can include pre-orders. Special sets are skipped automatically. Dates and availability may change. Owning a regular or special edition counts toward the same volume. Colored manga matches regular manga in the same language. “Check edition” shows matching volumes with a different or missing ISBN, and other sets that need review."
              }
            </p>
          </details>
          <div
            id={"releaseError"}
            className={"banner"}
            role={"alert"}
            hidden
          ></div>
          <div className={"toolbar release-filters"}>
            <div className={"search"}>
              <svg aria-hidden={"true"}>
                <use href={"#i-search"} />
              </svg>
              <label htmlFor={"releaseSearch"} className={"sr-only"}>
                {"Search releases"}
              </label>
              <input
                id={"releaseSearch"}
                type={"search"}
                placeholder={"Search releases or ISBN…"}
              />
            </div>
            <label htmlFor={"releasePublisher"} className={"sr-only"}>
              {"Publisher"}
            </label>
            <select id={"releasePublisher"}>
              <option value={""}>{"All publishers"}</option>
              <option value={"phoenix"}>{"Phoenix Next"}</option>
              <option value={"firstpage"}>{"First Page Pro"}</option>
              <option value={"luckpim"}>{"Luckpim"}</option>
            </select>
            <label htmlFor={"releaseScope"} className={"sr-only"}>
              {"Release list"}
            </label>
            <select id={"releaseScope"}>
              <option value={"unbought"}>{"Not bought yet"}</option>
              <option value={"all"}>{"All releases"}</option>
              <option value={"series"}>{"For my series"}</option>
              <option value={"review"}>{"Check edition"}</option>
              <option value={"owned"}>{"On my shelf"}</option>
              <option value={"saved"}>{"Saved for later"}</option>
            </select>
            <label htmlFor={"releaseType"} className={"sr-only"}>
              {"Release type"}
            </label>
            <select id={"releaseType"}>
              <option value={""}>{"All types"}</option>
              <option value={"LN"}>{"Light novels (LN)"}</option>
              <option value={"Manga"}>{"Manga"}</option>
            </select>
            <button
              id={"hideSpecialReleases"}
              className={"btn"}
              type={"button"}
              aria-pressed={"false"}
              aria-controls={"releaseList"}
            >
              {"Hide special editions"}
            </button>
          </div>
          <p
            id={"releaseOwnershipSummary"}
            className={"release-note"}
            role={"status"}
          ></p>
          <div className={"list-label"}>
            <span id={"releaseResultCount"} role={"status"}>
              {"Checking publishers…"}
            </span>
          </div>
          <div id={"releaseList"} className={"release-grid"}></div>
        </section>
        <section
          id="discoverPanel"
          aria-label="Discover publisher titles"
          hidden
        >
          <div className="release-heading">
            <div>
              <h1>Discover titles</h1>
              <p className="release-note">
                Find series you haven’t started. One book per title, preferably
                volume 1.
              </p>
            </div>
            <button id="refreshDiscovery" className="btn">
              Refresh titles
            </button>
          </div>
          <form id="discoveryForm" className="discovery-source">
            <label className="field" htmlFor="discoveryPreset">
              <span>Browse a publisher category</span>
              <select
                id="discoveryPreset"
                defaultValue="https://www.phoenixnext.com/gl.html"
              >
                <option value="https://www.phoenixnext.com/book-series.html">
                  Phoenix Next · All titles
                </option>
                <option value="https://www.phoenixnext.com/gl.html">
                  Phoenix Next · Girl’s Love
                </option>
                <option value="https://www.phoenixnext.com/bl.html">
                  Phoenix Next · Boy’s Love
                </option>
                <option value="https://www.phoenixnext.com/manga.html">
                  Phoenix Next · Manga
                </option>
                <option value="https://www.phoenixnext.com/light-novel.html">
                  Phoenix Next · Light novels
                </option>
                <option value="https://www.firstpagepro.com/">
                  First Page Pro · All titles
                </option>
                <option value="">Another category URL</option>
              </select>
            </label>
            <label className="field discovery-url" htmlFor="discoveryUrl">
              <span>Publisher category URL</span>
              <input
                id="discoveryUrl"
                type="url"
                required
                defaultValue="https://www.phoenixnext.com/gl.html"
                placeholder="Phoenix Next or First Page Pro category URL"
              />
            </label>
            <button id="loadDiscovery" className="btn primary" type="submit">
              Load titles
            </button>
          </form>
          <p className="release-note">
            Titles come from the publisher’s navigation. Any series already on
            your shelf is hidden.
          </p>
          <div id="discoveryError" className="banner" role="alert" hidden></div>
          <div id="discoverySource" className="discovery-status"></div>
          <div className="toolbar release-filters">
            <div className="search">
              <label htmlFor="discoverySearch" className="sr-only">
                Search discovered titles
              </label>
              <input
                id="discoverySearch"
                type="search"
                placeholder="Search titles…"
              />
            </div>
          </div>
          <p id="discoveryCount" className="release-note" role="status"></p>
          <div id="discoveryList" className="discovery-grid"></div>
        </section>
        <footer className={"footer"}>
          <span id={"syncNote"}>{"Opening your library"}</span>
        </footer>
      </main>
      <dialog id={"bookDialog"} aria-labelledby={"bookDialogTitle"}>
        <div className={"dialog-head"}>
          <div>
            <h2 id={"bookDialogTitle"}>{"Add to your shelf"}</h2>
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
        <form id={"bookForm"}>
          <div className={"dialog-body"}>
            <div
              id={"formError"}
              className={"form-error"}
              role={"alert"}
              hidden
            ></div>
            <div className={"form-grid"}>
              <div className={"field span-2"} data-series-detail>
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
                    placeholder={"978… or ISBN-10"}
                    maxLength={"40"}
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
                  {
                    "A USB or Bluetooth scanner can type here. Press Enter to look up."
                  }
                </p>
              </div>
              <div
                id={"lookupResult"}
                className={"lookup span-2"}
                role={"status"}
                hidden
              ></div>
              <div className={"field span-2"}>
                <label htmlFor={"series"}>{"Series / book title *"}</label>
                <input
                  id={"series"}
                  name={"series"}
                  list={"seriesOptions"}
                  required
                  maxLength={"500"}
                  placeholder={"Which story is this?"}
                />
                <datalist id={"seriesOptions"}></datalist>
              </div>
              <div
                id={"seriesDefaults"}
                className={"series-defaults span-2"}
                hidden
              >
                <p id={"seriesDefaultsText"} role={"status"}></p>
                <button
                  id={"toggleBookDetails"}
                  className={"text-btn"}
                  type={"button"}
                  aria-expanded={"false"}
                >
                  {"Edit other details"}
                </button>
              </div>
              <div className={"field"}>
                <label htmlFor={"volume"}>{"Volume"}</label>
                <input
                  id={"volume"}
                  name={"volume"}
                  type={"number"}
                  min={"0"}
                  step={"any"}
                  placeholder={"e.g. 1 or 4.5"}
                />
              </div>
              <div className={"field"} data-series-detail>
                <label htmlFor={"type"}>{"Type *"}</label>
                <select id={"type"} name={"type"} required></select>
              </div>
              <div className={"field"} data-series-detail>
                <label htmlFor={"publisher"}>{"Publisher"}</label>
                <input
                  id={"publisher"}
                  name={"publisher"}
                  list={"publisherOptions"}
                  maxLength={"500"}
                  placeholder={"Choose or enter a publisher"}
                />
                <datalist id={"publisherOptions"}></datalist>
              </div>
              <div className={"field"}>
                <label htmlFor={"status"}>{"Reading status *"}</label>
                <select id={"status"} name={"status"} required></select>
              </div>
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
                    maxLength="2000"
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
                      maxLength="2000"
                      placeholder="Use automatic cover, or enter an image URL"
                    />
                    <p className="hint">
                      Leave blank to use the automatic cover.
                    </p>
                    <button
                      id="pullPublisherCovers"
                      className="btn"
                      type="button"
                    >
                      Pull publisher covers
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
                  aria-label="Publisher cover choices"
                />
                <p className="hint">Choose a cover, then save your changes.</p>
              </fieldset>
              <div className={"field"} data-series-detail>
                <label htmlFor={"source"}>{"Bought from"}</label>
                <input
                  id={"source"}
                  name={"source"}
                  list={"sourceOptions"}
                  maxLength={"500"}
                  placeholder={"Shop, book fair, or gift"}
                />
                <datalist id={"sourceOptions"}></datalist>
              </div>
              <div className={"field"}>
                <label htmlFor={"date"}>{"Date bought"}</label>
                <input id={"date"} name={"date"} type={"date"} />
              </div>
              <fieldset className={"purchase-price span-2"}>
                <legend>{"Purchase price"}</legend>
                <div className={"form-grid"}>
                  <div className={"field span-2"}>
                    <label htmlFor={"price"}>
                      {"Sale price / amount paid"}
                    </label>
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
                      {"Use your collection’s currency."}
                    </p>
                  </div>
                  <details
                    id={"priceCalculator"}
                    className={"price-calculator span-2"}
                    open
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
                  ></p>
                </div>
              </fieldset>
              <div className={"field span-2"} data-series-detail>
                <label htmlFor={"note"}>{"Notes"}</label>
                <textarea
                  id={"note"}
                  name={"note"}
                  maxLength={"2000"}
                  placeholder={"Special edition, a gift, a good find…"}
                ></textarea>
              </div>
              <label className={"check span-2"} data-series-detail>
                <input type={"checkbox"} id={"allowDuplicate"} />
                {"Another copy of an ISBN already on my shelf"}
              </label>
              <label className={"check span-2"} id={"keepAddingLabel"}>
                <input type={"checkbox"} id={"keepAdding"} />
                <span id={"keepAddingText"}>
                  {"Keep adding books with the same type, publisher and shop"}
                </span>
              </label>
            </div>
          </div>
          <div className={"dialog-foot"}>
            <button
              id={"removeButton"}
              className={"btn danger"}
              type={"button"}
              hidden
            >
              {"Remove book"}
            </button>
            <div className={"buttons"}>
              <button id={"cancelBook"} className={"btn"} type={"button"}>
                {"Cancel"}
              </button>
              <button
                id={"saveButton"}
                className={"btn primary"}
                type={"submit"}
              >
                {"Add book"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
      <dialog id={"scanDialog"} aria-labelledby={"scanTitle"}>
        <div className={"dialog-head"}>
          <div>
            <h2 id={"scanTitle"}>{"Scan a book"}</h2>
            <p>{"Include the barcode and any printed ISBN above it."}</p>
          </div>
          <button
            id={"closeScan"}
            className={"close"}
            aria-label={"Close scanner"}
          >
            <svg aria-hidden={"true"}>
              <use href={"#i-close"} />
            </svg>
          </button>
        </div>
        <div className={"dialog-body"}>
          <div id={"scannerArea"} className={"scanner-area"}></div>
          <div className={"buttons scan-buttons"}>
            <label className={"btn primary file"}>
              {"Take photo"}
              <input
                id={"barcodePhoto"}
                type={"file"}
                accept={"image/*"}
                capture={"environment"}
                aria-label={"Take a barcode photo"}
              />
            </label>
            <label className={"btn file"}>
              {"Choose photo"}
              <input
                id={"chooseBarcodePhoto"}
                type={"file"}
                accept={"image/*"}
                aria-label={"Choose a barcode photo"}
              />
            </label>
            <button id={"startCamera"} className={"btn"} type={"button"}>
              {"Live camera"}
            </button>
            <button id={"stopCamera"} className={"btn"} type={"button"} hidden>
              {"Stop camera"}
            </button>
          </div>
          <p id={"scanMessage"} className={"scanner-note"} role={"status"}>
            {
              "Take or choose a photo, or use the live camera. Photos stay on your device."
            }
          </p>
          <div
            id={"scanCandidates"}
            className={"buttons scan-buttons"}
            hidden
          ></div>
        </div>
      </dialog>
      <dialog id={"removeDialog"} aria-labelledby={"removeTitle"}>
        <div className={"dialog-head"}>
          <div>
            <h2 id={"removeTitle"}>{"Remove from your shelf?"}</h2>
            <p>{"You can restore this book from Recently removed."}</p>
          </div>
          <button
            id={"closeRemove"}
            className={"close"}
            aria-label={"Cancel removal"}
          >
            <svg aria-hidden={"true"}>
              <use href={"#i-close"} />
            </svg>
          </button>
        </div>
        <div className={"dialog-body"}>
          <p id={"removeName"} className={"remove-name"}></p>
          <p className={"hint"}>
            {"Its price will be removed from your collection total."}
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
              {"Keep book"}
            </button>
            <button id={"confirmRemove"} className={"btn danger"}>
              {"Remove book"}
            </button>
          </div>
        </div>
      </dialog>
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
                  maxLength={"40"}
                  autoComplete={"off"}
                />
                <button
                  id={"checkIsbnButton"}
                  className={"btn"}
                  type={"submit"}
                >
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
                  maxLength={"40"}
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
      <div id={"toast"} className={"toast"} role={"status"} hidden></div>
    </>
  );
}
