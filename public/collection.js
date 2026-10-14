// Collection controller. Talks only to this app’s same-origin Next.js API.

"use strict";
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
];
const $ = (id) => document.getElementById(id);
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
];
const state = {
  data: null,
  view: "collection",
  selectedSeries: null,
  seriesDetailsExpanded: false,
  page: 0,
  pageSize: 20,
  editing: null,
  busy: false,
  lookupGeneration: 0,
  scanGeneration: 0,
  scanPurpose: "add",
  cameraStart: null,
  cameraStream: null,
  cameraTimer: null,
  cameraRunning: false,
  photoTask: null,
  pendingSave: null,
  pendingRemove: null,
  restoreRequests: new Map(),
  checkGeneration: 0,
  checkResult: null,
  isbnBook: null,
  pendingIsbn: null,
  releaseFeeds: new Map(),
  releasesLoading: false,
  releasesLoaded: false,
  savingReleases: new Set(),
  seriesCatalogs: new Map(),
  catalogLoading: new Set(),
  catalogEditors: new Map(),
  catalogRefreshing: false,
  discoveryFeeds: new Map(),
  discoveryUrl: "https://www.phoenixnext.com/gl.html",
  discoveryLoading: false,
  selectedCoverId: "",
  discoveryTitleResults: new Map(),
  titleQueue: [],
  titleRequests: 0,
  discoveryRefresh: false,
  titleGeneration: 0,
  coverPickerGeneration: 0,
};
let toastTimer;
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}
function node(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function errorAt(id, error) {
  const e = $(id);
  e.textContent = error?.message || String(error);
  e.hidden = false;
}
function notify(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4200);
}
async function rpc(name, arg) {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arg }),
  });
  if (response.status === 401) {
    window.location.assign("/login");
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
function requestId() {
  return window.crypto?.randomUUID
    ? crypto.randomUUID()
    : "book_" + Date.now() + "_" + Math.random().toString(36).slice(2);
}
function number(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    value,
  );
}
function fillOptions(id, values, placeholder) {
  const e = $(id),
    previous = e.value;
  e.replaceChildren();
  if (placeholder !== undefined) {
    const o = node("option", "", placeholder);
    o.value = "";
    e.append(o);
  }
  values.forEach((v) => {
    const o = node("option", "", v);
    o.value = v;
    e.append(o);
  });
  if ([...e.options].some((o) => o.value === previous)) e.value = previous;
}
async function load() {
  $("refreshButton").disabled = true;
  $("pageError").hidden = true;
  try {
    state.data = await rpc("getCollection");
    ["series", "publisher", "source"].forEach((k) =>
      fillOptions(k + "Options", state.data.options[k]),
    );
    ["type", "status"].forEach((k) => {
      fillOptions(
        k + "Filter",
        state.data.options[k],
        "All " + (k === "type" ? "types" : "statuses"),
      );
      if (!$("bookDialog").open) fillOptions(k, state.data.options[k]);
    });
    fillOptions(
      "publisherFilter",
      state.data.options.publisher,
      "All publishers",
    );
    fillOptions("sourceFilter", state.data.options.source, "All stores");
    $("addButton").disabled = state.busy;
    $("checkBookButton").disabled = state.busy;
    $("syncNote").textContent =
      "Updated " +
      new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }) +
      " · Saved in your library";
    render();
    if (state.selectedSeries !== null && !state.catalogRefreshing)
      void loadSeriesCatalogs();
  } catch (error) {
    errorAt("pageError", error);
    if (!state.data)
      $("bookList").replaceChildren(
        node("div", "empty", "Your shelf could not be loaded. Try refreshing."),
      );
    throw error;
  } finally {
    $("refreshButton").disabled = false;
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
    stores = spendingGroups(books, (book) => String(book.source || "").trim()),
    priced = books.filter((book) => recordedPrice(book) !== null),
    missing = books.length - priced.length,
    unknownStores = priced.filter((book) => !String(book.source || "").trim());
  const note = (group) =>
    number(group.count) +
    (group.count === 1 ? " book" : " books") +
    " · " +
    number(group.priced) +
    " with prices";
  [
    ["Series", series],
    ["Store", stores],
  ].forEach(([kind, groups]) => {
    const top = groups[0];
    $("top" + kind + "Name").textContent =
      top?.name ||
      (kind === "Series"
        ? "No prices recorded yet"
        : "No store spending recorded yet");
    $("top" + kind + "Amount").textContent = top
      ? "฿" + number(top.total)
      : "—";
    $("top" + kind + "Note").textContent = top
      ? note(top) +
        (groups[1]?.total === top.total ? " · Tied for most spent" : "")
      : "Add purchase details to see your spending here.";
    const list = $(kind.toLowerCase() + "SpendingList");
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
      ? " Average paid: ฿" + number(spendingTotal(priced) / priced.length) + "."
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
  state.page = 0;
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
    ["type", "status", "publisher", "source"].every(
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
        books.reduce((date, book) => (book.date > date ? book.date : date), ""),
      difference = latest(bBooks).localeCompare(latest(aBooks));
    if (difference) return difference;
  }
  return grouped ? a.series.localeCompare(b.series) : byVolume(a.book, b.book);
}
function render() {
  if (!state.data) return;
  const releases = state.view === "releases";
  const discover = state.view === "discover";
  $("collectionBrowser").hidden = releases || discover;
  $("releasesPanel").hidden = !releases;
  $("discoverPanel").hidden = !discover;
  const { books, trash } = state.data;
  $("bookCount").textContent = number(books.length);
  $("activeCount").textContent = number(books.length);
  $("trashCount").textContent = number(trash.length);
  $("trashCount").hidden = !trash.length;
  $("seriesCount").textContent = number(
    new Set(books.map((b) => String(b.series).trim()).filter(Boolean)).size,
  );
  const read = books.filter((b) => b.status === "Read").length;
  $("readCount").textContent = number(read);
  $("readNote").textContent = books.length
    ? Math.round((read / books.length) * 100) + "%"
    : "";
  const prices = books.filter((book) => recordedPrice(book) !== null);
  $("spent").textContent = number(spendingTotal(books));
  const missingPrices = books.length - prices.length;
  $("priceNote").textContent = missingPrices
    ? number(missingPrices) +
      (missingPrices === 1 ? " book has" : " books have") +
      " no price"
    : "";
  const filters = collectionFilters(),
    filtered = Object.values(filters).some(Boolean),
    matches = (book) => matchesCollectionBook(book, filters);
  const grouped = state.view === "collection" && state.selectedSeries === null;
  $("collectionSort").options[0].textContent = grouped
    ? "Series A–Z"
    : state.view === "trash"
      ? "Recently removed"
      : "Volume order";
  $("collectionSort").querySelector('[value="books"]').disabled = !grouped;
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
    ["type", "publisher", "source"].map((field) => [
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
  // A series opens its entire owned-volume list, without paging it into separate screens.
  const pageSize =
    state.selectedSeries !== null
      ? Math.max(1, entries.length)
      : state.pageSize;
  const pages = Math.ceil(entries.length / pageSize);
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const start = state.page * pageSize,
    slice = entries.slice(start, start + pageSize);
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
          ? filtered
            ? "Matching books"
            : "Books"
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
  $("seriesHeader").hidden = state.selectedSeries === null;
  $("collectionHeading").hidden =
    releases || discover || state.selectedSeries !== null;
  $("collectionStats").hidden =
    releases || discover || state.selectedSeries !== null;
  $("collectionSpending").hidden = !grouped;
  if (grouped) renderCollectionSpending(books);
  $("seriesTitle").textContent = state.selectedSeries || "";
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
  $("addButton").replaceChildren(
    icon("plus"),
    document.createTextNode(
      state.selectedSeries !== null ? "Add volume" : "Add book",
    ),
  );
  $("search").placeholder = grouped
    ? "Search series, ISBN, publisher or notes…"
    : "Search volumes, ISBN, publisher or notes…";
  $("bookList")
    .querySelectorAll(".shelf-cover")
    .forEach((frame) => coverObserver.unobserve(frame));
  $("bookList").replaceChildren();
  if (!entries.length) {
    const empty = node("div", "empty");
    empty.append(
      node(
        "h2",
        "",
        state.view === "trash"
          ? "Nothing removed"
          : grouped
            ? "No series found"
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
    $("bookList").append(empty);
  }
  slice.forEach((entry) =>
    $("bookList").append(
      grouped ? seriesRow(entry) : bookRow(entry, sharedDetails),
    ),
  );
  $("pagination").hidden = pages <= 1;
  $("pageInfo").textContent =
    start +
    1 +
    "–" +
    Math.min(start + pageSize, entries.length) +
    " of " +
    entries.length;
  $("previousPage").disabled = state.page === 0;
  $("nextPage").disabled = state.page >= pages - 1;
  if (releases) renderReleases();
  if (discover) renderDiscovery();
}
function seriesKey(book) {
  return String(book.series || "").trim() || "Untitled series";
}
function byVolume(a, b) {
  const av = a.volume === "" || a.volume === null ? Infinity : Number(a.volume),
    bv = b.volume === "" || b.volume === null ? Infinity : Number(b.volume);
  return av - bv || a.row - b.row;
}
function ownedVolumeSummary(books) {
  const volumes = [
    ...new Set(
      books
        .filter((book) => book.volume !== "" && book.volume !== null)
        .map((book) => Number(book.volume))
        .filter(Number.isFinite),
    ),
  ].sort((a, b) => a - b);
  const ranges = [];
  volumes.forEach((volume) => {
    const last = ranges.at(-1);
    if (
      last &&
      Number.isInteger(last[1]) &&
      Number.isInteger(volume) &&
      volume === last[1] + 1
    )
      last[1] = volume;
    else ranges.push([volume, volume]);
  });
  const unnumbered = books.filter(
    (book) => book.volume === "" || book.volume === null,
  ).length;
  return [
    ranges.length
      ? "Vol. " +
        ranges
          .map(([from, to]) => (from === to ? String(from) : from + "–" + to))
          .join(", ")
      : "",
    unnumbered ? number(unnumbered) + " unnumbered" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function seriesRow(group) {
  const button = node("button", "series-row");
  button.disabled = state.busy;
  button.setAttribute(
    "aria-label",
    "Open " +
      group.series +
      ", " +
      group.books.length +
      (group.filtered ? " matching " : " owned ") +
      (group.books.length === 1 ? "volume" : "volumes"),
  );
  const info = node("span", "series-info");
  info.append(node("span", "series-name", group.series));
  const volumes = ownedVolumeSummary(group.books);
  info.append(
    node(
      "span",
      "series-meta",
      [
        [...new Set(group.books.map((b) => b.type).filter(Boolean))].join(
          " / ",
        ),
        volumes,
        group.books.some((book) => recordedPrice(book) !== null)
          ? "฿" + number(spendingTotal(group.books)) + " spent"
          : "No prices recorded",
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  const first = [...group.books].sort(byVolume)[0];
  button.append(bookCover(first, "shelf-cover"), info);
  const count = node("span", "series-total", String(group.books.length));
  button.append(count, node("span", "series-arrow", "›"));
  button.addEventListener("click", () => openSeries(group.series));
  return button;
}
function openSeries(series) {
  state.selectedSeries = series;
  state.seriesDetailsExpanded = false;
  state.page = 0;
  resetCollectionFilters();
  $("seriesReleaseError").hidden = true;
  $("seriesCatalogDetails").open = false;
  render();
  $("backSeries").focus();
  void loadSeriesCatalogs();
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
    $("seriesReleaseError").hidden = true;
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
            error: "Unable to check this series catalog. Try Refresh catalog.",
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
    ["luckpim", "yaakz"].includes(spec.publisherId)
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
  $("seriesReleaseError").hidden = true;
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
function seriesGaps(books) {
  const editions = new Map();
  books.forEach((b) => {
    const type = matchingBookType(b.type),
      key = JSON.stringify([type, publisherKey(b.publisher)]);
    if (!editions.has(key))
      editions.set(key, { type, publisher: b.publisher, books: [] });
    editions.get(key).books.push(b);
  });
  return [...editions.values()].map((edition) => {
    const volumes = [
      ...new Set(
        edition.books
          .filter((b) => b.volume !== "" && b.volume !== null)
          .map((b) => Number(b.volume))
          .filter(
            (v) => Number.isFinite(v) && v >= 1 && v <= Number.MAX_SAFE_INTEGER,
          ),
      ),
    ].sort((a, b) => a - b);
    const highest = volumes.length
        ? Math.floor(volumes[volumes.length - 1])
        : 0,
      ranges = [];
    let next = 1;
    volumes.filter(Number.isInteger).forEach((v) => {
      if (v > next) ranges.push([next, v - 1]);
      next = v + 1;
    });
    if (next <= highest) ranges.push([next, highest]);
    return {
      ...edition,
      highest,
      ranges,
      missing: ranges.reduce((sum, [from, to]) => sum + to - from + 1, 0),
    };
  });
}
function renderSeriesMissing() {
  const visible = state.view === "collection" && state.selectedSeries !== null;
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
        Number(a.item.volume || Infinity) - Number(b.item.volume || Infinity) ||
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
        add.addEventListener("click", () => {
          const source =
            [...edition.books]
              .sort(
                (a, b) =>
                  String(b.date || "").localeCompare(String(a.date || "")) ||
                  b.row - a.row,
              )
              .find((b) => b.source)?.source || "";
          openBook(null, { series: state.selectedSeries, volume: from });
          $("type").value = edition.type || "Other";
          $("publisher").value = edition.publisher || "";
          $("source").value = source;
          renderBookDetails();
        });
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
    ? "Catalog checks are available for Phoenix Next, First Page Pro and Luckpim."
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
  const searchBased = ["luckpim", "yaakz"].includes(spec.publisherId);
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
  toggle.addEventListener("click", () => void chooseSeriesCategory(spec));
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
      "Series title on " + (spec.publisherId === "yaakz" ? "Yaakz" : "Luckpim"),
      manual,
    );
    manual.addEventListener("input", () => (editor.url = manual.value));
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
    search.addEventListener("input", () => {
      editor.search = search.value;
      options();
    });
    selected.addEventListener("change", () => {
      editor.selected = selected.value;
      manual.value = "";
      editor.url = "";
    });
    manual = node("input");
    manual.type = "url";
    manual.placeholder =
      spec.publisherId === "phoenix"
        ? "https://www.phoenixnext.com/book-series/…"
        : "https://www.firstpagepro.com/category/…";
    manual.value = editor.url || "";
    field("Or paste the series category URL", manual);
    manual.addEventListener("input", () => {
      editor.url = manual.value;
      editor.selected = "";
      selected.value = "";
    });
    if (editor.loading) form.append(node("p", "hint", "Loading categories…"));
    if (editor.error) form.append(node("p", "source-error", editor.error));
  }
  const submit = node("button", "btn", "Use this catalog");
  submit.type = "submit";
  submit.disabled = busy || editor.loading;
  form.append(submit);
  form.addEventListener("submit", (event) => {
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
  });
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
  ["type", "publisher", "source"].forEach((k) => {
    defaults[k] = edition.find((b) => String(b[k] ?? "").trim())?.[k] || "";
    if (defaults[k] && k !== "source")
      edition = edition.filter((b) => b[k] === defaults[k]);
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
    ]) {
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
        type: $("titleEditionType" + index).value,
        publisher: $("titleEditionPublisher" + index).value,
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
    state.selectedSeries = result.series;
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
        ["type", "publisher", "source"].map((k) => [k, $(k).value]),
      );
    ["type", "publisher", "source"].forEach(
      (k) =>
        ($(k).value = series
          ? defaults[k] || (k === "type" ? "Manga (TH)" : "")
          : state.sharedDraft[k]),
    );
    state.formSeries = series;
    state.newEdition = false;
    state.detailsExpanded = false;
    $("priceCalculator").open =
      !series || $("regularPrice").value !== "" || $("discount").value !== "";
  }
  renderBookDetails();
}
function renderBookDetails() {
  const quick = !!state.formSeries && !state.editing;
  const editions = state.formSeries ? titleEditions(state.formSeries) : [];
  const editionKey = JSON.stringify([$("type").value, $("publisher").value]);
  const inherited =
    editions.some((edition) => edition.key === editionKey) && !state.newEdition;
  const titleFields = !state.editing && !inherited;
  $("titleNameField").hidden = state.titleLocked;
  $("titleEntry").hidden = state.titleLocked && !titleFields;
  $("bookForm")
    .querySelectorAll("[data-title-field]")
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
    .querySelectorAll("[data-series-detail]")
    .forEach((e) => (e.hidden = quick && !state.detailsExpanded));
  $("seriesDefaults").hidden = !state.formSeries;
  $("seriesDefaultsText").textContent =
    state.formSeries +
    " · " +
    [$("type").value, $("publisher").value].filter(Boolean).join(" · ");
  $("toggleBookDetails").textContent = state.detailsExpanded
    ? "Hide other volume details"
    : "Edit other volume details";
  $("toggleBookDetails").hidden = !!state.editing;
  $("toggleBookDetails").setAttribute(
    "aria-expanded",
    String(!!state.detailsExpanded),
  );
  $("bookDialogSubtitle").textContent = state.editing
    ? "Edit this volume’s ISBN, reading status and purchase details."
    : quick
      ? "Enter the volume, store, reading status, price and date bought."
      : "Scan an ISBN or fill in the details yourself.";
  $("keepAddingText").textContent = quick
    ? "Keep adding volumes to this series"
    : "Keep adding books with the same type, publisher and shop";
  $("saveButton").textContent = state.editing
    ? "Save changes"
    : quick
      ? "Add volume"
      : "Add book";
}
function bookRow(entry, sharedDetails = {}) {
  const b = entry.book,
    row = node("article", "book-row");
  const details = node("div", "book-info"),
    info = node("div", "book-copy");
  info.append(
    node(
      "h2",
      "book-title",
      state.selectedSeries !== null
        ? b.volume !== "" && b.volume !== null
          ? "Volume " + b.volume
          : "Unnumbered book"
        : b.series || "Untitled book",
    ),
  );
  const meta = node("div", "book-meta");
  [
    state.selectedSeries === null && b.volume !== "" && b.volume !== null
      ? "Vol. " + b.volume
      : "",
    b.type !== sharedDetails.type ? b.type : "",
    b.publisher !== sharedDetails.publisher ? b.publisher : "",
    b.isbn
      ? "ISBN " + b.isbn
      : b.source !== sharedDetails.source
        ? b.source
        : "",
  ]
    .filter(Boolean)
    .forEach((t) => meta.append(node("span", "", t)));
  info.append(meta);
  if (state.view === "collection" && !canonical(b.isbn) && !b.isbnHasFormula) {
    const addIsbn = node("button", "isbn-add", "Add ISBN");
    addIsbn.prepend(icon("scan"));
    addIsbn.setAttribute(
      "aria-label",
      "Add ISBN to " +
        b.series +
        (b.volume !== "" ? ", volume " + b.volume : ""),
    );
    addIsbn.disabled = state.busy;
    addIsbn.addEventListener("click", () => openIsbn(b));
    meta.append(addIsbn);
  }
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
  if (state.view === "trash") {
    const restore = node("button", "btn restore", "Restore book");
    restore.disabled = state.busy;
    restore.addEventListener("click", () => restoreEntry(entry, restore));
    row.append(restore);
  } else {
    row.append(
      node(
        "div",
        "price",
        b.price !== "" && b.price !== null ? number(Number(b.price)) : "—",
      ),
    );
    const menu = node("details", "volume-actions");
    const trigger = node("summary", "row-action", "⋯");
    trigger.setAttribute(
      "aria-label",
      "Volume options for " +
        b.series +
        (b.volume !== "" ? ", volume " + b.volume : ""),
    );
    trigger.setAttribute("role", "button");
    const actions = node("div", "volume-menu");
    const edit = node("button", "volume-menu-item", "Edit metadata");
    edit.type = "button";
    edit.setAttribute(
      "aria-label",
      "Edit " + b.series + (b.volume !== "" ? ", volume " + b.volume : ""),
    );
    edit.disabled = state.busy;
    edit.addEventListener("click", () => {
      menu.open = false;
      openBook(b);
    });
    const cover = node("button", "volume-menu-item", "Change cover");
    cover.type = "button";
    cover.disabled = state.busy;
    cover.addEventListener("click", () => {
      menu.open = false;
      openBook(b);
      $("metadataManager").scrollIntoView({ block: "nearest" });
      $("pullPublisherCovers").focus();
    });
    actions.append(edit, cover);
    const publisherUrl = bookPublisherUrl(b);
    if (publisherUrl) {
      const link = releaseLink("Publisher site ↗", publisherUrl);
      link.className = "volume-menu-item";
      actions.append(link);
    }
    menu.append(trigger, actions);
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        const publisherLink = actions.querySelector("a");
        if (publisherLink) publisherLink.href = bookPublisherUrl(b);
        document.querySelectorAll(".volume-actions[open]").forEach((other) => {
          if (other !== menu) other.open = false;
        });
      }
    });
    row.append(menu);
  }
  return row;
}
function changeView(view) {
  state.view = view;
  state.selectedSeries = null;
  state.page = 0;
  ["collection", "trash", "releases", "discover"].forEach((k) => {
    $(k + "Tab").classList.toggle("active", k === view);
    $(k + "Tab").setAttribute("aria-pressed", String(k === view));
  });
  render();
  if (view === "releases" && !state.releasesLoaded) void loadReleases();
  if (view === "discover" && !state.discoveryFeeds.has(state.discoveryUrl))
    void loadDiscovery();
}
function releaseSeriesKey(title) {
  return String(title || "")
    .replace(/^\[PRE-ORDER\]\s*/i, "")
    .replace(/^(?:\(LN\)|\(มังงะ\)|\(นิยาย\)|นิยาย|การ์ตูน)\s*/i, "")
    .replace(
      /^(?:(?:special|complete|ultimate|limited)(?:\s+combo)?\s+(?:set|edition)|box\s+set)\s+(?:[AB]\s+)?(?:\(Exclusive Pre-order Period\)\s*)?/i,
      "",
    )
    .replace(/\s*\((?:ฉบับพิเศษ|ปกพิเศษ)\)\s*$/i, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/@comic/gi, "")
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}
function matchingBookType(type) {
  return String(type || "")
    .replace(/\s*\(colou?r\)/gi, "")
    .trim();
}
function releaseSingleVolume(item) {
  if (
    item.volume === "" ||
    item.volume == null ||
    !Number.isFinite(Number(item.volume))
  )
    return false;
  if (
    item.bundle ||
    /box\s*set|ครบชุด|ยกชุด|(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*\d+(?:\.\d+)?\s*(?:[-–—~]|ถึง)\s*\d/i.test(
      item.title,
    )
  )
    return false;
  // A special listing needs a stated volume; a set's guessed first volume is not coverage.
  return (
    !item.special ||
    /(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*\d+(?:\.\d+)?/i.test(item.title)
  );
}
function publisherKey(name) {
  const key = String(name || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
  if (/phoenix|ฟีนิกซ์/.test(key)) return "phoenix";
  if (/firstpage|เฟิร์สเพจ/.test(key)) return "firstpage";
  if (/luckpim|รักพิมพ์/.test(key)) return "luckpim";
  if (/yaakz|siaminter|สยามอินเตอร์|^sic$/.test(key)) return "yaakz";
  return key;
}
function releaseMatches(item) {
  const books = state.data.books,
    isbn = canonical(item.isbn);
  const owned = isbn ? books.filter((b) => canonical(b.isbn) === isbn) : [];
  const series = books.filter(
    (b) =>
      releaseSeriesKey(b.series) ===
        releaseSeriesKey(item.catalogSeries || item.series) &&
      publisherKey(b.publisher) === item.publisherId &&
      (!item.type || matchingBookType(b.type) === matchingBookType(item.type)),
  );
  const possible =
    releaseSingleVolume(item) &&
    (!item.catalogVariant ||
      releaseSeriesKey(item.series) === releaseSeriesKey(item.catalogSeries))
      ? series.filter(
          (b) =>
            b.volume !== "" &&
            b.volume !== null &&
            Number(b.volume) === Number(item.volume),
        )
      : [];
  return { owned, series, possible };
}
async function loadReleases(refresh = false) {
  if (!state.data || state.releasesLoading) return;
  state.releasesLoading = true;
  $("releaseError").hidden = true;
  $("seriesReleaseError").hidden = true;
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
  (state.data.savedReleases || []).forEach((item) => items.set(item.id, item));
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
function setCoverImage(frame, id, title) {
  if (frame._coverId === (id || "")) return;
  frame._coverId = id || "";
  frame.replaceChildren();
  const placeholder = node("span", "cover-placeholder", "No cover");
  placeholder.prepend(icon("books"));
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
  img.addEventListener("load", () => {
    if (!failed) placeholder.hidden = true;
  });
  img.addEventListener("error", () => {
    failed = true;
    img.remove();
    placeholder.hidden = false;
  });
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
  document.querySelectorAll(".cover-choice").forEach((choice) => {
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
      choice.addEventListener("click", () => {
        if (state.busy) return;
        state.selectedCoverId = item.coverId;
        $("coverUrl").value = item.coverUrl;
        if (item.publisherUrl) $("publisherUrl").value = item.publisherUrl;
        renderMetadataCover();
      });
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
  const title =
    book.series + (book.volume !== "" ? ", volume " + book.volume : "");
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
        book.series + (book.volume !== "" ? ", volume " + book.volume : ""),
      );
  });
}

async function loadDiscovery(refresh = false) {
  if (!state.data || state.discoveryLoading) return;
  const url = $("discoveryUrl").value.trim();
  state.discoveryUrl = url;
  state.discoveryLoading = true;
  $("discoveryError").hidden = true;
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
function discoveryTitles(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.publisherId + ":" + releaseSeriesKey(item.series);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const owned = state.data.books;
  const aliases = state.data.seriesCatalogs || [];
  const rank = (item) =>
    item.bundle
      ? 5
      : Number(item.volume) === 1
        ? item.special
          ? 1
          : 0
        : item.special
          ? 4
          : 2;
  return [...groups.values()]
    .filter(
      (list) =>
        !owned.some((book) =>
          list.some(
            (item) =>
              (canonical(item.isbn) &&
                canonical(item.isbn) === canonical(book.isbn)) ||
              (publisherKey(book.publisher) === item.publisherId &&
                (releaseSeriesKey(book.series) ===
                  releaseSeriesKey(item.series) ||
                  aliases.some(
                    (alias) =>
                      alias.publisherId === item.publisherId &&
                      releaseSeriesKey(alias.series) ===
                        releaseSeriesKey(book.series) &&
                      releaseSeriesKey(alias.title) ===
                        releaseSeriesKey(item.series),
                  ))),
          ),
        ),
    )
    .map((list) => {
      list.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.volume === "" ? Infinity : Number(a.volume)) -
            (b.volume === "" ? Infinity : Number(b.volume)) ||
          Number(/\[แถม|\[ฟรี/.test(a.title)) -
            Number(/\[แถม|\[ฟรี/.test(b.title)) ||
          a.title.localeCompare(b.title),
      );
      const first = list[0];
      return {
        ...first,
        coverId:
          first.coverId ||
          list.find((item) => item.volume === first.volume && item.coverId)
            ?.coverId ||
          "",
      };
    })
    .sort((a, b) => a.series.localeCompare(b.series));
}

function discoveryTitleKey(item) {
  return JSON.stringify(item.categories.map((category) => category.url).sort());
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
  if (!state.data) return;
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
            " titles from publisher navigation",
        ),
      );
    if (feed.error) source.append(node("p", "source-error", feed.error));
  }
  const all = discoveryTitles(
    (
      feed?.titles ||
      (feed?.items || []).map((item) => ({
        ...item,
        resolved: true,
        categories: [{ url: feed.url, type: item.type }],
      }))
    ).map((entry) => {
      const result = state.discoveryTitleResults.get(discoveryTitleKey(entry));
      return result?.item
        ? {
            ...result.item,
            categories: entry.categories,
            series: entry.series,
            catalogSeries: entry.series,
            directory: true,
            resolved: true,
            categoryUrl: entry.url,
          }
        : entry;
    }),
  );
  const query = $("discoverySearch").value.trim().toLocaleLowerCase();
  const items = all.filter(
    (item) => !query || item.series.toLocaleLowerCase().includes(query),
  );
  $("discoveryCount").textContent = state.discoveryLoading
    ? "Reading the publisher category…"
    : number(items.length) +
      (items.length === 1 ? " title" : " titles") +
      " you haven’t started";
  const list = $("discoveryList");
  list
    .querySelectorAll(".discovery-card")
    .forEach((card) => titleObserver.unobserve(card));
  list.replaceChildren();
  if (!items.length) {
    const empty = node("div", "empty");
    empty.append(
      node(
        "h2",
        "",
        state.discoveryLoading
          ? "Finding your next series…"
          : !feed || feed.stale
            ? "Load a publisher category"
            : query
              ? "No titles match these filters"
              : "No new titles in this category",
      ),
      node(
        "p",
        "",
        state.discoveryLoading
          ? "Checking category pages for titles and first volumes."
          : "Try another category or adjust your search. Titles already on your shelf are hidden.",
      ),
    );
    list.append(empty);
  }
  const saved = new Set(
    (state.data.savedReleases || []).map((item) => item.id),
  );
  for (const item of items) {
    const card = node("article", "discovery-card");
    const result = state.discoveryTitleResults.get(discoveryTitleKey(item));
    card._title = item;
    if (!item.resolved) titleObserver.observe(card);
    const coverLink = releaseLink("", item.url);
    coverLink.setAttribute(
      "aria-label",
      "Open " + item.series + " on the publisher website",
    );
    coverLink.append(coverImage(item.coverId, item.title, "discovery-cover"));
    card.append(
      coverLink,
      node("p", "eyebrow", item.publisher),
      node("h2", "book-title", item.series),
      node(
        "p",
        "release-meta",
        !item.resolved
          ? result && !result.loading
            ? result.complete && !result.item
              ? "No current book listing"
              : "Cover unavailable"
            : "Loading first-volume cover…"
          : [
              item.type,
              item.bundle
                ? "Set listing"
                : item.volume === ""
                  ? "Single book / unnumbered"
                  : "Volume " + item.volume,
              item.volume !== 1 && item.volume !== ""
                ? "Volume 1 not listed"
                : "",
              item.special ? "Special edition" : "",
            ]
              .filter(Boolean)
              .join(" · "),
      ),
    );
    if (result?.error) card.append(node("p", "source-error", result.error));
    const actions = node("div", "buttons");
    const saveButton = node(
      "button",
      "btn",
      saved.has(item.id) ? "Saved · Unsave" : "Save for later",
    );
    saveButton.disabled = !item.resolved || state.savingReleases.size > 0;
    saveButton.setAttribute("aria-pressed", String(saved.has(item.id)));
    saveButton.addEventListener(
      "click",
      () => void saveRelease(item, !saved.has(item.id)),
    );
    actions.append(saveButton);
    const add = node("button", "btn", "Add to shelf");
    add.disabled = !item.resolved || state.busy;
    add.addEventListener("click", () =>
      openRelease(item, releaseMatches(item)),
    );
    actions.append(add);
    card.append(
      releaseLink(
        item.resolved ? "Publisher book page ↗" : "Publisher title category ↗",
        item.url,
      ),
      actions,
    );
    list.append(card);
  }
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
  if (!state.data) return;
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
  const items = allItems.filter((item) => {
    const match = releaseMatches(item);
    return (
      (!publisher || item.publisherId === publisher) &&
      (!query ||
        [item.title, item.publisher, item.isbn]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)) &&
      (!type || String(item.type || "").startsWith(type)) &&
      (!hideSpecial || !item.special) &&
      (scope !== "saved" || saved.has(item.id)) &&
      (scope !== "series" || match.series.length > 0) &&
      (scope !== "unbought" ||
        (!match.owned.length && !match.possible.length)) &&
      (scope !== "review" ||
        (!match.owned.length && match.possible.length > 0)) &&
      (scope !== "owned" || match.owned.length > 0)
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
  $("releaseList").replaceChildren();
  if (!items.length) {
    const empty = node("div", "empty");
    const failed = [...state.releaseFeeds.values()].some((f) => f.error);
    const filtered = (type || hideSpecial) && !failed && !state.releasesLoading;
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
        filtered
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
  items.forEach((item) =>
    $("releaseList").append(releaseCard(item, saved.has(item.id))),
  );
  renderSeriesMissing();
}
function releaseCard(item, saved, context = {}) {
  const card = node("article", "release-card"),
    match = releaseMatches(item),
    busy = state.savingReleases.size > 0 || state.busy;
  card.append(coverImage(item.coverId, item.title, "release-cover"));
  card.append(
    node("p", "eyebrow", item.publisher),
    node("h2", "book-title", item.title),
  );
  const meta = [
    item.type,
    item.volume !== "" ? "Volume " + item.volume : "",
    item.special ? "Special edition / set" : "",
    item.availability,
  ].filter(Boolean);
  card.append(node("p", "release-meta", meta.join(" · ")));
  if (item.price !== "")
    card.append(
      node("p", "release-price", "Listed price ฿" + number(Number(item.price))),
    );
  if (item.isbn) card.append(node("p", "hint", "ISBN " + item.isbn));
  if (
    saved &&
    !context.catalog &&
    state.releasesLoaded &&
    ![...state.releaseFeeds.values()].some((feed) =>
      feed.items.some((release) => release.id === item.id),
    )
  )
    card.append(node("p", "hint", "Saved listing · Not in the latest check"));
  if (match.owned.length)
    card.append(node("p", "release-match", "On your shelf · ISBN match"));
  else if (match.possible.length)
    card.append(
      node(
        "p",
        "release-match possible",
        "Volume on your shelf · Check the edition",
      ),
    );
  else if (context.review)
    card.append(
      node(
        "p",
        "release-match possible",
        "Other edition or set · Check the details",
      ),
    );
  else
    card.append(
      node("p", "release-match unbought", "Not bought yet · No shelf match"),
    );
  if (match.series.length && !match.owned.length)
    card.append(node("p", "hint", "A series you collect"));
  const links = node("div", "release-links");
  links.append(releaseLink("Publisher book page ↗", item.url));
  if (item.isbn)
    links.append(
      releaseLink(
        "Find at Naiin ↗",
        "https://www.naiin.com/search-result?title=" +
          encodeURIComponent(item.isbn),
      ),
    );
  card.append(links);
  if (context.alternatives?.length) {
    const alternatives = node("details", "publisher-details");
    alternatives.append(
      node(
        "summary",
        "",
        "Other listings for this volume (" + context.alternatives.length + ")",
      ),
    );
    context.alternatives.forEach((other) =>
      alternatives.append(
        node("p", "release-links"),
        releaseLink(other.title + " ↗", other.url),
      ),
    );
    card.append(alternatives);
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
  saveButton.addEventListener("click", () => void saveRelease(item, !saved));
  buttons.append(saveButton);
  const add = node(
    "button",
    "btn",
    match.owned.length ? "View owned series" : "Add to shelf",
  );
  add.disabled = busy;
  add.addEventListener("click", () => {
    if (match.owned.length) {
      changeView("collection");
      openSeries(seriesKey(match.owned[0]));
    } else openRelease(item, match);
  });
  buttons.append(add);
  card.append(buttons);
  return card;
}
async function saveRelease(item, saved) {
  if (state.savingReleases.size > 0) return;
  state.savingReleases.add(item.id);
  $("releaseError").hidden = true;
  $("seriesReleaseError").hidden = true;
  $("discoveryError").hidden = true;
  renderReleases();
  renderDiscovery();
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
  }
}
function openRelease(item, match) {
  const series = item.catalogVariant
    ? item.series
    : match.series[0]?.series || item.catalogSeries || item.series;
  openBook(null, {
    series,
    volume: item.volume,
    isbn: item.isbn,
    type: item.type || "Other",
    publisher: item.publisher,
    source: item.publisher,
  });
  // A publisher listing identifies this edition; do not inherit another language or shop.
  $("type").value = item.type || "Other";
  state.typeTouched = true;
  $("publisher").value = item.publisher;
  $("source").value = item.publisher;
  state.detailsExpanded = true;
  renderBookDetails();
  $("lookupResult").hidden = false;
  $("lookupResult").replaceChildren(
    node("strong", "", item.title),
    document.createTextNode(
      "Review this edition and enter the amount you paid before saving. " +
        (item.special
          ? "This is a special edition or set; check the series and volume carefully."
          : ""),
    ),
  );
}

function clearLookup() {
  state.lookupGeneration++;
  $("lookupResult").hidden = true;
  $("lookupButton").disabled = false;
  $("lookupButton").textContent = "Look up";
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
async function checkBook(event) {
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
    // Keep the browsing and manual-check lists in step with this fresh sheet read.
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
  button.addEventListener("click", () => {
    if (canLink) {
      openIsbn(book, state.checkResult.isbn);
    } else {
      closeCheck();
      changeView("collection");
      openSeries(seriesKey(book));
    }
  });
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
    .sort((a, b) => seriesKey(a).localeCompare(seriesKey(b)) || byVolume(a, b));
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
        ownershipBook(
          b,
          !!state.checkResult?.isbn && !canonical(b.isbn) && !b.isbnHasFormula,
        ),
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
  if (state.busy || !state.isbnBook || !$("isbnForm").reportValidity()) return;
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
            (b) =>
              seriesKey(b) === seriesKey(book) &&
              !canonical(b.isbn) &&
              !b.isbnHasFormula,
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
function openBook(book, defaults) {
  if (state.busy || !state.data) return;
  state.editing = book || null;
  state.typeTouched = false;
  state.pendingSave = null;
  state.pendingRemove = null;
  state.formSeries = book ? seriesKey(book) : null;
  state.titleLocked =
    !!book || (!!defaults?.series && defaults.series === state.selectedSeries);
  state.newEdition = false;
  state.sharedDraft = null;
  state.detailsExpanded = false;
  $("bookForm").reset();
  resetPricing();
  $("formError").hidden = true;
  clearLookup();
  ["type", "status"].forEach((k) => fillOptions(k, state.data.options[k]));
  FIELDS.forEach((k) => ($(k).value = book?.[k] ?? defaults?.[k] ?? ""));
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
  $("priceCalculator").open = true;
  syncSeriesSelection();
  if (!book && defaults?.type && defaults.publisher !== undefined) {
    $("type").value = defaults.type;
    $("publisher").value = defaults.publisher;
    renderBookDetails();
  }
  $("saveButton").disabled = !!book?.hasFormula;
  $("removeButton").disabled = !!book?.hasFormula;
  if (book?.hasFormula)
    errorAt(
      "formError",
      "This row contains a formula. Edit it directly in the sheet to preserve the formula.",
    );
  $("bookDialog").showModal();
  (state.formSeries ? $("volume") : $("isbn")).focus();
}
function resetPricing() {
  state.calculatedPrice = null;
  $("regularPrice").setCustomValidity("");
  $("discount").setCustomValidity("");
  $("discount").max = "100";
  $("discountHint").textContent = "Enter a percentage from 0 to 100.";
  $("priceSummary").hidden = true;
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
      discount.setCustomValidity("Enter the regular price to use a discount.");
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
    initial = { series: $("series").value, publisher: $("publisher").value };
  $("lookupButton").disabled = true;
  $("lookupButton").textContent = "Looking…";
  $("lookupResult").hidden = false;
  $("lookupResult").textContent = "Looking up this edition…";
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
        ". Review the series name and volume before saving.";
      if (!initial.series && !$("series").value)
        $("series").value = d.series || d.title;
      if (
        !state.formSeries &&
        !state.editing &&
        !initial.publisher &&
        !$("publisher").value
      )
        $("publisher").value = d.publisher;
      syncSeriesSelection();
      if (d.volume !== undefined && d.volume !== "" && !$("volume").value)
        $("volume").value = d.volume;
      if (d.type && !state.formSeries && !state.editing && !state.typeTouched)
        $("type").value = d.type;
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
    $("lookupResult").textContent = message;
    if (result.searchUrl) {
      $("lookupResult").append(
        document.createTextNode("\n"),
        releaseLink("Search this ISBN at Naiin ↗", result.searchUrl),
      );
    }
  } catch (error) {
    if (generation === state.lookupGeneration)
      $("lookupResult").textContent = error.message || String(error);
  } finally {
    if (generation === state.lookupGeneration) {
      $("lookupButton").disabled = false;
      $("lookupButton").textContent = "Look up";
    }
  }
}
function setBusy(busy) {
  state.busy = busy;
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
  ].forEach((id) => ($(id).disabled = busy));
  $("bookForm")
    .querySelectorAll("input,select,textarea")
    .forEach((e) => (e.disabled = busy));
  $("isbnForm")
    .querySelectorAll("input")
    .forEach((e) => (e.disabled = busy));
  $("titleForm")
    .querySelectorAll("input,select")
    .forEach((e) => (e.disabled = busy));
}
async function save(event) {
  event.preventDefault();
  if (state.busy || !$("bookForm").reportValidity()) return;
  clearLookup();
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
            ["type", "publisher", "source", "status", "date"].map((k) => [
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
// Match the server's ISBN rules before accepting a camera result.
function canonical(raw) {
  let v = String(raw ?? "")
      .trim()
      .replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "")
      .replace(/[\s-]/g, "")
      .toUpperCase(),
    sum = 0;
  if (/^\d{9}[\dX]$/.test(v)) {
    for (let i = 0; i < 10; i++)
      sum += (v[i] === "X" ? 10 : Number(v[i])) * (10 - i);
    if (sum % 11) return "";
    v = "978" + v.slice(0, 9);
    sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(v[i]) * (i % 2 ? 3 : 1);
    return v + ((10 - (sum % 10)) % 10);
  }
  if (!/^97[89]\d{10}$/.test(v)) return "";
  for (let i = 0; i < 13; i++) sum += Number(v[i]) * (i % 2 ? 3 : 1);
  return sum % 10 ? "" : v;
}
const scannerScripts = new Map();
function loadScannerScript(url) {
  if (!scannerScripts.has(url))
    scannerScripts.set(
      url,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        const timer = setTimeout(() => {
          script.remove();
          scannerScripts.delete(url);
          reject(
            new Error(
              "The photo reader could not load. Check your connection or type the ISBN.",
            ),
          );
        }, 20000);
        script.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        script.onerror = () => {
          clearTimeout(timer);
          script.remove();
          scannerScripts.delete(url);
          reject(
            new Error(
              "The photo reader could not load. Check your connection or type the ISBN.",
            ),
          );
        };
        document.head.append(script);
      }),
    );
  return scannerScripts.get(url);
}
function scanActive(generation) {
  return generation === state.scanGeneration && $("scanDialog").open;
}
function requireScan(generation) {
  if (!scanActive(generation))
    throw new DOMException("Scan cancelled", "AbortError");
}
function stopScanner() {
  state.scanGeneration++;
  clearTimeout(state.cameraTimer);
  state.cameraTimer = null;
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  const video = $("scannerArea").querySelector("video");
  if (video) {
    video.pause();
    video.srcObject = null;
    video.remove();
  }
  state.cameraRunning = false;
  state.cameraStart = null;
  const task = state.photoTask;
  state.photoTask = null;
  task?.cancel();
  if (task?.worker) {
    void task.worker.terminate().catch(() => {});
    task.worker = null;
  }
  $("startCamera").disabled = false;
  $("stopCamera").hidden = true;
  $("startCamera").hidden = false;
  $("scanCandidates").hidden = true;
  $("scanCandidates").replaceChildren();
}
function closeScanner() {
  stopScanner();
  $("scanDialog").close();
}
function openScanner(purpose) {
  stopScanner();
  $("scannerArea").replaceChildren();
  state.scanPurpose = purpose;
  $("scanTitle").textContent =
    purpose === "check"
      ? "Check a bookstore book"
      : purpose === "link"
        ? "Scan the ISBN for this volume"
        : "Scan a book";
  $("scanMessage").textContent =
    "Take or choose a photo including the barcode and printed ISBN. Photos stay on your device.";
  $("scanDialog").showModal();
}
async function acceptScan(raw, generation) {
  if (!scanActive(generation)) return;
  const isbn = canonical(raw);
  if (!isbn) {
    $("scanMessage").textContent =
      "This barcode is not an ISBN. Take a photo that also includes the printed ISBN.";
    return;
  }
  $("scanMessage").textContent = "ISBN found: " + isbn;
  const purpose = state.scanPurpose;
  closeScanner();
  if (purpose === "check") {
    if (!$("checkDialog").open) return;
    $("checkIsbn").value = isbn;
    await checkBook();
  } else if (purpose === "link") {
    if (!$("isbnDialog").open) return;
    $("linkIsbn").value = isbn;
    $("isbnError").hidden = true;
    $("saveIsbnButton").focus();
  } else {
    if (!$("bookDialog").open) return;
    $("isbn").value = isbn;
    clearLookup();
    await lookup();
  }
}
function reviewScan(isbns, generation, printed = false) {
  requireScan(generation);
  const choices = $("scanCandidates");
  choices.replaceChildren();
  choices.hidden = false;
  $("scanMessage").textContent = printed
    ? "Printed ISBN found. Check these digits against the cover, then choose Use ISBN."
    : "Several ISBNs found. Choose the one for this book.";
  isbns.forEach((isbn) => {
    const button = node("button", "btn primary", "Use ISBN " + isbn);
    button.type = "button";
    button.addEventListener("click", () => void acceptScan(isbn, generation));
    choices.append(button);
  });
}
function photoCanvas(image, maxSide = 2200) {
  const width = image.naturalWidth || image.videoWidth || image.width,
    height = image.naturalHeight || image.videoHeight || image.height;
  const scale = Math.min(1, maxSide / Math.max(width, height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
async function readBarcodes(canvas, generation) {
  if (typeof ZXingWASM === "undefined")
    await loadScannerScript(
      "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.5/dist/iife/reader/index.js",
    );
  requireScan(generation);
  return ZXingWASM.readBarcodes(
    canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height),
    {
      formats: ["EAN13"],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      maxNumberOfSymbols: 8,
    },
  );
}
function printedIsbns(text) {
  const normalized = String(text).replace(/[\u2010-\u2015\u2212]/g, "-"),
    found = new Set();
  // Keep separate OCR lines separate and only accept complete, checksum-valid numbers.
  for (const line of normalized.split(/\r?\n/)) {
    for (const match of line.matchAll(/\b97[89](?:[ \t-]*\d){10}\b/g)) {
      const isbn = canonical(match[0]);
      if (isbn) found.add(isbn);
    }
    for (const match of line.matchAll(
      /\bISBN(?:-10)?[ \t:]*((?:\d[ \t-]*){9}[\dX])\b/gi,
    )) {
      const isbn = canonical(match[1]);
      if (isbn) found.add(isbn);
    }
  }
  return [...found];
}
function photoStep(promise, task) {
  return Promise.race([
    promise,
    task.cancelled.then(() => {
      throw new DOMException("Scan cancelled", "AbortError");
    }),
  ]);
}
async function readPrintedIsbns(canvas, generation, task) {
  $("scanMessage").textContent =
    "Looking for the printed ISBN… The first text scan may take a moment.";
  if (typeof Tesseract === "undefined")
    await photoStep(
      loadScannerScript(
        "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js",
      ),
      task,
    );
  requireScan(generation);
  const worker = await photoStep(
    Tesseract.createWorker("eng", 1, {
      workerPath:
        "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0",
      langPath:
        "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
    }).then((worker) => {
      if (!scanActive(generation)) {
        void worker.terminate().catch(() => {});
        throw new DOMException("Scan cancelled", "AbortError");
      }
      task.worker = worker;
      return worker;
    }),
    task,
  );
  try {
    requireScan(generation);
    await photoStep(
      worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      }),
      task,
    );
    // Tesseract consumes the same oriented, bounded canvas as the barcode reader.
    const result = await photoStep(worker.recognize(canvas), task);
    requireScan(generation);
    const found = printedIsbns(result.data.text);
    if (found.length) return found;
    // Small text beside decorative barcodes can be missed in a whole-cover layout.
    // Overlapping, enlarged regions preserve context without exceeding phone canvas limits.
    for (const [left, top] of [
      [0, 0],
      [0.35, 0],
      [0, 0.35],
      [0.35, 0.35],
    ]) {
      requireScan(generation);
      const region = document.createElement("canvas"),
        width = canvas.width * 0.65,
        height = canvas.height * 0.65,
        scale = 2200 / Math.max(width, height);
      region.width = Math.round(width * scale);
      region.height = Math.round(height * scale);
      const context = region.getContext("2d");
      context.drawImage(
        canvas,
        left * canvas.width,
        top * canvas.height,
        width,
        height,
        0,
        0,
        region.width,
        region.height,
      );
      try {
        const result = await photoStep(worker.recognize(region), task);
        requireScan(generation);
        const found = printedIsbns(result.data.text);
        if (found.length) return found;
      } finally {
        region.width = region.height = 1;
      }
    }
    return [];
  } finally {
    if (task.worker === worker) {
      task.worker = null;
      await worker.terminate();
    }
  }
}
async function startCamera() {
  if (state.cameraStart || state.cameraRunning) return;
  stopScanner();
  $("scannerArea").replaceChildren();
  const generation = state.scanGeneration;
  if (!navigator.mediaDevices?.getUserMedia) {
    $("scanMessage").textContent =
      "Live camera access is unavailable here. Use Take photo or Choose photo.";
    return;
  }
  $("scanMessage").textContent =
    "Allow camera access, then hold the ISBN barcode steady.";
  $("startCamera").disabled = true;
  // Request permission directly from the button gesture, before any library loading.
  let pending, stream;
  try {
    pending = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    state.cameraStart = pending;
    stream = await pending;
    if (!scanActive(generation)) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.cameraStream = stream;
    const video = node("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.srcObject = stream;
    video.style.cssText =
      "display:block;width:100%;max-height:45dvh;object-fit:contain";
    $("scannerArea").replaceChildren(video);
    let playTimer;
    try {
      await Promise.race([
        video.play(),
        new Promise((_, reject) => {
          playTimer = setTimeout(
            () =>
              reject(
                new DOMException("Camera video did not start", "TimeoutError"),
              ),
            8000,
          );
        }),
      ]);
    } finally {
      clearTimeout(playTimer);
    }
    requireScan(generation);
    state.cameraRunning = true;
    $("startCamera").hidden = true;
    $("stopCamera").hidden = false;
    $("scanMessage").textContent =
      "Hold the whole barcode steady. For a shop barcode, use Take photo and include the printed ISBN.";
    const frame = async () => {
      if (!scanActive(generation) || !state.cameraRunning) return;
      try {
        if (video.readyState >= 2) {
          const canvas = photoCanvas(video, 1600);
          let results;
          try {
            results = await readBarcodes(canvas, generation);
          } finally {
            canvas.width = canvas.height = 1;
          }
          if (!scanActive(generation)) return;
          const isbns = [
            ...new Set(
              results.map((result) => canonical(result.text)).filter(Boolean),
            ),
          ];
          if (isbns.length === 1) {
            await acceptScan(isbns[0], generation);
            return;
          }
          if (isbns.length > 1) {
            reviewScan(isbns, generation);
            return;
          }
          if (results.length)
            $("scanMessage").textContent =
              "This barcode is not an ISBN. Use Take photo and include the printed ISBN above it.";
        }
      } catch (error) {
        if (scanActive(generation)) {
          stopScanner();
          $("scanMessage").textContent =
            error.message ||
            "The camera reader is unavailable. Use Take photo or type the ISBN.";
        }
        return;
      }
      if (scanActive(generation)) state.cameraTimer = setTimeout(frame, 250);
    };
    void frame();
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (scanActive(generation)) {
      stopScanner();
      $("scanMessage").textContent =
        error.name === "NotAllowedError"
          ? "Live camera access was blocked by the browser or this embedded page. Use Take photo or Choose photo."
          : "The live camera could not start. Use Take photo or Choose photo, or open the app in Safari.";
    }
  } finally {
    if (state.cameraStart === pending) state.cameraStart = null;
    if (scanActive(generation)) $("startCamera").disabled = false;
  }
}
async function scanPhoto(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  stopScanner();
  const generation = state.scanGeneration,
    task = { worker: null };
  task.cancelled = new Promise((resolve) => {
    task.cancel = resolve;
  });
  state.photoTask = task;
  $("scannerArea").replaceChildren();
  $("scanMessage").textContent = "Reading the barcode in your photo…";
  const url = URL.createObjectURL(file),
    image = new Image();
  let canvas;
  try {
    image.src = url;
    await photoStep(image.decode(), task);
    requireScan(generation);
    canvas = photoCanvas(image);
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
    const preview = photoCanvas(canvas, 650);
    preview.style.cssText =
      "display:block;width:100%;max-height:38dvh;object-fit:contain";
    $("scannerArea").replaceChildren(preview);
    const results = await readBarcodes(canvas, generation);
    requireScan(generation);
    const isbns = [
      ...new Set(
        results.map((result) => canonical(result.text)).filter(Boolean),
      ),
    ];
    if (isbns.length === 1) {
      await acceptScan(isbns[0], generation);
      return;
    }
    if (isbns.length > 1) {
      reviewScan(isbns, generation);
      return;
    }
    const printed = await readPrintedIsbns(canvas, generation, task);
    requireScan(generation);
    if (printed.length) {
      reviewScan(printed, generation, true);
      return;
    }
    $("scanMessage").textContent = results.length
      ? "The barcode is a shop code, and the printed ISBN could not be read. Retake a closer photo including the ISBN above the barcode, or type it."
      : "Could not read an ISBN from this photo. Retake a closer, sharp photo including the barcode and printed ISBN, or type it.";
  } catch (error) {
    if (scanActive(generation))
      $("scanMessage").textContent =
        error.name === "EncodingError"
          ? "This photo format could not be opened. Choose a JPEG or PNG photo, or type the ISBN."
          : error.message ||
            "The photo reader could not finish. Try again or type the ISBN.";
  } finally {
    URL.revokeObjectURL(url);
    image.removeAttribute("src");
    if (canvas) canvas.width = canvas.height = 1;
    if (state.photoTask === task) state.photoTask = null;
  }
}
// Initialize collection controls.
$("addButton").addEventListener("click", () =>
  openBook(null, seriesDefaults()),
);
$("backSeries").addEventListener("click", () => {
  state.selectedSeries = null;
  state.page = 0;
  resetCollectionFilters();
  render();
});
$("closeBook").addEventListener("click", closeBook);
$("cancelBook").addEventListener("click", closeBook);
$("bookDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeBook();
});
$("bookForm").addEventListener("submit", save);
$("editTitleButton").addEventListener("click", openTitle);
$("titleForm").addEventListener("submit", saveTitle);
["closeTitle", "cancelTitle"].forEach((id) =>
  $(id).addEventListener("click", closeTitle),
);
$("titleDialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeTitle();
});
$("bookEdition").addEventListener("change", () => {
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
});
["input", "change"].forEach((event) =>
  $("series").addEventListener(event, syncSeriesSelection),
);
$("toggleBookDetails").addEventListener("click", () => {
  if (state.busy) return;
  state.detailsExpanded = !state.detailsExpanded;
  renderBookDetails();
});
$("type").addEventListener("change", () => {
  state.typeTouched = true;
});
["type", "publisher", "source"].forEach((id) =>
  $(id).addEventListener(id === "type" ? "change" : "input", renderBookDetails),
);
["regularPrice", "discount"].forEach((id) =>
  $(id).addEventListener("input", calculateSalePrice),
);
$("discountType").addEventListener("change", calculateSalePrice);
$("price").addEventListener("input", enterSalePrice);
$("lookupButton").addEventListener("click", lookup);
$("isbn").addEventListener("input", clearLookup);
$("isbn").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void lookup();
  }
});
$("scanButton").addEventListener("click", () => openScanner("add"));
$("checkBookButton").addEventListener("click", openCheck);
$("checkForm").addEventListener("submit", checkBook);
$("checkIsbn").addEventListener("input", invalidateCheck);
$("checkSearch").addEventListener("input", renderManualCheck);
["closeCheck", "doneCheck"].forEach((id) =>
  $(id).addEventListener("click", closeCheck),
);
$("checkDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeCheck();
});
["checkScanButton", "scanNextBook"].forEach((id) =>
  $(id).addEventListener("click", () => openScanner("check")),
);
$("isbnForm").addEventListener("submit", saveIsbn);
$("linkScanButton").addEventListener("click", () => openScanner("link"));
["closeIsbn", "cancelIsbn"].forEach((id) =>
  $(id).addEventListener("click", closeIsbn),
);
$("isbnDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeIsbn();
});
$("startCamera").addEventListener("click", () => void startCamera());
$("stopCamera").addEventListener("click", () => {
  stopScanner();
  $("scanMessage").textContent =
    "Camera stopped. Take or choose a photo, or restart the live camera.";
});
$("closeScan").addEventListener("click", closeScanner);
$("scanDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeScanner();
});
["barcodePhoto", "chooseBarcodePhoto"].forEach((id) =>
  $(id).addEventListener("change", scanPhoto),
);
// iOS may hide the page while its native camera/photo picker is open. Preserve photo scans.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (state.cameraRunning || state.cameraStart)) {
    stopScanner();
    $("scanMessage").textContent =
      "Camera paused. Restart it or take a photo to continue.";
  }
});
window.addEventListener("pagehide", stopScanner);
$("removeButton").addEventListener("click", askRemove);
$("pullPublisherCovers").addEventListener(
  "click",
  () => void pullPublisherCovers(),
);
$("coverUrl").addEventListener("input", () => {
  state.selectedCoverId = "";
});
["coverUrl", "publisherUrl", "publisher"].forEach((id) =>
  $(id).addEventListener("input", renderMetadataCover),
);
["series", "volume", "type", "publisher", "publisherUrl"].forEach((id) =>
  $(id).addEventListener(id === "type" ? "change" : "input", () => {
    state.coverPickerGeneration++;
    $("publisherCoverChoices").replaceChildren();
    $("pullPublisherCovers").disabled = !state.editing || state.busy;
    $("publisherCoversStatus").textContent = state.editing
      ? "Pull covers again after changing the publisher page. Save volume or series changes first."
      : "Save this book to look for publisher and bookstore covers.";
  }),
);
document.addEventListener("click", (event) => {
  document.querySelectorAll(".volume-actions[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    document.querySelectorAll(".volume-actions[open]").forEach((menu) => {
      menu.open = false;
      menu.querySelector("summary").focus();
    });
});
$("confirmRemove").addEventListener("click", remove);
["closeRemove", "cancelRemove"].forEach((id) =>
  $(id).addEventListener("click", () => {
    if (!state.busy) $("removeDialog").close();
  }),
);
$("removeDialog").addEventListener("cancel", (e) => {
  if (state.busy) e.preventDefault();
});
$("collectionTab").addEventListener("click", () => changeView("collection"));
$("trashTab").addEventListener("click", () => changeView("trash"));
$("releasesTab").addEventListener("click", () => changeView("releases"));
$("discoverTab").addEventListener("click", () => changeView("discover"));
$("discoveryForm").addEventListener("submit", (event) => {
  event.preventDefault();
  void loadDiscovery();
});
$("refreshDiscovery").addEventListener("click", () => void loadDiscovery(true));
$("discoveryPreset").addEventListener("change", () => {
  if ($("discoveryPreset").value) {
    $("discoveryUrl").value = $("discoveryPreset").value;
    void loadDiscovery();
  } else $("discoveryUrl").focus();
});
$("discoveryUrl").addEventListener("input", () => {
  $("discoveryPreset").value = [...$("discoveryPreset").options].some(
    (option) => option.value === $("discoveryUrl").value,
  )
    ? $("discoveryUrl").value
    : "";
});
$("discoverySearch").addEventListener("input", renderDiscovery);
$("refreshReleases").addEventListener("click", () => void loadReleases(true));
$("refreshSeriesReleases").addEventListener(
  "click",
  () => void loadSeriesCatalogs(true),
);
$("seriesCatalogToggle").addEventListener("click", () => {
  state.seriesDetailsExpanded = !state.seriesDetailsExpanded;
  $("seriesCatalogDetails").open = state.seriesDetailsExpanded;
  renderSeriesMissing();
});
["releaseSearch", "releasePublisher", "releaseScope", "releaseType"].forEach(
  (id) =>
    $(id).addEventListener(
      id === "releaseSearch" ? "input" : "change",
      renderReleases,
    ),
);
$("hideSpecialReleases").addEventListener("click", () => {
  $("hideSpecialReleases").setAttribute(
    "aria-pressed",
    String($("hideSpecialReleases").getAttribute("aria-pressed") !== "true"),
  );
  renderReleases();
});
[...COLLECTION_FILTERS, "collectionSort"].forEach((id) =>
  $(id).addEventListener($(id).tagName === "INPUT" ? "input" : "change", () => {
    state.page = 0;
    render();
  }),
);
$("clearCollectionFilters").addEventListener("click", () => {
  resetCollectionFilters();
  render();
});
$("previousPage").addEventListener("click", () => {
  state.page--;
  render();
});
$("nextPage").addEventListener("click", () => {
  state.page++;
  render();
});
$("refreshButton").addEventListener("click", () => void load().catch(() => {}));
void load().catch(() => {});
