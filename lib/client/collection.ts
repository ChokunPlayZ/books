import { $, node, icon, fillOptions, number, requestId } from "./dom.ts";
import { createCollectionState } from "./state.ts";
import { restorePagePreferences } from "./page-preferences.ts";
import { createInfiniteList } from "./infinite-list.ts";
import { createBulkSelection } from "./bulk-selection.ts";
import { createPublisherIsbnSearch } from "./publisher-isbn-search.ts";
import { createSeriesEditor } from "./series-editor.ts";
import { createMissingBrowser } from "./missing.ts";
import { shelfCoverBook, coverTint } from "../domain/shelf.ts";
import { seriesPath, type CollectionView } from "../domain/navigation.ts";
import { createScanner } from "./scanner.ts";
import { canonicalIsbn as canonical } from "../domain/isbn.ts";
import { kinokuniyaSearchUrl } from "../domain/urls.ts";
import {
  releaseSeriesKey,
  matchingBookType,
  releaseSingleVolume,
  publisherKey,
  seriesGaps,
  matchRelease,
  discoverTitles,
} from "./matching.ts";
// Collection controller. Talks only to this app’s same-origin Next.js API.

export function mountCollection({
  view,
  series,
}: {
  view: CollectionView;
  series: string | null;
}) {
  const events = new AbortController();
  const FIELDS = [
    "isbn",
    "series",
    "type",
    "publisher",
    "status",
    "volume",
    "source",
    "price",
    "date",
    "note",
  ] as const;

  const COLLECTION_FILTERS = [
    "search",
    "typeFilter",
    "statusFilter",
    "publisherFilter",
    "sourceFilter",
    "isbnFilter",
    "priceFilter",
    "minPriceFilter",
    "maxPriceFilter",
    "dateFromFilter",
    "dateToFilter",
  ] as const;
  const state = createCollectionState();
  state.view = view;
  state.selectedSeries = series;
  const savePagePreferences = restorePagePreferences(view);
  if (view === "discover") state.discoveryUrl = $("discoveryUrl").value;
  let toastTimer;
  const missingBrowser = createMissingBrowser({
    rpc,
    signal: events.signal,
    addCatalogVolume: (item) => {
      if (!state.busy) openRelease(item, releaseMatches(item));
    },
    addVolume: (series, edition, volume) => {
      if (state.busy) return;
      openBook(null, {
        series,
        volume,
        type: edition.type || "Other",
        publisher: edition.publisher,
      });
    },
  });
  const shelfList = $("bookList")
    ? createInfiniteList($("bookList"), () =>
        $("bookList")
          .querySelectorAll(".shelf-cover")
          .forEach((frame) => coverObserver.unobserve(frame)),
      )
    : null;
  const releaseList = $("releaseList")
    ? createInfiniteList($("releaseList"))
    : null;
  const discoveryList = $("discoveryList")
    ? createInfiniteList($("discoveryList"), () =>
        $("discoveryList")
          .querySelectorAll(".discovery-card")
          .forEach((card) => titleObserver.unobserve(card)),
      )
    : null;
  const discoveryCardUpdates = new WeakMap<
    Node,
    (item, saved: Set<string>) => void
  >();
  const bulkSelection = createBulkSelection({
    signal: events.signal,
    removed: view === "trash",
    isBusy: () => state.busy,
    setBusy,
    rpc,
    load,
    notify,
    errorAt,
  });
  const publisherIsbnSearch = createPublisherIsbnSearch({
    rpc,
    signal: events.signal,
    onChange: () => {
      renderDiscovery();
      renderReleases();
    },
  });

  function errorAt(id, error) {
    const e = $(id);
    if (!e) return;
    e.textContent = error?.message || String(error);
    e.hidden = false;
  }
  function notify(text) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 4200);
  }
  async function rpc(name: string, arg?: unknown) {
    const response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arg }),
      signal: events.signal,
    });
    if (response.status === 401) {
      window.location.assign(
        "/login?returnTo=" + encodeURIComponent(window.location.pathname),
      );
      throw new Error("Sign in to open your library.");
    }
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.message || "The request could not finish.");
    if (value.bookCoverIds && state.data) {
      for (const book of state.data.books) {
        if (Object.hasOwn(value.bookCoverIds, book.row))
          book.coverId = value.bookCoverIds[book.row];
      }
      refreshVisibleCovers();
    }
    return value;
  }

  async function load(refreshMissingCatalogs = false) {
    if ($("refreshButton")) $("refreshButton").disabled = true;
    $("pageError").hidden = true;
    try {
      state.data = await rpc("getCollection");
      (["series", "publisher", "source"] as const).forEach((k) =>
        fillOptions(k + "Options", state.data.options[k]),
      );
      (["type", "status"] as const).forEach((k) => {
        if ($(`${k}Filter`))
          fillOptions(
            k + "Filter",
            state.data.options[k],
            "All " + (k === "type" ? "types" : "statuses"),
          );
        if (!$("bookDialog").open) fillOptions(k, state.data.options[k]);
      });
      if ($("publisherFilter"))
        fillOptions(
          "publisherFilter",
          state.data.options.publisher,
          "All publishers",
        );
      if ($("sourceFilter"))
        fillOptions("sourceFilter", state.data.options.source, "All stores");
      $("addButton").disabled = state.busy;
      $("checkBookButton").disabled = state.busy;
      if ($("editTitleButton")) $("editTitleButton").disabled = state.busy;
      seriesEditor.syncControls();
      $("syncNote").textContent =
        "Updated " +
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }) +
        " · Saved in your library";
      render();
      if (state.view === "missing") {
        const catalogs = missingBrowser.loadCatalogs(refreshMissingCatalogs);
        if (refreshMissingCatalogs) await catalogs;
      }
      if (state.selectedSeries !== null && !state.catalogRefreshing)
        void loadSeriesCatalogs();
    } catch (error) {
      errorAt("pageError", error);
      if (!state.data && $("bookList"))
        $("bookList").replaceChildren(
          node(
            "div",
            "empty",
            "Your shelf could not be loaded. Try refreshing.",
          ),
        );
      throw error;
    } finally {
      if ($("refreshButton")) $("refreshButton").disabled = false;
    }
  }
  function recordedPrice(book) {
    if (
      book.price === null ||
      book.price === undefined ||
      String(book.price).trim() === ""
    )
      return null;
    const price = Number(book.price);
    return Number.isFinite(price) && price >= 0 ? price : null;
  }
  function spendingTotal(books) {
    return books.reduce((sum, book) => sum + (recordedPrice(book) ?? 0), 0);
  }
  function spendingGroups(books, key) {
    const groups = new Map();
    books.forEach((book) => {
      const name = key(book);
      if (!name) return;
      if (!groups.has(name))
        groups.set(name, { name, total: 0, count: 0, priced: 0 });
      const group = groups.get(name),
        price = recordedPrice(book);
      group.count++;
      if (price !== null) {
        group.total += price;
        group.priced++;
      }
    });
    return [...groups.values()]
      .filter((group) => group.priced)
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }
  function renderCollectionSpending(books) {
    const series = spendingGroups(books, seriesKey),
      stores = spendingGroups(books, (book) =>
        String(book.source || "").trim(),
      ),
      priced = books.filter((book) => recordedPrice(book) !== null),
      missing = books.length - priced.length,
      unknownStores = priced.filter(
        (book) => !String(book.source || "").trim(),
      );
    const note = (group) =>
      number(group.count) +
      (group.count === 1 ? " book" : " books") +
      " · " +
      number(group.priced) +
      " with prices";
    (
      [
        ["Series", series],
        ["Store", stores],
      ] as const
    ).forEach(([kind, groups]) => {
      const top = groups[0];
      $(("top" + kind + "Name") as keyof LibraryElements).textContent =
        top?.name ||
        (kind === "Series"
          ? "No prices recorded yet"
          : "No store spending recorded yet");
      $(("top" + kind + "Amount") as keyof LibraryElements).textContent = top
        ? "฿" + number(top.total)
        : "—";
      $(("top" + kind + "Note") as keyof LibraryElements).textContent = top
        ? note(top) +
          (groups[1]?.total === top.total ? " · Tied for most spent" : "")
        : "Add purchase details to see your spending here.";
      const list = $(
        (kind.toLowerCase() + "SpendingList") as keyof LibraryElements,
      );
      list.replaceChildren();
      if (!groups.length)
        list.append(node("li", "hint", "No recorded spending yet."));
      groups.slice(0, 5).forEach((group) => {
        const item = node("li", "spending-item"),
          copy = node("div");
        copy.append(
          node("span", "spending-name", group.name),
          node("span", "hint", note(group)),
        );
        item.append(copy, node("strong", "", "฿" + number(group.total)));
        list.append(item);
      });
    });
    $("spendingCoverage").textContent =
      number(priced.length) +
      " of " +
      number(books.length) +
      " books have prices." +
      (priced.length
        ? " Average paid: ฿" +
          number(spendingTotal(priced) / priced.length) +
          "."
        : "") +
      (missing
        ? " " +
          number(missing) +
          " without prices are excluded from spending totals."
        : "") +
      (unknownStores.length
        ? " Purchases without a store: ฿" +
          number(spendingTotal(unknownStores)) +
          " across " +
          number(unknownStores.length) +
          (unknownStores.length === 1 ? " book" : " books") +
          "; excluded from store rankings."
        : "");
  }
  function collectionFilters() {
    return Object.fromEntries(
      COLLECTION_FILTERS.map((id) => [id, $(id).value.trim()]),
    );
  }
  function resetCollectionFilters() {
    COLLECTION_FILTERS.forEach((id) => ($(id).value = ""));
    $("collectionSort").value = "default";
  }
  function matchesCollectionBook(book, filters) {
    const q = filters.search.toLocaleLowerCase(),
      price = recordedPrice(book);
    return (
      (!q ||
        FIELDS.some((key) =>
          String(book[key] ?? "")
            .toLocaleLowerCase()
            .includes(q),
        )) &&
      (["type", "status", "publisher", "source"] as const).every(
        (key) =>
          !filters[key + "Filter"] || book[key] === filters[key + "Filter"],
      ) &&
      (!filters.isbnFilter ||
        !!String(book.isbn || "").trim() ===
          (filters.isbnFilter === "present")) &&
      (!filters.priceFilter ||
        (price !== null) === (filters.priceFilter === "present")) &&
      (!filters.minPriceFilter ||
        (price !== null && price >= Number(filters.minPriceFilter))) &&
      (!filters.maxPriceFilter ||
        (price !== null && price <= Number(filters.maxPriceFilter))) &&
      (!filters.dateFromFilter ||
        (!!book.date && book.date >= filters.dateFromFilter)) &&
      (!filters.dateToFilter ||
        (!!book.date && book.date <= filters.dateToFilter))
    );
  }
  function compareCollectionEntries(a, b, sort, grouped) {
    const aBooks = grouped ? a.books : [a.book],
      bBooks = grouped ? b.books : [b.book];
    if (sort === "spent") {
      const aPriced = aBooks.some((book) => recordedPrice(book) !== null),
        bPriced = bBooks.some((book) => recordedPrice(book) !== null),
        difference =
          Number(bPriced) - Number(aPriced) ||
          spendingTotal(bBooks) - spendingTotal(aBooks);
      if (difference) return difference;
    }
    if (sort === "books" && aBooks.length !== bBooks.length)
      return bBooks.length - aBooks.length;
    if (sort === "recent") {
      const latest = (books) =>
          books.reduce(
            (date, book) => (book.date > date ? book.date : date),
            "",
          ),
        difference = latest(bBooks).localeCompare(latest(aBooks));
      if (difference) return difference;
    }
    return grouped
      ? a.series.localeCompare(b.series)
      : byVolume(a.book, b.book);
  }
  function render() {
    if (!state.data) return;
    const releases = state.view === "releases";
    const discover = state.view === "discover";
    const { books, trash } = state.data;
    $("activeCount").textContent = number(books.length);
    $("trashCount").textContent = number(trash.length);
    $("trashCount").hidden = !trash.length;
    if ($("collectionStats")) {
      $("bookCount").textContent = number(books.length);
      $("seriesCount").textContent = number(
        new Set(books.map((b) => String(b.series).trim()).filter(Boolean)).size,
      );
      const read = books.filter((b) => b.status === "Read").length;
      $("readCount").textContent = number(read);
      $("readNote").textContent = books.length
        ? Math.round((read / books.length) * 100) + "% of your shelf"
        : "Your next read awaits";
      $("readProgress").style.width =
        (books.length ? (read / books.length) * 100 : 0) + "%";
      const prices = books.filter((book) => recordedPrice(book) !== null);
      $("spent").textContent = number(spendingTotal(books));
      const missingPrices = books.length - prices.length;
      $("priceNote").textContent = missingPrices
        ? number(missingPrices) +
          (missingPrices === 1 ? " book has" : " books have") +
          " no price"
        : "";
    }
    if (releases) {
      renderReleases();
      return;
    }
    if (discover) {
      renderDiscovery();
      return;
    }
    if (state.view === "missing") {
      missingBrowser.render(books);
      return;
    }
    const filters = collectionFilters(),
      filtered = Object.values(filters).some(Boolean),
      matches = (book) => matchesCollectionBook(book, filters);
    const grouped =
      state.view === "collection" && state.selectedSeries === null;
    $("collectionSort").options[0].textContent = grouped
      ? "Series A–Z"
      : state.view === "trash"
        ? "Recently removed"
        : "Volume order";
    $("collectionSort").querySelector<HTMLOptionElement>(
      '[value="books"]',
    ).disabled = !grouped;
    if (!grouped && $("collectionSort").value === "books")
      $("collectionSort").value = "default";
    const sort = $("collectionSort").value,
      advancedCount =
        COLLECTION_FILTERS.slice(3).filter((id) => filters[id]).length +
        Number(sort !== "default");
    $("collectionFiltersSummary").textContent =
      "More filters & sorting" +
      (advancedCount ? " · " + advancedCount + " active" : "");
    $("clearCollectionFilters").hidden = !filtered && sort === "default";
    $("collectionFilterHint").textContent = grouped
      ? "Filters match individual books. Series show only matching books; opening a series shows all owned volumes."
      : "Filters apply to the books shown below. Spending summaries always use your whole collection.";
    const owned =
      state.selectedSeries !== null
        ? books.filter((b) => seriesKey(b) === state.selectedSeries)
        : [];
    const sharedDetails = Object.fromEntries(
      (["type", "publisher", "source"] as const).map((field) => [
        field,
        owned.length && owned.every((book) => book[field] === owned[0][field])
          ? owned[0][field]
          : "",
      ]),
    );
    let entries;
    if (grouped) {
      const groups = new Map();
      books.forEach((b) => {
        if (!matches(b)) return;
        const key = seriesKey(b);
        if (!groups.has(key))
          groups.set(key, { series: key, books: [], filtered });
        groups.get(key).books.push(b);
      });
      entries = [...groups.values()];
    } else {
      entries = (
        state.view === "trash" ? trash : owned.map((book) => ({ book }))
      ).filter(({ book }) => matches(book));
    }
    if (grouped || state.view === "collection" || sort !== "default")
      entries.sort((a, b) => compareCollectionEntries(a, b, sort, grouped));
    $("resultCount").textContent =
      number(entries.length) +
      (grouped
        ? " series"
        : state.selectedSeries !== null
          ? entries.length === 1
            ? " owned volume"
            : " owned volumes"
          : entries.length === 1
            ? " removed book"
            : " removed books") +
      (filtered ? " found" : "");
    $("listRight").textContent =
      sort === "spent"
        ? "Most spent first"
        : sort === "recent"
          ? "Recently bought first"
          : grouped
            ? "Open a cover for details"
            : state.view === "collection"
              ? "Ordered by volume"
              : "Ready to restore";
    $("bookList").setAttribute(
      "aria-label",
      grouped
        ? "Series"
        : state.selectedSeries !== null
          ? "Owned volumes in " + state.selectedSeries
          : "Removed books",
    );
    if ($("collectionSpending")) renderCollectionSpending(books);
    if (state.selectedSeries !== null) {
      $("seriesTitle").textContent = state.selectedSeries;
      const numbered = owned.filter(
        (b) => b.volume !== "" && b.volume !== null,
      ).length;
      $("seriesSummary").textContent =
        number(owned.length) +
        " owned " +
        (owned.length === 1 ? "volume" : "volumes") +
        " · " +
        [...new Set(owned.map((b) => b.type).filter(Boolean))].join(", ") +
        (sharedDetails.publisher ? " · " + sharedDetails.publisher : "") +
        (sharedDetails.source ? " · " + sharedDetails.source : "") +
        " · ฿" +
        number(spendingTotal(owned)) +
        " recorded spending" +
        (numbered < owned.length
          ? " · " + (owned.length - numbered) + " unnumbered"
          : "");
      renderSeriesMissing();
    }
    $("addButton").replaceChildren(
      icon("plus"),
      document.createTextNode(
        state.selectedSeries !== null ? "Add volume" : "Add book",
      ),
    );
    $("search").placeholder = grouped
      ? "Search series, ISBN, publisher or notes…"
      : "Search volumes, ISBN, publisher or notes…";
    const selectionKey = JSON.stringify([
      state.view,
      state.selectedSeries,
      filters,
      sort,
    ]);
    bulkSelection.refresh(
      entries.map((entry) => ({
        key: grouped ? entry.series : String(entry.book.row),
        books: grouped ? entry.books : [entry.book],
        ...(entry.id ? { trashId: entry.id } : {}),
      })),
      selectionKey,
      state.data.options.status,
    );
    shelfList.render(
      entries,
      (entry) => (grouped ? seriesRow(entry) : bookRow(entry)),
      {
        key: JSON.stringify([state.view, state.selectedSeries, filters, sort]),
        label: grouped
          ? "series"
          : state.selectedSeries !== null
            ? "volumes"
            : "removed books",
      },
    );
    bulkSelection.syncControls();
    if (!entries.length) {
      const empty = node("div", "empty");
      const illustration = node("span", "empty-icon");
      illustration.append(icon("books"));
      empty.append(illustration);
      empty.append(
        node(
          "h2",
          "",
          state.view === "trash"
            ? "Nothing removed"
            : grouped
              ? books.length
                ? "No series found"
                : "Your shelf starts here"
              : "No volumes found",
        ),
        node(
          "p",
          "",
          state.view === "trash"
            ? "Removed books will be kept here until you restore them."
            : "Try a different search or add a book to your shelf.",
        ),
      );
      if (state.view !== "trash") {
        const action = node(
          "button",
          "btn primary",
          filtered
            ? "Clear filters"
            : books.length
              ? "Add a book"
              : "Add your first book",
        );
        action.addEventListener(
          "click",
          () => {
            if (filtered) {
              resetCollectionFilters();
              render();
            } else openBook(null, seriesDefaults());
          },
          { signal: events.signal },
        );
        empty.append(action);
      }
      $("bookList").append(empty);
    }
  }
  function seriesKey(book) {
    return String(book.series || "").trim() || "Untitled series";
  }
  function byVolume(a, b) {
    const av =
        a.volume === "" || a.volume === null ? Infinity : Number(a.volume),
      bv = b.volume === "" || b.volume === null ? Infinity : Number(b.volume);
    return av - bv || a.row - b.row;
  }
  function seriesRow(group) {
    const button = node("a", "series-row series-card");
    button.href = seriesPath(group.series);
    button.title = group.series;
    button.setAttribute(
      "aria-label",
      "Open " +
        group.series +
        ", " +
        group.books.length +
        (group.filtered ? " matching " : " owned ") +
        (group.books.length === 1 ? "volume" : "volumes"),
    );
    button.append(
      bookCover(shelfCoverBook(group.books), "shelf-cover series-cover"),
    );
    return bulkSelection.decorate(button, group.series);
  }
  function openSeries(series: string) {
    window.location.assign(seriesPath(series));
  }
  function seriesCatalogSpecs(series = state.selectedSeries) {
    const specs = new Map();
    state.data.books
      .filter((b) => seriesKey(b) === series)
      .forEach((b) => {
        const publisher = state.data.publishers.find(
          (p) => p.id === publisherKey(b.publisher),
        );
        if (!publisher) return;
        const spec = {
          series,
          publisherId: publisher.id,
          type: b.type || "",
          publisher,
        };
        specs.set(seriesCatalogKey(spec), spec);
      });
    return [...specs.values()];
  }
  function seriesCatalogKey(spec) {
    return JSON.stringify([spec.series, spec.publisherId, spec.type]);
  }
  async function loadSeriesCatalogs(
    refresh = false,
    series = state.selectedSeries,
  ) {
    if (series === null || !state.data) return;
    if (refresh) {
      state.catalogRefreshing = true;
      if ($("seriesReleaseError")) $("seriesReleaseError").hidden = true;
      renderSeriesMissing();
      try {
        await load();
      } catch (error) {
        errorAt(
          "seriesReleaseError",
          "Unable to refresh your shelf. Catalog comparisons use the previously loaded collection.",
        );
      }
    }
    try {
      await Promise.all(
        seriesCatalogSpecs(series).map(async (spec) => {
          const key = seriesCatalogKey(spec);
          if (
            state.catalogLoading.has(key) ||
            (!refresh && state.seriesCatalogs.has(key))
          )
            return;
          state.catalogLoading.add(key);
          renderSeriesMissing();
          try {
            state.seriesCatalogs.set(
              key,
              await rpc("getSeriesCatalog", {
                series: spec.series,
                publisherId: spec.publisherId,
                type: spec.type,
                refresh,
              }),
            );
            refreshVisibleCovers();
          } catch (error) {
            const old = state.seriesCatalogs.get(key);
            state.seriesCatalogs.set(key, {
              ...old,
              items: old?.items || [],
              complete: false,
              stale: true,
              error:
                "Unable to check this series catalog. Try Refresh catalog.",
            });
          } finally {
            state.catalogLoading.delete(key);
            renderSeriesMissing();
          }
        }),
      );
    } finally {
      if (refresh) state.catalogRefreshing = false;
      renderSeriesMissing();
    }
  }
  async function chooseSeriesCategory(spec) {
    const key = seriesCatalogKey(spec),
      feed = state.seriesCatalogs.get(key),
      editor = state.catalogEditors.get(key) || { version: 0 };
    editor.open = !editor.open;
    editor.version++;
    state.catalogEditors.set(key, editor);
    renderSeriesMissing();
    if (
      !editor.open ||
      editor.categories ||
      (["luckpim", "yaakz"] as const).includes(spec.publisherId)
    )
      return;
    editor.loading = true;
    editor.version++;
    renderSeriesMissing();
    try {
      const directory = feed?.categories
        ? { categories: feed.categories }
        : await rpc("getSeriesCategories", { publisherId: spec.publisherId });
      editor.categories = directory.categories;
    } catch (error) {
      editor.error = error.message || String(error);
    } finally {
      editor.loading = false;
      editor.version++;
      renderSeriesMissing();
    }
  }
  async function saveSeriesCategory(spec, url, title) {
    const key = seriesCatalogKey(spec),
      editor = state.catalogEditors.get(key);
    if (state.catalogLoading.has(key)) return;
    state.catalogLoading.add(key);
    if ($("seriesReleaseError")) $("seriesReleaseError").hidden = true;
    renderSeriesMissing();
    try {
      await rpc("setSeriesCatalog", {
        series: spec.series,
        publisherId: spec.publisherId,
        type: spec.type,
        url,
        title,
      });
      const catalog = await rpc("getSeriesCatalog", {
        series: spec.series,
        publisherId: spec.publisherId,
        type: spec.type,
        refresh: true,
      });
      state.seriesCatalogs.set(key, catalog);
      if (editor) {
        editor.open = false;
        editor.version++;
      }
      notify("Series catalog linked.");
    } catch (error) {
      errorAt("seriesReleaseError", error);
    } finally {
      state.catalogLoading.delete(key);
      renderSeriesMissing();
    }
  }

  function renderSeriesMissing() {
    const visible =
      state.view === "collection" && state.selectedSeries !== null;
    if (!$("seriesMissing")) return;
    $("seriesMissing").hidden = !visible;
    if (!visible) return;
    const owned = state.data.books.filter(
        (b) => seriesKey(b) === state.selectedSeries,
      ),
      editions = seriesGaps(owned);
    const gaps = editions.reduce((sum, e) => sum + e.missing, 0),
      specs = seriesCatalogSpecs(),
      catalogs = specs.map((spec) =>
        state.seriesCatalogs.get(seriesCatalogKey(spec)),
      );
    const pending =
        catalogs.some((feed) => !feed) ||
        specs.some((spec) => state.catalogLoading.has(seriesCatalogKey(spec))),
      choose = catalogs.some((feed) => feed?.needsSelection);
    const failed = catalogs.some(
      (feed) =>
        feed &&
        (feed.error || feed.stale || (!feed.complete && !feed.needsSelection)),
    );
    if (choose || failed) $("seriesCatalogDetails").open = true;
    const catalogItems = new Map();
    specs.forEach((spec) =>
      (state.seriesCatalogs.get(seriesCatalogKey(spec))?.items || []).forEach(
        (item) => {
          const same =
              matchingBookType(item.type) === matchingBookType(spec.type),
            uncertain =
              !item.type ||
              (!same && item.type.split(" (")[0] === spec.type.split(" (")[0]);
          if (!same && !uncertain) return;
          const previous = catalogItems.get(item.id);
          if (!previous || (previous.uncertain && same))
            catalogItems.set(item.id, {
              item: { ...item, catalogSeries: spec.series },
              uncertain:
                !item.type ||
                !same ||
                item.catalogVariant ||
                item.volume === "" ||
                item.volume === null,
            });
        },
      ),
    );
    const matches = [...catalogItems.values()]
      .map((entry) => ({ ...entry, match: releaseMatches(entry.item) }))
      .sort(
        (a, b) =>
          Number(a.item.volume || Infinity) -
            Number(b.item.volume || Infinity) ||
          a.item.title.localeCompare(b.item.title),
      );
    const missingVolumes = new Map();
    matches
      .filter(
        ({ item, match, uncertain }) =>
          !match.owned.length &&
          !match.possible.length &&
          releaseSingleVolume(item) &&
          !uncertain,
      )
      .forEach((entry) => {
        const key = JSON.stringify([
            entry.item.publisherId,
            matchingBookType(entry.item.type),
            entry.item.volume,
          ]),
          old = missingVolumes.get(key);
        if (old && old.item.special && !entry.item.special) {
          entry.alternatives = [old.item, ...old.alternatives];
          missingVolumes.set(key, entry);
        } else if (old) old.alternatives.push(entry.item);
        else missingVolumes.set(key, { ...entry, alternatives: [] });
      });
    const missing = [...missingVolumes.values()];
    const review = matches.filter(
      ({ item, match, uncertain }) =>
        !match.owned.length &&
        (match.possible.length || !releaseSingleVolume(item) || uncertain),
    );
    // Alternate listings of an owned volume belong in optional catalog details.
    const needsAttention = !!(
      gaps ||
      missing.length ||
      review.some(
        ({ item, match, uncertain }) =>
          !match.possible.length || !releaseSingleVolume(item) || uncertain,
      ) ||
      choose ||
      failed ||
      editions.some((edition) => !edition.highest) ||
      !$("seriesReleaseError").hidden
    );
    if (needsAttention) state.seriesDetailsExpanded = false;
    $("seriesMissing").hidden = !needsAttention && !state.seriesDetailsExpanded;
    $("seriesMissingTitle").textContent =
      gaps || missing.length
        ? "What you’re missing"
        : needsAttention
          ? "Check your collection"
          : "Catalog details";
    $("seriesCatalogToggle").hidden = needsAttention || !specs.length;
    $("seriesCatalogToggle").disabled = pending || state.catalogRefreshing;
    $("seriesCatalogToggle").textContent =
      pending || state.catalogRefreshing
        ? "Checking catalog…"
        : state.seriesDetailsExpanded
          ? "Hide catalog details"
          : "Catalog details";
    $("seriesCatalogToggle").setAttribute(
      "aria-expanded",
      String(state.seriesDetailsExpanded),
    );
    const catalogSummary = missing.length
      ? number(missing.length) +
        (missing.length === 1 ? " catalog volume" : " catalog volumes") +
        " not bought yet"
      : !specs.length
        ? "Catalog check unavailable"
        : pending
          ? "Checking series catalog…"
          : choose
            ? "Choose a series category"
            : failed
              ? "Catalog check incomplete"
              : review.length
                ? number(review.length) +
                  (review.length === 1 ? " edition" : " editions") +
                  " to check"
                : "No missing catalog volumes";
    $("seriesCatalogHeading").hidden = !specs.length;
    $("seriesCatalogDetails").hidden = !specs.length;
    $("seriesMissingSummary").textContent =
      number(gaps) +
      (gaps === 1 ? " gap" : " gaps") +
      " in your shelf" +
      (specs.length ? " · " + catalogSummary : "");
    $("seriesGaps").replaceChildren();
    editions.forEach((edition) => {
      const card = node("div", "missing-edition");
      card.append(
        node(
          "h3",
          "",
          [edition.type, edition.publisher].filter(Boolean).join(" · ") ||
            "Edition not recorded",
        ),
      );
      if (edition.missing) {
        card.append(
          node(
            "p",
            "hint",
            "Missing " +
              number(edition.missing) +
              (edition.missing === 1 ? " volume" : " volumes") +
              " through volume " +
              edition.highest,
          ),
        );
        const chips = node("div", "owned-volumes");
        edition.ranges.forEach(([from, to]) => {
          const add = node(
            "button",
            "btn missing-volume",
            "Vol. " + from + (to > from ? "–" + to : "") + " +",
          );
          add.disabled = state.busy;
          add.setAttribute(
            "aria-label",
            "Add missing volume " +
              from +
              " of " +
              state.selectedSeries +
              ", " +
              [edition.type, edition.publisher].filter(Boolean).join(", "),
          );
          add.addEventListener(
            "click",
            () => {
              openBook(null, { series: state.selectedSeries, volume: from });
              $("type").value = edition.type || "Other";
              $("publisher").value = edition.publisher || "";
              renderBookDetails();
            },
            { signal: events.signal },
          );
          chips.append(add);
        });
        card.append(chips);
      } else
        card.append(
          node(
            "p",
            "hint",
            edition.highest
              ? "No gaps through volume " + edition.highest
              : "No numbered sequence to check yet",
          ),
        );
      $("seriesGaps").append(card);
    });
    $("refreshSeriesReleases").hidden = !specs.length;
    $("refreshSeriesReleases").disabled = pending || state.catalogRefreshing;
    $("refreshSeriesReleases").textContent =
      pending || state.catalogRefreshing ? "Checking…" : "Refresh catalog";
    renderSeriesCatalogSources(specs);
    $("seriesReleaseStatus").textContent = !specs.length
      ? "Catalog checks are available for Phoenix Next, First Page Pro, Luckpim, Yaakz and Yen Press."
      : pending
        ? "Checking the publisher’s series catalog…"
        : choose
          ? "Choose the publisher’s category to check this series."
          : failed
            ? "Some category checks are incomplete or unavailable. Showing the listings we have."
            : missing.length
              ? number(missing.length) +
                (missing.length === 1
                  ? " catalog listing"
                  : " catalog listings") +
                " with no match on your shelf."
              : "No unmatched volumes in the checked series catalogs. Review other editions below.";
    const saved = new Set(
      (state.data.savedReleases || []).map((item) => item.id),
    );
    $("seriesReleaseList").replaceChildren();
    missing.forEach(({ item, alternatives }) =>
      $("seriesReleaseList").append(
        releaseCard(item, saved.has(item.id), { catalog: true, alternatives }),
      ),
    );
    $("seriesReleaseReview").hidden = !review.length;
    $("seriesReleaseReviewSummary").textContent =
      number(review.length) +
      (review.length === 1 ? " listing" : " listings") +
      " · Owned volumes, other editions & sets · Check the edition";
    $("seriesReleaseReviewList").replaceChildren();
    review.forEach(({ item }) =>
      $("seriesReleaseReviewList").append(
        releaseCard(item, saved.has(item.id), { catalog: true, review: true }),
      ),
    );
  }
  function renderSeriesCatalogSources(specs) {
    const container = $("seriesReleaseSources");
    specs.forEach((spec, index) => {
      const key = seriesCatalogKey(spec),
        feed = state.seriesCatalogs.get(key),
        editor = state.catalogEditors.get(key),
        loading = state.catalogLoading.has(key) || state.busy,
        old = container.children[index];
      if (
        old?._catalogKey === key &&
        old._feed === feed &&
        old._loading === loading &&
        old._editorVersion === (editor?.version || 0)
      )
        return;
      const card = seriesCatalogSource(spec);
      card._catalogKey = key;
      card._feed = feed;
      card._loading = loading;
      card._editorVersion = state.catalogEditors.get(key)?.version || 0;
      if (old) container.replaceChild(card, old);
      else container.append(card);
    });
    while (container.children.length > specs.length)
      container.lastElementChild.remove();
  }
  function seriesCatalogSource(spec) {
    const key = seriesCatalogKey(spec),
      feed = state.seriesCatalogs.get(key),
      card = node("div", "publisher-source catalog-source"),
      busy = state.catalogLoading.has(key) || state.busy;
    card.append(node("h3", "", spec.publisher.name + " · " + spec.type));
    if (!feed) {
      card.append(node("p", "hint", "Finding the series catalog…"));
      return card;
    }
    if (feed.url)
      card.append(releaseLink((feed.title || spec.series) + " ↗", feed.url));
    const stamp = feed.example
      ? "Preview sample · not a live check"
      : feed.checkedAt
        ? (feed.stale ? "Previous check " : "Checked ") +
          new Date(feed.checkedAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Not checked yet";
    card.append(node("p", "hint", stamp));
    if (feed.checkedAt)
      card.append(
        node(
          "p",
          "hint",
          number(feed.items.length) +
            " listings · " +
            (feed.complete
              ? "All category pages checked"
              : "Category check incomplete"),
        ),
      );
    if (feed.search)
      card.append(node("p", "hint", "Full publisher title search"));
    if (feed.error) card.append(node("p", "source-error", feed.error));
    let editor = state.catalogEditors.get(key);
    if (!editor) {
      editor = {
        version: 0,
        open: !!feed.needsSelection,
        categories: feed.categories,
      };
      state.catalogEditors.set(key, editor);
    }
    const searchBased = (["luckpim", "yaakz"] as const).includes(
      spec.publisherId,
    );
    const toggle = node(
      "button",
      "text-btn",
      searchBased
        ? "Change search title"
        : editor.open
          ? "Hide category choices"
          : "Choose series category",
    );
    toggle.disabled = busy;
    toggle.setAttribute("aria-expanded", String(!!editor.open));
    toggle.addEventListener("click", () => void chooseSeriesCategory(spec), {
      signal: events.signal,
    });
    card.append(toggle);
    if (!editor.open) return card;
    const form = node("form", "catalog-editor");
    form.setAttribute(
      "aria-label",
      "Link " + spec.publisher.name + " catalog for " + spec.type,
    );
    let selected, manual, search;
    const field = (label, input) => {
      const wrapper = node("label", "field");
      wrapper.append(node("span", "", label), input);
      form.append(wrapper);
    };
    if (searchBased) {
      manual = node("input");
      manual.type = "text";
      manual.required = true;
      manual.maxLength = 500;
      manual.value =
        editor.url ??
        (feed.url
          ? new URL(feed.url).searchParams.get(
              spec.publisherId === "yaakz" ? "q" : "k",
            )
          : spec.series);
      field(
        "Series title on " +
          (spec.publisherId === "yaakz" ? "Yaakz" : "Luckpim"),
        manual,
      );
      manual.addEventListener("input", () => (editor.url = manual.value), {
        signal: events.signal,
      });
    } else {
      search = node("input");
      search.type = "search";
      search.placeholder = "Find a series category…";
      search.value = editor.search || "";
      field("Find the publisher’s series name", search);
      selected = node("select");
      field("Series category", selected);
      const options = () => {
        selected.replaceChildren(node("option", "", "Choose a category…"));
        selected.firstElementChild.value = "";
        const query = search.value.trim().toLocaleLowerCase();
        (editor.categories || [])
          .filter(
            (c) =>
              (!c.type ||
                !spec.type ||
                c.type.split(" (")[0] === spec.type.split(" (")[0]) &&
              (!query ||
                [c.title, c.url].join(" ").toLocaleLowerCase().includes(query)),
          )
          .forEach((c) => {
            const option = node(
              "option",
              "",
              c.title + (c.type ? " · " + c.type : ""),
            );
            option.value = c.url;
            selected.append(option);
          });
        selected.value = editor.selected || "";
      };
      options();
      search.addEventListener(
        "input",
        () => {
          editor.search = search.value;
          options();
        },
        { signal: events.signal },
      );
      selected.addEventListener(
        "change",
        () => {
          editor.selected = selected.value;
          manual.value = "";
          editor.url = "";
        },
        { signal: events.signal },
      );
      manual = node("input");
      manual.type = "url";
      manual.placeholder =
        spec.publisherId === "phoenix"
          ? "https://www.phoenixnext.com/book-series/…"
          : spec.publisherId === "yenpress"
            ? "https://yenpress.com/series/…"
            : "https://www.firstpagepro.com/category/…";
      manual.value = editor.url || "";
      field("Or paste the series category URL", manual);
      manual.addEventListener(
        "input",
        () => {
          editor.url = manual.value;
          editor.selected = "";
          selected.value = "";
        },
        { signal: events.signal },
      );
      if (editor.loading) form.append(node("p", "hint", "Loading categories…"));
      if (editor.error) form.append(node("p", "source-error", editor.error));
    }
    const submit = node("button", "btn", "Use this catalog");
    submit.type = "submit";
    submit.disabled = busy || editor.loading;
    form.append(submit);
    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const url = searchBased
          ? (spec.publisherId === "yaakz"
              ? "https://www.yaakz.com/search?q="
              : "https://www.luckpim.com/search_result?k=") +
            encodeURIComponent(manual.value.trim())
          : manual.value.trim() || selected.value;
        if (!url) {
          errorAt(
            "seriesReleaseError",
            "Choose a series category or paste its URL.",
          );
          return;
        }
        void saveSeriesCategory(
          spec,
          url,
          searchBased
            ? manual.value.trim()
            : editor.categories?.find((c) => c.url === selected.value)?.title ||
                spec.series,
        );
      },
      { signal: events.signal },
    );
    card.append(form);
    return card;
  }
  function seriesDefaults(series = state.selectedSeries) {
    if (series === null) return undefined;
    const key = String(series).trim().toLocaleLowerCase();
    const owned = state.data.books
      .filter((b) => seriesKey(b).toLocaleLowerCase() === key)
      .sort(
        (a, b) =>
          String(b.date || "").localeCompare(String(a.date || "")) ||
          b.row - a.row,
      );
    if (!owned.length) return undefined;
    const defaults = { series: seriesKey(owned[0]) };
    let edition = owned;
    (["type", "publisher"] as const).forEach((k) => {
      defaults[k] = edition.find((b) => String(b[k] ?? "").trim())?.[k] || "";
      if (defaults[k]) edition = edition.filter((b) => b[k] === defaults[k]);
    });
    return defaults;
  }
  function titleEditions(series) {
    const editions = new Map();
    state.data.books
      .filter((book) => seriesKey(book) === series)
      .forEach((book) => {
        const key = JSON.stringify([book.type, book.publisher]);
        if (!editions.has(key))
          editions.set(key, {
            key,
            type: book.type,
            publisher: book.publisher,
            books: [],
          });
        editions.get(key).books.push(book);
      });
    return [...editions.values()];
  }
  function openTitle() {
    if (state.busy || !state.selectedSeries) return;
    const title = state.data.titles.find(
      (entry) => entry.series === state.selectedSeries,
    );
    if (!title) return;
    state.editingTitle = { ...title, editions: titleEditions(title.series) };
    state.pendingTitle = null;
    $("titleError").hidden = true;
    $("titleSeries").value = title.series;
    $("titleEditions").replaceChildren();
    state.editingTitle.editions.forEach((edition, index) => {
      const group = node("fieldset", "title-entry"),
        grid = node("div", "form-grid");
      group.append(node("legend", "", "Edition " + (index + 1)));
      const type = node("select"),
        publisher = node("input");
      type.id = "titleEditionType" + index;
      type.required = true;
      [...new Set([...state.data.options.type, edition.type])]
        .filter(Boolean)
        .forEach((value) => {
          const option = node("option", "", value);
          option.value = value;
          type.append(option);
        });
      type.value = edition.type;
      publisher.id = "titleEditionPublisher" + index;
      publisher.value = edition.publisher;
      publisher.maxLength = 500;
      publisher.setAttribute("list", "publisherOptions");
      for (const [label, input] of [
        ["Type *", type],
        ["Publisher", publisher],
      ] as const) {
        const field = node("div", "field"),
          caption = node("label", "", label);
        caption.htmlFor = input.id;
        field.append(caption, input);
        grid.append(field);
      }
      group.append(
        grid,
        node(
          "p",
          "hint",
          edition.books.length +
            " owned " +
            (edition.books.length === 1 ? "volume" : "volumes"),
        ),
      );
      $("titleEditions").append(group);
    });
    $("titleSaveHint").textContent =
      "Changes apply to all " +
      state.editingTitle.editions.reduce(
        (count, edition) => count + edition.books.length,
        0,
      ) +
      " owned volumes in this title.";
    $("titleDialog").showModal();
    $("titleSeries").focus();
  }
  function closeTitle() {
    if (state.busy) return;
    $("titleDialog").close();
    state.editingTitle = null;
  }
  async function saveTitle(event) {
    event.preventDefault();
    if (state.busy || !state.editingTitle || !$("titleForm").reportValidity())
      return;
    const content = {
      series: state.editingTitle.series,
      token: state.editingTitle.token,
      title: {
        series: $("titleSeries").value,
        editions: state.editingTitle.editions.map((edition, index) => ({
          originalType: edition.type,
          originalPublisher: edition.publisher,
          type: (
            document.getElementById(
              "titleEditionType" + index,
            ) as HTMLSelectElement
          ).value,
          publisher: (
            document.getElementById(
              "titleEditionPublisher" + index,
            ) as HTMLInputElement
          ).value,
        })),
      },
    };
    const key = JSON.stringify(content);
    if (state.pendingTitle?.key !== key)
      state.pendingTitle = {
        key,
        request: { ...content, requestId: requestId() },
      };
    $("titleError").hidden = true;
    setBusy(true);
    $("saveTitleButton").textContent = "Saving…";
    try {
      const result = await rpc("saveTitle", state.pendingTitle.request);
      $("titleDialog").close();
      state.editingTitle = null;
      state.pendingTitle = null;
      if (result.series !== state.selectedSeries) {
        window.location.replace(seriesPath(result.series));
        return;
      }
      state.seriesCatalogs.clear();
      state.catalogEditors.clear();
      resetCollectionFilters();
      notify("Title details saved for " + result.volumes + " owned volumes.");
      try {
        await load();
      } catch {
        errorAt(
          "pageError",
          "Title details were saved, but the list could not refresh. Press Refresh.",
        );
      }
    } catch (error) {
      errorAt("titleError", error);
    } finally {
      setBusy(false);
      $("saveTitleButton").textContent = "Save title details";
    }
  }
  function syncSeriesSelection() {
    if (state.editing) {
      renderBookDetails();
      return;
    }
    const defaults = seriesDefaults($("series").value),
      series = defaults?.series || null;
    if (series !== state.formSeries) {
      if (!state.formSeries)
        state.sharedDraft = Object.fromEntries(
          (["type", "publisher"] as const).map((k) => [k, $(k).value]),
        );
      (["type", "publisher"] as const).forEach(
        (k) =>
          ($(k).value = series
            ? defaults[k] || (k === "type" ? "Manga (TH)" : "")
            : state.sharedDraft[k]),
      );
      state.formSeries = series;
      state.newEdition = false;
      state.detailsExpanded = false;
      $("priceCalculator").open =
        (!series && !window.matchMedia("(max-width: 560px)").matches) ||
        $("regularPrice").value !== "" ||
        $("discount").value !== "";
    }
    renderBookDetails();
  }
  function renderBookDetails() {
    const quick = !!state.formSeries && !state.editing;
    const matched = state.lookupMatched && !state.editing;
    $("bookForm").classList.toggle(
      "lookup-complete",
      matched && !state.lookupDetailsExpanded,
    );
    $("toggleLookupDetails").hidden = !matched;
    $("toggleLookupDetails").textContent = state.lookupDetailsExpanded
      ? "Hide book details"
      : "Edit book details";
    $("toggleLookupDetails").setAttribute(
      "aria-expanded",
      String(state.lookupDetailsExpanded),
    );
    const editions = state.formSeries ? titleEditions(state.formSeries) : [];
    const editionKey = JSON.stringify([$("type").value, $("publisher").value]);
    const inherited =
      editions.some((edition) => edition.key === editionKey) &&
      !state.newEdition;
    const titleFields = !state.editing && !inherited;
    $("titleNameField").hidden = state.titleLocked;
    $("titleEntry").hidden = state.titleLocked && !titleFields;
    $("bookForm")
      .querySelectorAll<HTMLElement>("[data-title-field]")
      .forEach((field) => (field.hidden = !titleFields));
    $("bookEdition").replaceChildren();
    editions.forEach((edition) => {
      const option = node(
        "option",
        "",
        [edition.type, edition.publisher || "No publisher"].join(" · "),
      );
      option.value = edition.key;
      $("bookEdition").append(option);
    });
    if (!state.editing) {
      const option = node("option", "", "Add another edition…");
      option.value = "new";
      $("bookEdition").append(option);
    }
    $("bookEdition").value = inherited ? editionKey : "new";
    $("editionField").hidden =
      !state.formSeries || (state.editing && editions.length < 2);
    $("bookForm")
      .querySelectorAll<HTMLElement>("[data-series-detail]")
      .forEach(
        (e) =>
          (e.hidden =
            quick && !state.detailsExpanded && !state.lookupDetailsExpanded),
      );
    $("seriesDefaults").hidden = !state.formSeries;
    $("seriesDefaultsText").textContent =
      state.formSeries +
      " · " +
      [$("type").value, $("publisher").value].filter(Boolean).join(" · ");
    $("toggleBookDetails").textContent = state.detailsExpanded
      ? "Hide other volume details"
      : "Edit other volume details";
    $("toggleBookDetails").hidden = !!state.editing || matched;
    $("toggleBookDetails").setAttribute(
      "aria-expanded",
      String(!!state.detailsExpanded),
    );
    $("bookDialogSubtitle").textContent = state.editing
      ? "Edit this volume’s ISBN, reading status and purchase details."
      : matched
        ? "Book found. Add where you bought it and what you paid."
        : quick
          ? "Title details are filled in. Add your volume below."
          : "Scan a book or enter the details below.";
    $("keepAddingText").textContent = quick
      ? "Add another volume after saving"
      : "Add another book after saving";
    $("saveButton").textContent = state.editing
      ? "Save changes"
      : quick
        ? "Add volume"
        : "Add book";
  }
  function bookRow(entry) {
    if (state.view === "collection") {
      const book = entry.book;
      const label =
        book.series + (book.volume !== "" ? ", volume " + book.volume : "");
      const button = node("button", "book-row book-card");
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", "Edit " + label);
      button.setAttribute("aria-haspopup", "dialog");
      button.disabled = state.busy;
      button.append(bookCover(book, "shelf-cover volume-cover"));
      bulkSelection.decorate(button, String(book.row));
      button.addEventListener("click", () => openBook(book), {
        signal: events.signal,
      });
      return button;
    }
    const b = entry.book,
      row = node("article", "book-row");
    row.title = b.series + (b.volume !== "" ? ", volume " + b.volume : "");
    row.tabIndex = 0;
    row.setAttribute("aria-label", row.title);
    bulkSelection.decorate(row, String(b.row));
    const details = node("div", "book-info"),
      info = node("div", "book-copy");
    info.append(node("h2", "book-title", b.series || "Untitled book"));
    const meta = node("div", "book-meta");
    [
      b.volume !== "" && b.volume !== null ? "Vol. " + b.volume : "",
      b.type,
      b.publisher,
      b.isbn ? "ISBN " + b.isbn : b.source,
    ]
      .filter(Boolean)
      .forEach((t) => meta.append(node("span", "", t)));
    info.append(meta);
    details.append(bookCover(b, "shelf-cover"), info);
    row.append(details);
    const statusWrap = node("div", "book-status");
    statusWrap.append(
      node(
        "span",
        "status" +
          (b.status === "Read"
            ? " read"
            : b.status === "Reading"
              ? " reading"
              : ""),
        b.status || "No status",
      ),
    );
    row.append(statusWrap);
    const restore = node("button", "btn restore", "Restore book");
    restore.disabled = state.busy;
    restore.addEventListener("click", () => restoreEntry(entry, restore), {
      signal: events.signal,
    });
    row.append(restore);
    return row;
  }
  function releaseMatches(item) {
    return matchRelease(item, state.data.books);
  }
  async function loadReleases(refresh = false) {
    if (!state.data || state.releasesLoading) return;
    state.releasesLoading = true;
    if (refresh) publisherIsbnSearch.clear();
    if ($("releaseError")) $("releaseError").hidden = true;
    if ($("seriesReleaseError")) $("seriesReleaseError").hidden = true;
    renderReleases();
    try {
      if (refresh) {
        try {
          await load();
        } catch (error) {
          const message =
            "Unable to refresh your shelf. Ownership labels use the previously loaded collection.";
          errorAt("releaseError", message);
          errorAt("seriesReleaseError", message);
        }
      }
      await Promise.all(
        state.data.publishers.map(async (publisher) => {
          try {
            state.releaseFeeds.set(
              publisher.id,
              await rpc("getPublisherReleases", {
                publisherId: publisher.id,
                refresh,
              }),
            );
          } catch (error) {
            const old = state.releaseFeeds.get(publisher.id);
            state.releaseFeeds.set(publisher.id, {
              publisherId: publisher.id,
              items: old?.items || [],
              checkedAt: old?.checkedAt || "",
              stale: true,
              error:
                "Unable to check " + publisher.name + ". Try Refresh releases.",
            });
          }
          renderReleases();
        }),
      );
    } finally {
      state.releasesLoading = false;
      state.releasesLoaded = true;
      renderReleases();
    }
  }
  function releaseItems() {
    const items = new Map();
    (state.data.savedReleases || []).forEach((item) =>
      items.set(item.id, item),
    );
    state.releaseFeeds.forEach((feed) =>
      feed.items.forEach((item) => items.set(item.id, item)),
    );
    return [...items.values()];
  }
  function releaseLink(label, url) {
    const a = node("a", "", label);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  function coverImage(id, title, className) {
    const frame = node("span", "cover-frame " + className);
    setCoverImage(frame, id, title);
    return frame;
  }
  function setCoverImage(
    frame: Element & { _coverId?: string },
    id: string,
    title: string,
  ) {
    if (frame._coverId === (id || "")) return;
    frame._coverId = id || "";
    frame.replaceChildren();
    const placeholder = node("span", "cover-placeholder");
    const galleryTitle = frame.matches(".series-cover, .volume-cover")
      ? frame.closest<HTMLElement>(".series-card, .book-card")?.title || title
      : null;
    placeholder.dataset.tint = coverTint(String(galleryTitle || title));
    placeholder.setAttribute("aria-label", "No cover available");
    placeholder.append(node("span", "placeholder-label", "No cover"));
    placeholder.prepend(icon("books"));
    if (galleryTitle)
      placeholder.insertBefore(
        node("span", "placeholder-title", galleryTitle),
        placeholder.lastChild,
      );
    frame.append(placeholder);
    if (!/^[a-f0-9]{64}$/.test(id || "")) return;
    const img = node("img");
    img.alt = title + " cover";
    img.width = 264;
    img.height = 370;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    let failed = false;
    img.addEventListener(
      "load",
      () => {
        if (!failed) placeholder.hidden = true;
      },
      { signal: events.signal },
    );
    img.addEventListener(
      "error",
      () => {
        failed = true;
        img.remove();
        placeholder.hidden = false;
      },
      { signal: events.signal },
    );
    img.src = "/api/covers/" + id;
    frame.append(img);
  }
  function bookPublisherUrl(book) {
    if (book.publisherUrl) return book.publisherUrl;
    const id = publisherKey(book.publisher);
    const items = [
      ...state.seriesCatalogs.values(),
      ...state.releaseFeeds.values(),
    ].flatMap((feed) => feed.items || []);
    const match = items.find(
      (item) =>
        !item.bundle &&
        !item.special &&
        item.publisherId === id &&
        ((canonical(book.isbn) &&
          canonical(item.isbn) === canonical(book.isbn)) ||
          (book.volume !== "" &&
            item.volume !== "" &&
            Number(item.volume) === Number(book.volume) &&
            matchingBookType(item.type) === matchingBookType(book.type) &&
            releaseSeriesKey(item.catalogSeries || item.series) ===
              releaseSeriesKey(book.series))),
    );
    return (
      match?.url || state.data.publishers.find((p) => p.id === id)?.url || ""
    );
  }

  function renderMetadataCover() {
    $("metadataCoverPreview").replaceChildren(
      coverImage(state.selectedCoverId, $("series").value, "metadata-cover"),
    );
    const link = $("metadataPublisherLink");
    const url =
      $("publisherUrl").value.trim() ||
      (state.editing
        ? bookPublisherUrl({ ...state.editing, publisherUrl: "" })
        : "");
    const hosts = {
      phoenix: "www.phoenixnext.com",
      firstpage: "www.firstpagepro.com",
      luckpim: "www.luckpim.com",
      yaakz: "www.yaakz.com",
    };
    let safe = false;
    try {
      const parsed = new URL(url);
      safe =
        parsed.protocol === "https:" &&
        (!hosts[publisherKey($("publisher").value)] ||
          parsed.hostname === hosts[publisherKey($("publisher").value)]) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port;
    } catch {}
    link.hidden = !safe;
    if (safe) link.href = url;
    else link.removeAttribute("href");
    document
      .querySelectorAll<HTMLElement>(".cover-choice")
      .forEach((choice) => {
        choice.setAttribute(
          "aria-pressed",
          String(choice.dataset.coverId === state.selectedCoverId),
        );
      });
  }

  async function pullPublisherCovers() {
    if (!state.editing || state.busy) return;
    const generation = ++state.coverPickerGeneration;
    const book = state.editing;
    const draft = JSON.stringify([
      $("series").value,
      $("volume").value,
      $("type").value,
      $("publisher").value,
    ]);
    if (
      draft !==
      JSON.stringify([
        book.series,
        String(book.volume),
        book.type,
        book.publisher,
      ])
    ) {
      $("publisherCoversStatus").textContent =
        "Save your metadata changes before pulling covers for this volume.";
      return;
    }
    $("pullPublisherCovers").disabled = true;
    $("publisherCoversStatus").textContent =
      "Looking for covers from publishers and bookstores…";
    $("publisherCoverChoices").replaceChildren();
    try {
      const result = await rpc("getBookCoverOptions", {
        row: book.row,
        publisherUrl: $("publisherUrl").value.trim(),
      });
      if (generation !== state.coverPickerGeneration || !$("bookDialog").open)
        return;
      result.covers.forEach((item, index) => {
        const choice = node("button", "cover-choice");
        choice.type = "button";
        choice.dataset.coverId = item.coverId;
        choice.setAttribute(
          "aria-label",
          "Choose cover " + (index + 1) + ": " + item.title,
        );
        choice.append(
          coverImage(item.coverId, item.title, "metadata-cover"),
          node("span", "", (item.source || "Cover") + " · " + (index + 1)),
        );
        choice.addEventListener(
          "click",
          () => {
            if (state.busy) return;
            state.selectedCoverId = item.coverId;
            $("coverUrl").value = item.coverUrl;
            if (item.publisherUrl) $("publisherUrl").value = item.publisherUrl;
            renderMetadataCover();
          },
          { signal: events.signal },
        );
        $("publisherCoverChoices").append(choice);
      });
      $("publisherCoversStatus").textContent =
        (result.covers.length
          ? result.covers.length + " covers available."
          : "No covers found. Add an ISBN or this volume’s publisher page and try again.") +
        " " +
        result.warnings.join(" ");
      renderMetadataCover();
    } catch (error) {
      if (generation === state.coverPickerGeneration)
        $("publisherCoversStatus").textContent = error.message;
    } finally {
      if (generation === state.coverPickerGeneration)
        $("pullPublisherCovers").disabled = state.busy;
    }
  }
  const coverObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        coverObserver.unobserve(entry.target);
        const book = entry.target._book;
        if (book.coverId) continue;
        void rpc("getBookCover", { row: book.row })
          .then((result) => {
            book.coverId = result.coverId || "";
            refreshVisibleCovers();
          })
          .catch(() => {});
      }
    },
    { rootMargin: "100px" },
  );
  function bookCover(book, className) {
    const title = className.includes("series-cover")
      ? seriesKey(book)
      : book.series + (book.volume !== "" ? ", volume " + book.volume : "");
    const frame = coverImage(book.coverId, title, className);
    frame._book = book;
    if (!book.coverId) coverObserver.observe(frame);
    return frame;
  }
  function refreshVisibleCovers() {
    document.querySelectorAll(".shelf-cover").forEach((frame) => {
      const book = frame._book;
      if (book)
        setCoverImage(
          frame,
          book.coverId,
          frame.classList.contains("series-cover")
            ? seriesKey(book)
            : book.series +
                (book.volume !== "" ? ", volume " + book.volume : ""),
        );
    });
  }

  async function loadDiscovery(refresh = false) {
    if (!state.data || state.discoveryLoading) return;
    const url = $("discoveryUrl").value.trim();
    state.discoveryUrl = url;
    state.discoveryLoading = true;
    if (refresh) publisherIsbnSearch.clear();
    if ($("discoveryError")) $("discoveryError").hidden = true;
    renderDiscovery();
    try {
      if (refresh) await load();
      const feed = await rpc("getPublisherDirectory", { url, refresh });
      if (refresh) {
        state.titleGeneration++;
        state.discoveryTitleResults.clear();
        state.titleQueue = [];
      }
      state.discoveryRefresh = refresh;
      state.discoveryFeeds.set(url, feed);
      refreshVisibleCovers();
    } catch (error) {
      errorAt("discoveryError", error);
    } finally {
      state.discoveryLoading = false;
      renderDiscovery();
    }
  }
  function discoveryTitles(
    items: (import("../types").Release & {
      discoveryId: string;
      resolved?: boolean;
      categories?: { url: string }[];
    })[],
  ) {
    return discoverTitles(items, state.data.books, state.data.seriesCatalogs);
  }

  function discoveryTitleKey(item) {
    return JSON.stringify(
      item.categories.map((category) => category.url).sort(),
    );
  }
  const titleObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        titleObserver.unobserve(entry.target);
        const item = entry.target._title,
          key = discoveryTitleKey(item);
        if (state.discoveryTitleResults.has(key)) continue;
        state.discoveryTitleResults.set(key, { loading: true });
        state.titleQueue.push({
          item,
          key,
          refresh: state.discoveryRefresh,
          generation: state.titleGeneration,
        });
      }
      void fetchQueuedTitles();
    },
    { rootMargin: "150px" },
  );
  async function fetchQueuedTitles() {
    while (state.titleRequests < 3 && state.titleQueue.length) {
      const { item, key, refresh, generation } = state.titleQueue.shift();
      state.titleRequests++;
      void rpc("getPublisherTitle", {
        publisherId: item.publisherId,
        categories: item.categories,
        series: item.series,
        refresh,
      })
        .then((result) => {
          if (generation === state.titleGeneration)
            state.discoveryTitleResults.set(key, result);
        })
        .catch(() => {
          if (generation === state.titleGeneration)
            state.discoveryTitleResults.set(key, {
              error:
                "Cover unavailable. Open the publisher category or refresh to try again.",
            });
        })
        .finally(() => {
          state.titleRequests--;
          renderDiscovery();
          void fetchQueuedTitles();
        });
    }
  }
  function renderDiscovery() {
    if (!state.data || !$("discoverPanel")) return;
    const feed = state.discoveryFeeds.get(state.discoveryUrl);
    $("refreshDiscovery").disabled = state.discoveryLoading;
    $("loadDiscovery").disabled = state.discoveryLoading;
    $("discoveryPreset").disabled = state.discoveryLoading;
    $("discoveryUrl").disabled = state.discoveryLoading;
    $("refreshDiscovery").textContent = state.discoveryLoading
      ? "Checking category…"
      : "Refresh titles";
    const source = $("discoverySource");
    source.replaceChildren();
    if (feed) {
      source.append(
        releaseLink((feed.title || "Publisher category") + " ↗", feed.url),
      );
      if (feed.checkedAt)
        source.append(
          node(
            "p",
            "hint",
            (feed.stale ? "Previous check " : "Checked ") +
              new Date(feed.checkedAt).toLocaleString() +
              " · " +
              number(
                feed.titles?.length ??
                  new Set(
                    (feed.items || []).map((item) =>
                      releaseSeriesKey(item.series),
                    ),
                  ).size,
              ) +
              " titles from the publisher catalog",
          ),
        );
      if (feed.error) source.append(node("p", "source-error", feed.error));
    }
    const publisherId = state.discoveryUrl.startsWith(
      "https://www.phoenixnext.com/",
    )
      ? "phoenix"
      : state.discoveryUrl.startsWith("https://www.firstpagepro.com/")
        ? "firstpage"
        : "";
    const isbnSearch = publisherIsbnSearch.get(
      publisherId,
      $("discoverySearch").value,
    );
    if (isbnSearch) {
      renderPublisherIsbnResults(
        isbnSearch,
        "discovery",
        $("discoveryType").value,
      );
      return;
    }
    const all = discoveryTitles(
      (
        feed?.titles ||
        (feed?.items || []).map((item) => ({
          ...item,
          resolved: true,
          categories: [{ url: feed.url, type: item.type }],
        }))
      ).flatMap((entry) => {
        const result = state.discoveryTitleResults.get(
          discoveryTitleKey(entry),
        );
        if (
          ["phoenix", "firstpage", "yenpress"].includes(entry.publisherId) &&
          result?.complete &&
          !result.stale &&
          result.item === null
        )
          return [];
        return [
          {
            ...(result?.item
              ? {
                  ...result.item,
                  categories: entry.categories,
                  series: entry.series,
                  catalogSeries: entry.series,
                  directory: true,
                  resolved: true,
                  categoryUrl: entry.url,
                }
              : entry),
            discoveryId: entry.id,
          },
        ];
      }),
    );
    const query = $("discoverySearch").value.trim().toLocaleLowerCase(),
      type = $("discoveryType").value;
    const items = all.filter(
      (item) =>
        (!query || item.series.toLocaleLowerCase().includes(query)) &&
        (!type ||
          // Untyped directory entries need to load their first-volume metadata.
          (!item.resolved && !item.type) ||
          String(item.type || "").startsWith(type)),
    );
    $("discoveryCount").textContent = state.discoveryLoading
      ? "Reading the publisher category…"
      : number(items.length) +
        (items.length === 1 ? " title" : " titles") +
        " you haven’t started";
    const list = $("discoveryList");
    const saved = new Set(
      (state.data.savedReleases || []).map((item) => item.id),
    );
    discoveryList.render(items, (item) => discoveryCard(item, saved), {
      key: JSON.stringify([state.discoveryUrl, query, type]),
      label: "titles",
      itemKey: (item) => item.discoveryId,
      updateItem: (card, item) => discoveryCardUpdates.get(card)(item, saved),
    });
    if (!items.length) {
      const empty = node(
        "div",
        state.discoveryLoading ? "empty is-loading" : "empty",
      );
      empty.append(
        node(
          "h2",
          "",
          state.discoveryLoading
            ? "Finding your next series…"
            : !feed || feed.stale
              ? "Load a publisher category"
              : query || type
                ? "No titles match these filters"
                : "No new titles in this category",
        ),
        node(
          "p",
          "",
          state.discoveryLoading
            ? "Checking category pages for titles and first volumes."
            : "Try another category or adjust your filters. Titles already on your shelf are hidden.",
        ),
      );
      list.append(empty);
    }
  }
  function renderPublisherIsbnResults(
    result: ReturnType<typeof publisherIsbnSearch.get>,
    panel: "discovery" | "release",
    type: string,
  ) {
    const list = panel === "discovery" ? discoveryList : releaseList;
    const element =
      panel === "discovery" ? $("discoveryList") : $("releaseList");
    const count =
      panel === "discovery" ? $("discoveryCount") : $("releaseResultCount");
    const items = result.items.filter(
      (item) => !type || item.type.startsWith(type),
    );
    const saved = new Set(state.data.savedReleases.map((item) => item.id));
    count.textContent = result.loading
      ? "Searching the publisher for ISBN " + result.isbn + "…"
      : `${number(items.length)} ${items.length === 1 ? "book" : "books"} for ISBN ${result.isbn}`;
    list.render(
      items,
      (item) =>
        releaseCard(
          {
            ...item,
            ...(result.publisherId === "firstpage"
              ? { searchedIsbn: result.isbn }
              : {}),
          },
          saved.has(item.id),
        ),
      {
        key: "isbn:" + result.publisherId + ":" + result.isbn + ":" + type,
        label: "books",
      },
    );
    const status = node("div", "publisher-isbn-status");
    if (result.error) {
      const error = node("p", "source-error", result.error);
      error.setAttribute("role", "alert");
      status.append(error);
    }
    for (const warning of result.warnings || [])
      status.append(node("p", "hint", warning));
    if (!result.loading && !result.error && !items.length)
      status.append(
        node(
          "p",
          "hint",
          "No matching books found. Try another ISBN or change the type filter.",
        ),
      );
    if (result.url)
      status.append(releaseLink("Open publisher ISBN search ↗", result.url));
    element.prepend(status);
  }
  function discoveryCard(item, saved: Set<string>) {
    const card = node("article", "discovery-card");
    const coverLink = releaseLink("", item.url);
    const cover = coverImage(item.coverId, item.title, "discovery-cover");
    coverLink.append(cover);
    const copy = node("div", "publisher-copy");
    const publisher = node("p", "eyebrow");
    const title = node("h2", "book-title");
    const meta = node("p", "release-meta");
    const error = node("p", "source-error");
    const publisherLink = releaseLink("", item.url);
    copy.append(publisher, title, meta, error, publisherLink);
    const actions = node("div", "buttons");
    const saveButton = node("button", "btn");
    let currentItem = item;
    let currentSaved = saved;
    saveButton.addEventListener(
      "click",
      () => void saveRelease(currentItem, !currentSaved.has(currentItem.id)),
      { signal: events.signal },
    );
    const add = node("button", "btn", "Add to shelf");
    add.addEventListener(
      "click",
      () => openRelease(currentItem, releaseMatches(currentItem)),
      { signal: events.signal },
    );
    actions.append(saveButton, add);
    card.append(coverLink, copy, actions);

    const update = (nextItem, nextSaved: Set<string>) => {
      currentItem = nextItem;
      currentSaved = nextSaved;
      const result = state.discoveryTitleResults.get(
        discoveryTitleKey(nextItem),
      );
      card._title = nextItem;
      if (!nextItem.resolved && !result) titleObserver.observe(card);
      else titleObserver.unobserve(card);
      coverLink.href = publisherLink.href = nextItem.url;
      coverLink.setAttribute(
        "aria-label",
        "Open " + nextItem.series + " on the publisher website",
      );
      // Keep the previous cover while refreshed title metadata is loading.
      if (nextItem.resolved || nextItem.coverId)
        setCoverImage(cover, nextItem.coverId, nextItem.title);
      publisher.textContent = nextItem.publisher;
      title.textContent = nextItem.series;
      meta.textContent = !nextItem.resolved
        ? result && !result.loading
          ? result.complete && !result.item
            ? "No current book listing"
            : "Cover unavailable"
          : "Loading first-volume cover…"
        : [
            nextItem.type,
            nextItem.bundle
              ? "Set listing"
              : nextItem.volume === ""
                ? "Single book / unnumbered"
                : "Volume " + nextItem.volume,
            nextItem.volume !== 1 && nextItem.volume !== ""
              ? "Volume 1 not listed"
              : "",
            nextItem.special ? "Special edition" : "",
          ]
            .filter(Boolean)
            .join(" · ");
      error.hidden = !result?.error;
      error.textContent = result?.error || "";
      const isSaved = nextSaved.has(nextItem.id);
      saveButton.classList.toggle("saved", isSaved);
      saveButton.textContent = isSaved ? "Saved · Unsave" : "Save for later";
      saveButton.disabled = !nextItem.resolved || state.savingReleases.size > 0;
      saveButton.setAttribute("aria-pressed", String(isSaved));
      add.disabled = !nextItem.resolved || state.busy;
      publisherLink.textContent = nextItem.resolved
        ? "Publisher book page ↗"
        : "Publisher title category ↗";
    };
    discoveryCardUpdates.set(card, update);
    update(item, saved);
    return card;
  }
  function publisherSource(p) {
    const feed = state.releaseFeeds.get(p.id),
      card = node("div", "publisher-source");
    card.append(releaseLink(p.name + " ↗", p.url));
    const stamp = feed?.example
      ? "Preview sample · not a live check"
      : feed?.checkedAt
        ? (feed.stale ? "Previous check " : "Checked ") +
          new Date(feed.checkedAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : state.releasesLoading
          ? "Checking…"
          : "Not checked yet";
    card.append(node("p", "hint", stamp), node("p", "hint", p.scope));
    if (feed?.error) card.append(node("p", "source-error", feed.error));
    return card;
  }
  function renderReleases() {
    if (!state.data || !$("releasesPanel")) return;
    $("refreshReleases").disabled = state.releasesLoading;
    $("refreshReleases").textContent = state.releasesLoading
      ? "Checking publishers…"
      : "Refresh releases";
    const sources = $("publisherSources");
    sources.replaceChildren();
    state.data.publishers.forEach((p) => sources.append(publisherSource(p)));
    const failures = [...state.releaseFeeds.values()].filter(
      (feed) => feed.error,
    ).length;
    $("publisherCheckSummary").textContent =
      "Publisher sources & check times" +
      (failures
        ? " · " + failures + " unavailable"
        : state.releasesLoading
          ? " · Checking…"
          : "");
    const saved = new Set(
        (state.data.savedReleases || []).map((item) => item.id),
      ),
      query = $("releaseSearch").value.trim().toLocaleLowerCase(),
      publisher = $("releasePublisher").value,
      scope = $("releaseScope").value,
      type = $("releaseType").value,
      hideSpecial =
        $("hideSpecialReleases").getAttribute("aria-pressed") === "true";
    const allItems = releaseItems(),
      totals = { unbought: 0, review: 0, owned: 0 };
    allItems.forEach((item) => {
      const match = releaseMatches(item);
      totals[
        match.owned.length
          ? "owned"
          : match.possible.length
            ? "review"
            : "unbought"
      ]++;
    });
    $("releaseOwnershipSummary").textContent =
      number(totals.unbought) +
      " not bought yet · " +
      number(totals.owned) +
      " on your shelf · " +
      number(totals.review) +
      " to check by edition";
    const matchesScope = (item) => {
      const match = releaseMatches(item);
      return (
        (!hideSpecial || !item.special) &&
        (scope !== "saved" || saved.has(item.id)) &&
        (scope !== "series" || match.series.length > 0) &&
        (scope !== "unbought" ||
          (!match.owned.length && !match.possible.length)) &&
        (scope !== "review" ||
          (!match.owned.length && match.possible.length > 0)) &&
        (scope !== "owned" || match.owned.length > 0)
      );
    };
    const isbnSearch = publisherIsbnSearch.get(publisher, query);
    if (isbnSearch) {
      const matching = isbnSearch.items.filter(matchesScope);
      renderPublisherIsbnResults(
        { ...isbnSearch, items: matching },
        "release",
        type,
      );
      return;
    }
    const items = allItems.filter((item) => {
      return (
        (!publisher || item.publisherId === publisher) &&
        (!query ||
          [item.title, item.publisher, item.isbn]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query)) &&
        (!type || String(item.type || "").startsWith(type)) &&
        matchesScope(item)
      );
    });
    $("releaseResultCount").textContent =
      number(items.length) +
      (items.length === 1 ? " release" : " releases") +
      (scope === "saved"
        ? " saved for later"
        : scope === "unbought"
          ? " not bought yet"
          : scope === "review"
            ? " to check by edition"
            : scope === "owned"
              ? " on your shelf"
              : "");
    $("releaseCount").textContent = number(releaseItems().length);
    $("releaseCount").hidden = !releaseItems().length;
    releaseList.render(items, (item) => releaseCard(item, saved.has(item.id)), {
      key: JSON.stringify([query, publisher, scope, type, hideSpecial]),
      label: "releases",
    });
    if (!items.length) {
      const empty = node(
        "div",
        state.releasesLoading ? "empty is-loading" : "empty",
      );
      const failed = [...state.releaseFeeds.values()].some((f) => f.error);
      const filtered =
        (type || hideSpecial) && !failed && !state.releasesLoading;
      empty.append(
        node(
          "h2",
          "",
          state.releasesLoading
            ? "Checking your publishers…"
            : filtered
              ? "No releases match these filters"
              : scope === "saved"
                ? "Your next reads start here"
                : scope === "series"
                  ? "No matching series in these listings"
                  : scope === "unbought" && !failed
                    ? "No unmatched releases"
                    : failed
                      ? "Publisher listings unavailable"
                      : "No releases found",
        ),
        node(
          "p",
          "",
          state.releasesLoading
            ? "Looking for the latest volumes. This may take a moment."
            : filtered
              ? "Try All types, show special editions, or adjust the other filters."
              : scope === "saved"
                ? "Save a release to keep it here, even after it leaves the latest listings."
                : scope === "series"
                  ? "Try All releases. Series names, publisher and language/type must match your shelf."
                  : scope === "unbought" && !failed
                    ? "Use Check edition for possible owned volumes, or All releases to see everything."
                    : failed
                      ? "Use the publisher links above, or refresh to try again."
                      : "Try another search or publisher.",
        ),
      );
      $("releaseList").append(empty);
    }
  }
  function releaseCard(
    item,
    saved,
    context: {
      catalog?: boolean;
      review?: boolean;
      alternatives?: import("../types").Release[];
    } = {},
  ) {
    const card = node("article", "release-card"),
      copy = node("div", "publisher-copy"),
      match = releaseMatches(item),
      busy = state.savingReleases.size > 0 || state.busy;
    card.append(coverImage(item.coverId, item.title, "release-cover"));
    copy.append(
      node("p", "eyebrow", item.publisher),
      node("h2", "book-title", item.title),
    );
    const meta = [
      item.type,
      item.volume !== "" ? "Volume " + item.volume : "",
      item.special ? "Special edition / set" : "",
      item.availability,
    ].filter(Boolean);
    copy.append(node("p", "release-meta", meta.join(" · ")));
    const facts = node("div", "publisher-facts");
    if (item.price !== "")
      facts.append(
        node(
          "p",
          "release-price",
          "Listed price ฿" + number(Number(item.price)),
        ),
      );
    if (item.isbn) facts.append(node("p", "hint", "ISBN " + item.isbn));
    if (facts.childElementCount) copy.append(facts);
    if (
      saved &&
      !context.catalog &&
      state.releasesLoaded &&
      ![...state.releaseFeeds.values()].some((feed) =>
        feed.items.some((release) => release.id === item.id),
      )
    )
      copy.append(node("p", "hint", "Saved listing · Not in the latest check"));
    if (match.owned.length)
      copy.append(node("p", "release-match", "On your shelf · ISBN match"));
    else if (match.possible.length)
      copy.append(
        node(
          "p",
          "release-match possible",
          "Volume on your shelf · Check the edition",
        ),
      );
    else if (context.review)
      copy.append(
        node(
          "p",
          "release-match possible",
          "Other edition or set · Check the details",
        ),
      );
    else
      copy.append(
        node("p", "release-match unbought", "Not bought yet · No shelf match"),
      );
    if (match.series.length && !match.owned.length)
      copy.append(node("p", "hint", "A series you collect"));
    const links = node("div", "release-links");
    links.append(releaseLink("Publisher book page ↗", item.url));
    if (item.isbn)
      links.append(
        releaseLink(
          "Find at Naiin ↗",
          "https://www.naiin.com/search-result?title=" +
            encodeURIComponent(item.isbn),
        ),
        releaseLink("Find at Kinokuniya ↗", kinokuniyaSearchUrl(item.isbn)),
      );
    copy.append(links);
    if (context.alternatives?.length) {
      const alternatives = node("details", "publisher-details");
      alternatives.append(
        node(
          "summary",
          "",
          "Other listings for this volume (" +
            context.alternatives.length +
            ")",
        ),
      );
      context.alternatives.forEach((other) =>
        alternatives.append(
          node("p", "release-links"),
          releaseLink(other.title + " ↗", other.url),
        ),
      );
      copy.append(alternatives);
    }
    const buttons = node("div", "buttons"),
      saveButton = node(
        "button",
        "btn" + (saved ? " saved" : ""),
        state.savingReleases.has(item.id)
          ? "Saving…"
          : saved
            ? "Saved · Unsave"
            : "Save for later",
      );
    saveButton.disabled = busy;
    saveButton.setAttribute("aria-pressed", String(saved));
    saveButton.addEventListener("click", () => void saveRelease(item, !saved), {
      signal: events.signal,
    });
    buttons.append(saveButton);
    const add = node(
      "button",
      "btn",
      match.owned.length ? "View owned series" : "Add to shelf",
    );
    add.disabled = busy;
    add.addEventListener(
      "click",
      () => {
        if (match.owned.length) {
          openSeries(seriesKey(match.owned[0]));
        } else openRelease(item, match);
      },
      { signal: events.signal },
    );
    buttons.append(add);
    card.append(copy, buttons);
    return card;
  }
  async function saveRelease(item, saved) {
    if (state.savingReleases.size > 0) return;
    state.savingReleases.add(item.id);
    if ($("releaseError")) $("releaseError").hidden = true;
    if ($("seriesReleaseError")) $("seriesReleaseError").hidden = true;
    if ($("discoveryError")) $("discoveryError").hidden = true;
    renderReleases();
    renderDiscovery();
    renderSeriesMissing();
    try {
      const result = await rpc("setSavedRelease", { release: item, saved });
      state.data.savedReleases = result.savedReleases;
      notify(saved ? "Saved for later." : "Removed from your saved releases.");
    } catch (error) {
      errorAt("releaseError", error);
      errorAt("seriesReleaseError", error);
      errorAt("discoveryError", error);
    } finally {
      state.savingReleases.delete(item.id);
      renderReleases();
      renderDiscovery();
      renderSeriesMissing();
    }
  }
  function openRelease(item, match) {
    const series = item.catalogVariant
      ? item.series
      : match.series[0]?.series || item.catalogSeries || item.series;
    openBook(null, {
      series,
      volume: item.volume,
      isbn: item.isbn || item.searchedIsbn,
      type: item.type || "Other",
      publisher: item.publisher,
    });
    // A publisher listing identifies this edition, including its language.
    $("type").value = item.type || "Other";
    state.typeTouched = true;
    $("publisher").value = item.publisher;
    fillListedPrice(item);
    state.detailsExpanded = true;
    renderBookDetails();
    $("lookupResult").hidden = false;
    $("lookupResult").replaceChildren(
      node("strong", "", item.title),
      document.createTextNode(
        "Review this edition and enter the amount you paid before saving. " +
          (item.searchedIsbn
            ? "ISBN " +
              item.searchedIsbn +
              " comes from your search and has not been checked against the product ISBN; check the book’s barcode before saving. "
            : "") +
          (item.special
            ? "This is a special edition or set; check the series and volume carefully."
            : ""),
      ),
    );
  }

  function setLookupLoading(loading: boolean) {
    $("isbnLookupStatus").hidden = !loading;
    $("bookForm").setAttribute("aria-busy", String(loading));
    $("lookupButton").disabled = loading || state.busy;
    $("lookupButton").textContent = loading ? "Looking up…" : "Look up";
  }
  function clearLookup(event?: Event) {
    if (event && state.lookupDetailsExpanded) state.detailsExpanded = true;
    state.lookupGeneration++;
    state.lookupMatched = false;
    state.lookupDetailsExpanded = false;
    clearListedPrice();
    $("lookupResult").hidden = true;
    setLookupLoading(false);
    renderBookDetails();
  }
  function invalidateCheck() {
    state.checkGeneration++;
    state.checkResult = null;
    $("ownershipResult").hidden = true;
    $("ownershipResult").replaceChildren();
    $("checkError").hidden = true;
    $("checkIsbnButton").disabled = false;
    $("checkIsbnButton").textContent = "Check";
    renderManualCheck();
  }
  function openCheck() {
    if (state.busy || !state.data) return;
    $("checkForm").reset();
    $("checkSearch").value = "";
    invalidateCheck();
    $("checkDialog").showModal();
    $("checkIsbn").focus();
  }
  function closeCheck() {
    state.checkGeneration++;
    $("checkDialog").close();
  }
  async function checkBook(event?: Event) {
    event?.preventDefault();
    if (state.busy) return;
    const raw = $("checkIsbn").value.trim(),
      generation = ++state.checkGeneration;
    state.checkResult = null;
    $("ownershipResult").hidden = true;
    $("checkError").hidden = true;
    renderManualCheck();
    if (!canonical(raw)) {
      errorAt(
        "checkError",
        raw
          ? "Enter a valid ISBN-10 or ISBN-13."
          : "Enter or scan an ISBN first.",
      );
      return;
    }
    $("checkIsbnButton").disabled = true;
    $("checkIsbnButton").textContent = "Checking…";
    try {
      const result = await rpc("checkOwnership", raw);
      if (
        generation !== state.checkGeneration ||
        !$("checkDialog").open ||
        $("checkIsbn").value.trim() !== raw
      )
        return;
      state.checkResult = result;
      $("checkIsbn").value = result.isbn;
      // Keep the browsing and manual-check lists in step with this fresh collection read.
      state.data.books = result.books;
      render();
      const panel = node(
        "div",
        "ownership-status" + (result.matches.length ? "" : " unknown"),
      );
      panel.append(
        node(
          "h3",
          "",
          result.matches.length ? "Already on your shelf" : "No ISBN match",
        ),
      );
      panel.append(
        node(
          "p",
          "",
          result.matches.length
            ? result.matches.length === 1
              ? "You own this edition."
              : "You own " + result.matches.length + " copies of this edition."
            : result.unindexedCount
              ? number(result.unindexedCount) +
                " of " +
                number(result.totalCount) +
                " books have no usable ISBN yet. Search the series below to check whether you already own this volume."
              : "This ISBN is not listed on your current shelf. Search the series below if you want to compare other editions.",
        ),
      );
      const container = $("ownershipResult");
      container.replaceChildren(panel);
      result.matches.forEach((b) => container.append(ownershipBook(b, false)));
      container.append(
        node(
          "p",
          "store-stamp",
          "ISBN " +
            result.isbn +
            " · Checked " +
            new Date(result.checkedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
        ),
      );
      container.hidden = false;
      renderManualCheck();
    } catch (error) {
      if (generation === state.checkGeneration)
        errorAt(
          "checkError",
          "Unable to check your current shelf. " +
            (error.message || String(error)),
        );
    } finally {
      if (generation === state.checkGeneration) {
        $("checkIsbnButton").disabled = false;
        $("checkIsbnButton").textContent = "Check";
      }
    }
  }
  function ownershipBook(book, canLink) {
    const card = node("div", "ownership-book"),
      info = node("div");
    info.append(
      node(
        "h3",
        "",
        book.series +
          (book.volume !== "" && book.volume !== null
            ? " · Volume " + book.volume
            : ""),
      ),
      node(
        "p",
        "",
        [
          book.type,
          book.publisher,
          book.isbn ? "ISBN " + book.isbn : "ISBN not added",
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    card.append(info);
    const button = node(
      "button",
      "btn",
      canLink ? "Link this ISBN" : "View series",
    );
    button.addEventListener(
      "click",
      () => {
        if (canLink) {
          openIsbn(book, state.checkResult.isbn);
        } else {
          closeCheck();
          openSeries(seriesKey(book));
        }
      },
      { signal: events.signal },
    );
    card.append(button);
    return card;
  }
  function renderManualCheck() {
    const container = $("checkSearchResults");
    container.replaceChildren();
    const query = $("checkSearch").value.trim().toLocaleLowerCase();
    if (!query) {
      $("checkSearchHint").textContent =
        "Useful for books you haven't added an ISBN to yet.";
      return;
    }
    const terms = query.split(/\s+/),
      books = state.checkResult?.books || state.data?.books || [];
    const matches = books
      .filter((b) => {
        const haystack = FIELDS.map((k) => String(b[k] ?? ""))
          .join(" ")
          .toLocaleLowerCase();
        return terms.every((t) => haystack.includes(t));
      })
      .sort(
        (a, b) => seriesKey(a).localeCompare(seriesKey(b)) || byVolume(a, b),
      );
    $("checkSearchHint").textContent = matches.length
      ? matches.length > 8
        ? "Showing 8 of " +
          matches.length +
          " matches. Keep typing to narrow the list."
        : matches.length +
          (matches.length === 1
            ? " owned volume found."
            : " owned volumes found.")
      : "No matching owned volumes in the loaded collection.";
    matches
      .slice(0, 8)
      .forEach((b) =>
        container.append(
          ownershipBook(b, !!state.checkResult?.isbn && !canonical(b.isbn)),
        ),
      );
  }
  function openIsbn(book, isbn = "") {
    if (state.busy) return;
    if ($("checkDialog").open) closeCheck();
    state.isbnBook = book;
    state.pendingIsbn = null;
    $("isbnForm").reset();
    $("isbnError").hidden = true;
    $("linkIsbn").value = isbn || String(book.isbn || "");
    $("isbnBookName").textContent = book.series;
    $("isbnBookDetails").textContent = [
      book.volume !== "" && book.volume !== null
        ? "Volume " + book.volume
        : "Unnumbered book",
      book.type,
      book.publisher,
    ]
      .filter(Boolean)
      .join(" · ");
    $("isbnDialog").showModal();
    $("linkIsbn").focus();
  }
  function closeIsbn() {
    if (state.busy) return;
    $("isbnDialog").close();
    state.isbnBook = null;
  }
  async function saveIsbn(event) {
    event.preventDefault();
    if (state.busy || !state.isbnBook || !$("isbnForm").reportValidity())
      return;
    const book = state.isbnBook,
      content = {
        row: book.row,
        token: book.token,
        isbn: $("linkIsbn").value,
        allowDuplicate: $("linkAllowDuplicate").checked,
      },
      key = JSON.stringify(content),
      keep = $("linkNext").checked;
    if (state.pendingIsbn?.key !== key)
      state.pendingIsbn = {
        key,
        request: { ...content, requestId: requestId() },
      };
    $("isbnError").hidden = true;
    setBusy(true);
    $("saveIsbnButton").textContent = "Saving…";
    try {
      await rpc("setBookIsbn", state.pendingIsbn.request);
      $("isbnDialog").close();
      state.isbnBook = null;
      state.pendingIsbn = null;
      setBusy(false);
      notify("ISBN saved. Future scans will find this volume.");
      try {
        await load();
        if (keep) {
          const next = state.data.books
            .filter(
              (b) => seriesKey(b) === seriesKey(book) && !canonical(b.isbn),
            )
            .sort(byVolume)[0];
          if (next) {
            openIsbn(next);
            $("linkNext").checked = true;
          } else notify("All volumes in this series now have an ISBN.");
        }
      } catch (error) {
        errorAt(
          "pageError",
          "The ISBN was saved, but the list could not refresh. Press Refresh.",
        );
      }
    } catch (error) {
      errorAt("isbnError", error);
    } finally {
      setBusy(false);
      $("saveIsbnButton").textContent = "Save ISBN";
      render();
    }
  }
  function openBook(book, defaults = null) {
    if (state.busy || !state.data) return;
    state.editing = book || null;
    state.typeTouched = false;
    state.publisherTouched = false;
    state.pendingSave = null;
    state.pendingRemove = null;
    state.formSeries = book ? seriesKey(book) : null;
    state.titleLocked =
      !!book ||
      (!!defaults?.series && defaults.series === state.selectedSeries);
    state.newEdition = false;
    state.sharedDraft = null;
    state.detailsExpanded = false;
    $("bookForm").reset();
    resetPricing();
    $("formError").hidden = true;
    clearLookup();
    (["type", "status"] as const).forEach((k) =>
      fillOptions(k, state.data.options[k]),
    );
    FIELDS.forEach((k) => ($(k).value = book?.[k] ?? defaults?.[k] ?? ""));
    if (!book) $("source").value = "";
    state.coverPickerGeneration++;
    state.selectedCoverId = book?.coverId || "";
    $("coverUrl").value = book?.coverUrl || "";
    $("publisherUrl").value = book?.publisherUrl || "";
    $("publisherCoverChoices").replaceChildren();
    $("publisherCoversStatus").textContent = book
      ? "Pull all available covers for this volume and choose one."
      : "Save this book to look for publisher and bookstore covers.";
    $("pullPublisherCovers").disabled = !book;
    renderMetadataCover();
    if (!book) {
      $("date").value = defaults?.date ?? state.data.today;
      $("type").value = defaults?.type || "Manga (TH)";
      $("status").value = defaults?.status || "Sealed";
    }
    $("bookDialogTitle").textContent = book
      ? "Book details"
      : "Add to your shelf";
    $("bookDialogSubtitle").textContent = book
      ? "A few details, one well-kept shelf."
      : "Scan an ISBN or fill in the details yourself.";
    $("saveButton").textContent = book ? "Save changes" : "Add book";
    $("removeButton").hidden = !book;
    $("keepAddingLabel").hidden = !!book;
    const mobile = window.matchMedia("(max-width: 560px)").matches;
    $("priceCalculator").open = !!book || !mobile;
    $("bookExtras").open = !!book || !mobile;
    syncSeriesSelection();
    if (!book && defaults?.type && defaults.publisher !== undefined) {
      $("type").value = defaults.type;
      $("publisher").value = defaults.publisher;
      renderBookDetails();
    }
    $("saveButton").disabled = false;
    $("removeButton").disabled = false;
    syncBookViewport();
    $("bookDialog").showModal();
    (mobile
      ? $("bookDialogTitle")
      : state.formSeries
        ? $("volume")
        : $("isbn")
    ).focus({ preventScroll: true });
    $("bookDialog").querySelector(".dialog-body").scrollTop = 0;
  }
  function syncBookViewport() {
    const viewport = window.visualViewport;
    $("bookDialog").style.setProperty(
      "--book-dialog-height",
      (viewport?.height ?? window.innerHeight) + "px",
    );
    $("bookDialog").style.setProperty(
      "--book-dialog-top",
      (viewport?.offsetTop ?? 0) + "px",
    );
  }
  function resetPricing() {
    state.calculatedPrice = null;
    state.listedPrice = null;
    $("regularPrice").setCustomValidity("");
    $("discount").setCustomValidity("");
    $("discount").max = "100";
    $("discountHint").textContent = "Enter a percentage from 0 to 100.";
    $("priceSummary").hidden = true;
    $("listedPriceHint").hidden = true;
    $("listedPriceHint").textContent = "";
  }
  function clearListedPrice() {
    if (
      state.listedPrice !== null &&
      $("regularPrice").value === state.listedPrice
    )
      $("regularPrice").value = "";
    state.listedPrice = null;
    $("listedPriceHint").hidden = true;
    $("listedPriceHint").textContent = "";
  }
  function fillListedPrice(details) {
    const original =
      details.regularPrice !== "" && details.regularPrice != null;
    const price = original ? details.regularPrice : details.price;
    if (
      price === "" ||
      price == null ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    )
      return;
    if (!$("regularPrice").value) {
      $("regularPrice").value = String(price);
      state.listedPrice = $("regularPrice").value;
    }
    $("listedPriceHint").textContent =
      (original ? "Original price: " : "Listed price: ") +
      number(Number(price)) +
      (details.source || details.publisher
        ? " · " + (details.source || details.publisher)
        : "");
    $("listedPriceHint").hidden = false;
  }
  function calculateSalePrice() {
    const regular = $("regularPrice"),
      discount = $("discount"),
      percent = $("discountType").value === "percent";
    regular.setCustomValidity("");
    discount.setCustomValidity("");
    discount.max = percent ? "100" : regular.value;
    $("discountHint").textContent = percent
      ? "Enter a percentage from 0 to 100."
      : "Enter the amount taken off the regular price.";
    $("priceSummary").hidden = true;
    if (regular.value === "") {
      if (discount.value !== "")
        discount.setCustomValidity(
          "Enter the regular price to use a discount.",
        );
      if (state.calculatedPrice !== null) $("price").value = "";
      state.calculatedPrice = null;
      return;
    }
    if (
      !regular.validity.valid ||
      discount.validity.badInput ||
      discount.validity.rangeUnderflow
    )
      return;
    const base = Number(regular.value),
      off = discount.value === "" ? 0 : Number(discount.value);
    if (!Number.isFinite(base) || !Number.isFinite(off)) return;
    if ((percent && off > 100) || (!percent && off > base)) {
      discount.setCustomValidity(
        percent
          ? "Discount must be between 0 and 100%."
          : "Discount cannot exceed the regular price.",
      );
      return;
    }
    const sale = percent ? base * (1 - off / 100) : base - off,
      rounded =
        Math.round((sale + Number.EPSILON * Math.max(1, base)) * 100) / 100;
    if (!Number.isFinite(rounded)) {
      regular.setCustomValidity("Enter a smaller regular price.");
      return;
    }
    $("price").value = String(rounded);
    state.calculatedPrice = $("price").value;
    $("priceSummary").textContent =
      "You save " +
      number(Math.max(0, base - rounded)) +
      (percent && off ? " (" + number(off) + "% off)." : ".");
    $("priceSummary").hidden = false;
  }
  function enterSalePrice() {
    state.calculatedPrice = null;
    $("priceSummary").textContent =
      "Sale price entered directly. Change the regular price or discount to recalculate.";
    $("priceSummary").hidden =
      $("regularPrice").value === "" && $("discount").value === "";
  }
  function closeBook() {
    if (state.busy) return;
    clearLookup();
    $("bookDialog").close();
    state.editing = null;
  }
  async function lookup() {
    if (state.busy) return;
    const generation = ++state.lookupGeneration,
      raw = $("isbn").value.trim(),
      initialSeries = $("series").value;
    $("isbnLookupMessage").textContent =
      "ISBN " + raw + " · Checking publishers and bookshops for book details.";
    setLookupLoading(true);
    $("lookupResult").hidden = true;
    $("lookupResult").replaceChildren();
    state.lookupMatched = false;
    clearListedPrice();
    renderBookDetails();
    try {
      const result = await rpc("lookupIsbn", raw);
      if (
        generation !== state.lookupGeneration ||
        !$("bookDialog").open ||
        $("isbn").value.trim() !== raw
      )
        return;
      $("isbn").value = result.isbn;
      const duplicates = state.data.books.filter(
        (b) =>
          b.row !== state.editing?.row &&
          canonical(b.isbn) === canonical(result.isbn),
      );
      let message = "";
      if (result.found) {
        const d = result.details;
        message =
          d.title +
          (d.authors ? "\n" + d.authors : "") +
          "\nSuggested by " +
          d.source +
          ".";
        if (!initialSeries && !$("series").value)
          $("series").value = d.series || d.title;
        if (!state.formSeries && !state.editing && !state.publisherTouched)
          $("publisher").value = d.publisher;
        syncSeriesSelection();
        if (d.volume !== undefined && d.volume !== "" && !$("volume").value)
          $("volume").value = d.volume;
        if (d.type && !state.formSeries && !state.editing && !state.typeTouched)
          $("type").value = d.type;
        fillListedPrice(d);
        state.lookupMatched = !!$("series").value.trim();
        state.lookupDetailsExpanded = false;
      } else
        message =
          "No book details found. The ISBN is ready. Fill in the series, volume and publisher yourself.";
      if (result.warnings?.length) message += "\n" + result.warnings.join(" ");
      if (duplicates.length)
        message +=
          "\nAlready on your shelf: " +
          duplicates
            .map((b) => b.series + (b.volume !== "" ? " vol. " + b.volume : ""))
            .join(", ") +
          ".";
      $("lookupResult").hidden = false;
      $("lookupResult").textContent = message;
      const searchLinks = node("div");
      searchLinks.setAttribute("data-lookup-detail", "");
      if (result.searchUrl) {
        searchLinks.append(
          document.createTextNode("\n"),
          releaseLink("Search this ISBN at Naiin ↗", result.searchUrl),
        );
      }
      searchLinks.append(
        document.createTextNode("\n"),
        releaseLink(
          "Search this ISBN at Phoenix Next ↗",
          "https://www.phoenixnext.com/catalogsearch/result/?q=" +
            canonical(result.isbn),
        ),
        document.createTextNode("\n"),
        releaseLink(
          "Search this ISBN at First Page Pro ↗",
          "https://www.firstpagepro.com/search?q=" + canonical(result.isbn),
        ),
        document.createTextNode("\n"),
        releaseLink(
          "Search this ISBN at Kinokuniya ↗",
          kinokuniyaSearchUrl(canonical(result.isbn)),
        ),
      );
      $("lookupResult").append(searchLinks);
      renderBookDetails();
      if (state.lookupMatched && !state.editing) {
        $("source").focus({ preventScroll: true });
        $("bookDialog").querySelector(".dialog-body").scrollTop = 0;
      }
    } catch (error) {
      if (generation === state.lookupGeneration) {
        $("lookupResult").hidden = false;
        $("lookupResult").textContent = error.message || String(error);
      }
    } finally {
      if (generation === state.lookupGeneration) setLookupLoading(false);
    }
  }
  function setBusy(busy) {
    state.busy = busy;
    (
      [
        "addButton",
        "checkBookButton",
        "saveButton",
        "removeButton",
        "confirmRemove",
        "lookupButton",
        "scanButton",
        "closeBook",
        "cancelBook",
        "closeRemove",
        "cancelRemove",
        "saveIsbnButton",
        "linkScanButton",
        "closeIsbn",
        "cancelIsbn",
        "editTitleButton",
        "saveTitleButton",
        "closeTitle",
        "cancelTitle",
      ] as const
    ).forEach((id) => {
      if ($(id)) $(id).disabled = busy;
    });
    $("bookForm")
      .querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input,select,textarea")
      .forEach((e) => (e.disabled = busy));
    $("isbnForm")
      .querySelectorAll("input")
      .forEach((e) => (e.disabled = busy));
    $("titleForm")
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")
      .forEach((e) => (e.disabled = busy));
    seriesEditor.syncControls();
    bulkSelection.syncControls();
  }
  async function save(event) {
    event.preventDefault();
    if (state.busy || !$("bookForm").reportValidity()) return;
    state.lookupGeneration++;
    setLookupLoading(false);
    $("formError").hidden = true;
    const book = Object.fromEntries(FIELDS.map((k) => [k, $(k).value]));
    if (
      state.editing ||
      $("coverUrl").value.trim() ||
      $("publisherUrl").value.trim()
    ) {
      book.coverId = state.selectedCoverId;
      book.coverUrl = $("coverUrl").value.trim();
      book.publisherUrl = $("publisherUrl").value.trim();
    }
    if (!state.editing && state.formSeries) book.series = state.formSeries;
    const content = {
      book,
      allowDuplicate: $("allowDuplicate").checked,
      ...(state.editing
        ? { row: state.editing.row, token: state.editing.token }
        : {}),
    };
    const key = JSON.stringify(content);
    if (state.pendingSave?.key !== key)
      state.pendingSave = {
        key,
        request: { ...content, requestId: requestId() },
      };
    const keep = !state.editing && $("keepAdding").checked,
      defaults = keep
        ? {
            ...Object.fromEntries(
              (["type", "publisher", "status", "date"] as const).map((k) => [
                k,
                $(k).value,
              ]),
            ),
            ...(state.formSeries ? { series: state.formSeries } : {}),
          }
        : null;
    setBusy(true);
    $("saveButton").textContent = "Saving…";
    try {
      const result = await rpc("saveBook", state.pendingSave.request);
      $("bookDialog").close();
      state.editing = null;
      state.pendingSave = null;
      setBusy(false);
      notify(
        result.action === "updated"
          ? "Book details saved."
          : "Added to your shelf.",
      );
      try {
        await load();
        if (keep) {
          openBook(null, defaults);
          $("keepAdding").checked = true;
        }
      } catch (e) {
        errorAt(
          "pageError",
          "Your book was saved, but the list could not refresh. Press Refresh to see it.",
        );
      }
    } catch (error) {
      errorAt("formError", error);
      $("formError").scrollIntoView({ block: "nearest" });
    } finally {
      setBusy(false);
      renderBookDetails();
    }
  }
  function askRemove() {
    if (state.busy || !state.editing) return;
    $("removeName").textContent =
      state.editing.series +
      (state.editing.volume !== "" ? " · Volume " + state.editing.volume : "");
    $("removeError").hidden = true;
    $("removeDialog").showModal();
  }
  async function remove() {
    if (state.busy || !state.editing) return;
    if (!state.pendingRemove)
      state.pendingRemove = {
        requestId: requestId(),
        row: state.editing.row,
        token: state.editing.token,
      };
    setBusy(true);
    $("removeError").hidden = true;
    try {
      await rpc("removeBook", state.pendingRemove);
      $("removeDialog").close();
      $("bookDialog").close();
      state.editing = null;
      state.pendingRemove = null;
      notify("Book removed. You can restore it from Recently removed.");
      try {
        await load();
      } catch (e) {
        errorAt(
          "pageError",
          "Your book was removed, but the list could not refresh. Press Refresh.",
        );
      }
    } catch (error) {
      errorAt("removeError", error);
    } finally {
      setBusy(false);
      render();
    }
  }
  async function restoreEntry(entry, button) {
    if (state.busy) return;
    if (!state.restoreRequests.has(entry.id))
      state.restoreRequests.set(entry.id, {
        requestId: requestId(),
        trashId: entry.id,
      });
    setBusy(true);
    button.disabled = true;
    button.textContent = "Restoring…";
    try {
      await rpc("restoreBook", state.restoreRequests.get(entry.id));
      state.restoreRequests.delete(entry.id);
      notify("Book restored to your shelf.");
      try {
        await load();
      } catch (e) {
        errorAt(
          "pageError",
          "Your book was restored, but the list could not refresh. Press Refresh.",
        );
      }
    } catch (error) {
      errorAt("pageError", error);
    } finally {
      setBusy(false);
      button.disabled = false;
      button.textContent = "Restore book";
      render();
    }
  }
  const { openScanner, closeScanner, startCamera, stopScanner, scanPhoto } =
    createScanner({ state, $, node, checkBook, lookup, clearLookup });
  const seriesEditor = createSeriesEditor({
    state,
    signal: events.signal,
    rpc,
    reload: load,
    notify,
    setBusy,
  });

  // Initialize collection controls.
  $("addButton")?.addEventListener(
    "click",
    () => openBook(null, seriesDefaults()),
    { signal: events.signal },
  );
  $("closeBook")?.addEventListener("click", closeBook, {
    signal: events.signal,
  });
  $("cancelBook")?.addEventListener("click", closeBook, {
    signal: events.signal,
  });
  $("bookDialog")?.addEventListener(
    "cancel",
    (e) => {
      e.preventDefault();
      closeBook();
    },
    { signal: events.signal },
  );
  $("bookForm")?.addEventListener("submit", save, { signal: events.signal });
  window.visualViewport?.addEventListener("resize", syncBookViewport, {
    signal: events.signal,
  });
  window.visualViewport?.addEventListener("scroll", syncBookViewport, {
    signal: events.signal,
  });
  window.addEventListener("resize", syncBookViewport, {
    signal: events.signal,
  });
  // Reveal invalid optional fields before the browser tries to focus them.
  $("bookForm")?.addEventListener(
    "invalid",
    (event) => {
      const field = event.target as HTMLElement;
      if (field.closest("[data-lookup-detail]")) {
        state.lookupDetailsExpanded = true;
        state.detailsExpanded = true;
        renderBookDetails();
      }
      for (
        let parent = field.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent instanceof HTMLDetailsElement) parent.open = true;
    },
    { capture: true, signal: events.signal },
  );
  $("editTitleButton")?.addEventListener("click", openTitle, {
    signal: events.signal,
  });
  $("titleForm")?.addEventListener("submit", saveTitle, {
    signal: events.signal,
  });
  (["closeTitle", "cancelTitle"] as const).forEach((id) =>
    $(id)?.addEventListener("click", closeTitle, { signal: events.signal }),
  );
  $("titleDialog")?.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      closeTitle();
    },
    { signal: events.signal },
  );
  $("bookEdition")?.addEventListener(
    "change",
    () => {
      state.newEdition = $("bookEdition").value === "new";
      if (!state.newEdition) {
        const [type, publisher] = JSON.parse($("bookEdition").value);
        $("type").value = type;
        $("publisher").value = publisher;
      }
      state.typeTouched = true;
      state.coverPickerGeneration++;
      $("publisherCoverChoices").replaceChildren();
      renderBookDetails();
      renderMetadataCover();
    },
    { signal: events.signal },
  );
  (["input", "change"] as const).forEach((event) =>
    $("series")?.addEventListener(event, syncSeriesSelection, {
      signal: events.signal,
    }),
  );
  $("toggleBookDetails")?.addEventListener(
    "click",
    () => {
      if (state.busy) return;
      state.detailsExpanded = !state.detailsExpanded;
      if (state.detailsExpanded) $("bookExtras").open = true;
      renderBookDetails();
    },
    { signal: events.signal },
  );
  $("toggleLookupDetails")?.addEventListener(
    "click",
    () => {
      if (state.busy) return;
      state.lookupDetailsExpanded = !state.lookupDetailsExpanded;
      if (state.lookupDetailsExpanded) $("bookExtras").open = true;
      renderBookDetails();
    },
    { signal: events.signal },
  );
  $("type")?.addEventListener(
    "change",
    () => {
      state.typeTouched = true;
    },
    { signal: events.signal },
  );
  (["type", "publisher", "source"] as const).forEach((id) =>
    $(id)?.addEventListener(
      id === "type" ? "change" : "input",
      () => {
        if (id === "publisher") state.publisherTouched = true;
        renderBookDetails();
      },
      { signal: events.signal },
    ),
  );
  (["regularPrice", "discount"] as const).forEach((id) =>
    $(id)?.addEventListener("input", calculateSalePrice, {
      signal: events.signal,
    }),
  );
  $("discountType")?.addEventListener("change", calculateSalePrice, {
    signal: events.signal,
  });
  $("price")?.addEventListener("input", enterSalePrice, {
    signal: events.signal,
  });
  $("lookupButton")?.addEventListener("click", lookup, {
    signal: events.signal,
  });
  $("isbn")?.addEventListener("input", clearLookup, { signal: events.signal });
  $("isbn")?.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void lookup();
      }
    },
    { signal: events.signal },
  );
  $("scanButton")?.addEventListener("click", () => openScanner("add"), {
    signal: events.signal,
  });
  $("checkBookButton")?.addEventListener("click", openCheck, {
    signal: events.signal,
  });
  $("checkForm")?.addEventListener("submit", checkBook, {
    signal: events.signal,
  });
  $("checkIsbn")?.addEventListener("input", invalidateCheck, {
    signal: events.signal,
  });
  $("checkSearch")?.addEventListener("input", renderManualCheck, {
    signal: events.signal,
  });
  (["closeCheck", "doneCheck"] as const).forEach((id) =>
    $(id)?.addEventListener("click", closeCheck, { signal: events.signal }),
  );
  $("checkDialog")?.addEventListener(
    "cancel",
    (e) => {
      e.preventDefault();
      closeCheck();
    },
    { signal: events.signal },
  );
  (["checkScanButton", "scanNextBook"] as const).forEach((id) =>
    $(id)?.addEventListener("click", () => openScanner("check"), {
      signal: events.signal,
    }),
  );
  $("isbnForm")?.addEventListener("submit", saveIsbn, {
    signal: events.signal,
  });
  $("linkScanButton")?.addEventListener("click", () => openScanner("link"), {
    signal: events.signal,
  });
  (["closeIsbn", "cancelIsbn"] as const).forEach((id) =>
    $(id)?.addEventListener("click", closeIsbn, { signal: events.signal }),
  );
  $("isbnDialog")?.addEventListener(
    "cancel",
    (e) => {
      e.preventDefault();
      closeIsbn();
    },
    { signal: events.signal },
  );
  $("startCamera")?.addEventListener("click", () => void startCamera(), {
    signal: events.signal,
  });
  $("stopCamera")?.addEventListener(
    "click",
    () => {
      stopScanner();
      $("scanMessage").textContent =
        "Camera stopped. Take or choose a photo, or restart the live camera.";
    },
    { signal: events.signal },
  );
  $("closeScan")?.addEventListener("click", closeScanner, {
    signal: events.signal,
  });
  $("scanDialog")?.addEventListener(
    "cancel",
    (e) => {
      e.preventDefault();
      closeScanner();
    },
    { signal: events.signal },
  );
  (["barcodePhoto", "chooseBarcodePhoto"] as const).forEach((id) =>
    $(id)?.addEventListener("change", scanPhoto, { signal: events.signal }),
  );
  // iOS may hide the page while its native camera/photo picker is open. Preserve photo scans.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden && (state.cameraRunning || state.cameraStart)) {
        stopScanner();
        $("scanMessage").textContent =
          "Camera paused. Restart it or take a photo to continue.";
      }
    },
    { signal: events.signal },
  );
  window.addEventListener(
    "pagehide",
    () => {
      savePagePreferences();
      stopScanner();
    },
    { signal: events.signal },
  );
  $("removeButton")?.addEventListener("click", askRemove, {
    signal: events.signal,
  });
  $("pullPublisherCovers")?.addEventListener(
    "click",
    () => void pullPublisherCovers(),
    { signal: events.signal },
  );
  $("coverUrl")?.addEventListener(
    "input",
    () => {
      state.selectedCoverId = "";
    },
    { signal: events.signal },
  );
  (["coverUrl", "publisherUrl", "publisher"] as const).forEach((id) =>
    $(id)?.addEventListener("input", renderMetadataCover, {
      signal: events.signal,
    }),
  );
  (["series", "volume", "type", "publisher", "publisherUrl"] as const).forEach(
    (id) =>
      $(id)?.addEventListener(
        id === "type" ? "change" : "input",
        () => {
          state.coverPickerGeneration++;
          $("publisherCoverChoices").replaceChildren();
          $("pullPublisherCovers").disabled = !state.editing || state.busy;
          $("publisherCoversStatus").textContent = state.editing
            ? "Pull covers again after changing the publisher page. Save volume or series changes first."
            : "Save this book to look for publisher and bookstore covers.";
        },
        { signal: events.signal },
      ),
  );
  document.addEventListener(
    "click",
    (event) => {
      document
        .querySelectorAll<HTMLDetailsElement>(".volume-actions[open]")
        .forEach((menu) => {
          if (!menu.contains(event.target as Node)) menu.open = false;
        });
    },
    { signal: events.signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape")
        document
          .querySelectorAll<HTMLDetailsElement>(".volume-actions[open]")
          .forEach((menu) => {
            menu.open = false;
            menu.querySelector("summary").focus();
          });
    },
    { signal: events.signal },
  );
  $("confirmRemove")?.addEventListener("click", remove, {
    signal: events.signal,
  });
  (["closeRemove", "cancelRemove"] as const).forEach((id) =>
    $(id)?.addEventListener(
      "click",
      () => {
        if (!state.busy) $("removeDialog").close();
      },
      { signal: events.signal },
    ),
  );
  $("removeDialog")?.addEventListener(
    "cancel",
    (e) => {
      if (state.busy) e.preventDefault();
    },
    { signal: events.signal },
  );
  $("discoveryForm")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      void loadDiscovery();
    },
    { signal: events.signal },
  );
  $("refreshDiscovery")?.addEventListener(
    "click",
    () => void loadDiscovery(true),
    { signal: events.signal },
  );
  $("discoveryPreset")?.addEventListener(
    "change",
    () => {
      if ($("discoveryPreset").value) {
        $("discoveryUrl").value = $("discoveryPreset").value;
        void loadDiscovery();
      } else $("discoveryUrl").focus();
    },
    { signal: events.signal },
  );
  $("discoveryUrl")?.addEventListener(
    "input",
    () => {
      $("discoveryPreset").value = [...$("discoveryPreset").options].some(
        (option) => option.value === $("discoveryUrl").value,
      )
        ? $("discoveryUrl").value
        : "";
    },
    { signal: events.signal },
  );
  $("discoverySearch")?.addEventListener("input", renderDiscovery, {
    signal: events.signal,
  });
  $("discoveryType")?.addEventListener("change", renderDiscovery, {
    signal: events.signal,
  });
  $("refreshReleases")?.addEventListener(
    "click",
    () => void loadReleases(true),
    { signal: events.signal },
  );
  $("refreshSeriesReleases")?.addEventListener(
    "click",
    () => void loadSeriesCatalogs(true),
    { signal: events.signal },
  );
  $("seriesCatalogToggle")?.addEventListener(
    "click",
    () => {
      state.seriesDetailsExpanded = !state.seriesDetailsExpanded;
      $("seriesCatalogDetails").open = state.seriesDetailsExpanded;
      renderSeriesMissing();
    },
    { signal: events.signal },
  );
  (
    [
      "releaseSearch",
      "releasePublisher",
      "releaseScope",
      "releaseType",
    ] as const
  ).forEach((id) =>
    $(id)?.addEventListener(
      id === "releaseSearch" ? "input" : "change",
      renderReleases,
      { signal: events.signal },
    ),
  );
  $("hideSpecialReleases")?.addEventListener(
    "click",
    () => {
      $("hideSpecialReleases").setAttribute(
        "aria-pressed",
        String(
          $("hideSpecialReleases").getAttribute("aria-pressed") !== "true",
        ),
      );
      renderReleases();
    },
    { signal: events.signal },
  );
  ([...COLLECTION_FILTERS, "collectionSort"] as const).forEach((id) =>
    $(id)?.addEventListener(
      $(id)?.tagName === "INPUT" ? "input" : "change",
      render,
      { signal: events.signal },
    ),
  );
  $("clearCollectionFilters")?.addEventListener(
    "click",
    () => {
      resetCollectionFilters();
      render();
    },
    { signal: events.signal },
  );
  $("refreshButton")?.addEventListener(
    "click",
    () => void load().catch(() => {}),
    { signal: events.signal },
  );
  $("refreshMissingCatalogs")?.addEventListener(
    "click",
    async () => {
      $("refreshMissingCatalogs").disabled = true;
      try {
        await load(true);
      } catch {
        // The shelf error is already shown by load(). Keep the current catalog.
      } finally {
        if (state.data) missingBrowser.render(state.data.books);
      }
    },
    { signal: events.signal },
  );
  (["missingSearch", "missingSort"] as const).forEach((id) =>
    $(id)?.addEventListener(
      id === "missingSearch" ? "input" : "change",
      render,
      {
        signal: events.signal,
      },
    ),
  );
  void load()
    .then(() => {
      if (view === "releases") void loadReleases();
      if (view === "discover") void loadDiscovery();
    })
    .catch(() => {});

  const applicationWindow = window as Window & {
    bookCollection?: { state: typeof state; rpc: typeof rpc };
  };
  applicationWindow.bookCollection = { state, rpc };
  return () => {
    events.abort();
    shelfList?.dispose();
    releaseList?.dispose();
    discoveryList?.dispose();
    missingBrowser?.dispose();
    stopScanner();
    coverObserver.disconnect();
    titleObserver.disconnect();
    clearTimeout(toastTimer);
    if (applicationWindow.bookCollection?.state === state)
      delete applicationWindow.bookCollection;
  };
}
