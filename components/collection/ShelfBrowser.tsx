import type { Store } from "../../lib/server/store.ts";
import ShelfEntries from "./ShelfEntries";
import BulkActions, { SelectionToggle } from "./BulkActions";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function ShelfBrowser({
  data,
  series,
  removed,
}: {
  data: Awaited<ReturnType<Store["api"]["getCollection"]>>;
  series: string | null;
  removed: boolean;
}) {
  const t = await getTranslations();
  const count = removed
    ? data.trash.length
    : series === null
      ? new Set(
          data.books.map((book) => book.series.trim() || "Untitled series"),
        ).size
      : data.books.filter(
          (book) => (book.series.trim() || "Untitled series") === series,
        ).length;
  const gallery = !removed;
  return (
    <div id={"collectionBrowser"}>
      <div className={"toolbar"}>
        <div className={"search"}>
          <svg aria-hidden={"true"}>
            <use href={"#i-search"} />
          </svg>
          <label htmlFor={"search"} className={"sr-only"}>
            {t("Search your collection")}
          </label>
          <input
            id={"search"}
            type={"search"}
            placeholder={t("Search series, ISBN, publisher or notes…")}
            autoComplete={"off"}
          />
        </div>
        <label htmlFor={"typeFilter"} className={"filter-label"}>
          {t("Filter by type")}
        </label>
        <select id={"typeFilter"}>
          <option value={""}>{t("All types")}</option>
        </select>
        <label htmlFor={"statusFilter"} className={"filter-label"}>
          {t("Filter by status")}
        </label>
        <select id={"statusFilter"}>
          <option value={""}>{t("All statuses")}</option>
        </select>
        <button
          id={"refreshButton"}
          className={"btn refresh"}
          aria-label={t("Refresh collection")}
        >
          <svg aria-hidden={"true"}>
            <use href={"#i-refresh"} />
          </svg>
        </button>
      </div>
      <details id="collectionFilters" className="collection-filters">
        <summary id="collectionFiltersSummary">
          {t("More filters & sorting")}
        </summary>
        <div className="collection-filter-grid">
          <div className="field">
            <label htmlFor="publisherFilter">{t("Publisher")}</label>
            <select id="publisherFilter">
              <option value="">{t("All publishers")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sourceFilter">{t("Bought from")}</label>
            <select id="sourceFilter">
              <option value="">{t("All stores")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="isbnFilter">ISBN</label>
            <select id="isbnFilter">
              <option value="">{t("Any ISBN")}</option>
              <option value="present">{t("With ISBN")}</option>
              <option value="missing">{t("Missing ISBN")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="priceFilter">{t("Recorded price")}</label>
            <select id="priceFilter">
              <option value="">{t("Any price")}</option>
              <option value="present">{t("With price")}</option>
              <option value="missing">{t("Missing price")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="minPriceFilter">{t("Minimum paid (฿)")}</label>
            <input
              id="minPriceFilter"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder={t("No minimum")}
            />
          </div>
          <div className="field">
            <label htmlFor="maxPriceFilter">{t("Maximum paid (฿)")}</label>
            <input
              id="maxPriceFilter"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder={t("No maximum")}
            />
          </div>
          <div className="field">
            <label htmlFor="dateFromFilter">{t("Bought on or after")}</label>
            <input id="dateFromFilter" type="date" />
          </div>
          <div className="field">
            <label htmlFor="dateToFilter">{t("Bought on or before")}</label>
            <input id="dateToFilter" type="date" />
          </div>
          <div className="field">
            <label htmlFor="collectionSort">{t("Sort by")}</label>
            <select id="collectionSort">
              <option value="default">{t("Series A–Z")}</option>
              <option value="spent">{t("Most spent")}</option>
              <option value="books">{t("Most books")}</option>
              <option value="recent">{t("Recently bought")}</option>
            </select>
          </div>
        </div>
        <p id="collectionFilterHint" className="hint">
          {t(
            "Filters match individual books. Series show only matching books; opening a series shows all owned volumes.",
          )}
        </p>
      </details>
      <div className={"list-label"}>
        <div className="collection-results">
          <span id={"resultCount"} role="status">
            {count}{" "}
            {t(
              removed
                ? "removed books"
                : series === null
                  ? "series"
                  : "owned volumes",
            )}
          </span>
          <button
            id="clearCollectionFilters"
            className="text-btn"
            type="button"
            hidden
          >
            {t("Clear filters")}
          </button>
        </div>
        <div className="selection-tools">
          <span id={"listRight"}>
            {t(
              removed
                ? "Ready to restore"
                : series === null
                  ? "Open a cover for details"
                  : "Ordered by volume",
            )}
          </span>
          <SelectionToggle grouped={!removed && series === null} />
        </div>
      </div>
      <BulkActions removed={removed} grouped={!removed && series === null} />
      <section
        id={"bookList"}
        className={"collection" + (gallery ? " cover-grid" : "")}
        aria-label={t(
          removed
            ? "Removed books"
            : series === null
              ? "Series"
              : "Owned volumes in {series}",
          { series: series ?? "" },
        )}
      >
        <ShelfEntries
          books={removed ? data.trash.map((entry) => entry.book) : data.books}
          series={series}
          removed={removed}
        />
      </section>
    </div>
  );
}
