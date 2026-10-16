import type { Store } from "../../lib/server/store.ts";
import ShelfEntries from "./ShelfEntries";

export default function ShelfBrowser({
  data,
  series,
  removed,
}: {
  data: ReturnType<Store["api"]["getCollection"]>;
  series: string | null;
  removed: boolean;
}) {
  const count = removed
    ? data.trash.length
    : series === null
      ? new Set(
          data.books.map((book) => book.series.trim() || "Untitled series"),
        ).size
      : data.books.filter(
          (book) => (book.series.trim() || "Untitled series") === series,
        ).length;
  const gallery = series === null && !removed;
  return (
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
      <details id="collectionFilters" className="collection-filters">
        <summary id="collectionFiltersSummary">
          More filters &amp; sorting
        </summary>
        <div className="collection-filter-grid">
          <div className="field">
            <label htmlFor="publisherFilter">Publisher</label>
            <select id="publisherFilter">
              <option value="">All publishers</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sourceFilter">Bought from</label>
            <select id="sourceFilter">
              <option value="">All stores</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="isbnFilter">ISBN</label>
            <select id="isbnFilter">
              <option value="">Any ISBN</option>
              <option value="present">With ISBN</option>
              <option value="missing">Missing ISBN</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="priceFilter">Recorded price</label>
            <select id="priceFilter">
              <option value="">Any price</option>
              <option value="present">With price</option>
              <option value="missing">Missing price</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="minPriceFilter">Minimum paid (฿)</label>
            <input
              id="minPriceFilter"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="No minimum"
            />
          </div>
          <div className="field">
            <label htmlFor="maxPriceFilter">Maximum paid (฿)</label>
            <input
              id="maxPriceFilter"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="No maximum"
            />
          </div>
          <div className="field">
            <label htmlFor="dateFromFilter">Bought on or after</label>
            <input id="dateFromFilter" type="date" />
          </div>
          <div className="field">
            <label htmlFor="dateToFilter">Bought on or before</label>
            <input id="dateToFilter" type="date" />
          </div>
          <div className="field">
            <label htmlFor="collectionSort">Sort by</label>
            <select id="collectionSort">
              <option value="default">Series A–Z</option>
              <option value="spent">Most spent</option>
              <option value="books">Most books</option>
              <option value="recent">Recently bought</option>
            </select>
          </div>
        </div>
        <p id="collectionFilterHint" className="hint">
          Filters match individual books. Series show only matching books;
          opening a series shows all owned volumes.
        </p>
      </details>
      <div className={"list-label"}>
        <div className="collection-results">
          <span id={"resultCount"} role="status">
            {count}{" "}
            {removed
              ? "removed books"
              : series === null
                ? "series"
                : "owned volumes"}
          </span>
          <button
            id="clearCollectionFilters"
            className="text-btn"
            type="button"
            hidden
          >
            Clear filters
          </button>
        </div>
        <span id={"listRight"}>
          {removed
            ? "Ready to restore"
            : series === null
              ? "Open a cover for details"
              : "Ordered by volume"}
        </span>
      </div>
      <section
        id={"bookList"}
        className={"collection" + (gallery ? " cover-grid" : "")}
        aria-label={gallery ? "Series" : "Books"}
      >
        <ShelfEntries
          books={removed ? data.trash.map((entry) => entry.book) : data.books}
          series={series}
          removed={removed}
        />
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
  );
}
