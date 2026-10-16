import { testUrl } from "../helpers/browser.mjs";
// Run only against the isolated, initially empty production UI test database.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

assert.ok(process.env.BOOKS_TEST_URL, "An isolated test server is required.");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const marker = "Collection filters " + Date.now() + " ";
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/rpc", (route) => {
    if (route.request().postDataJSON()?.name === "getBookCover")
      return route.fulfill({ json: { coverUrl: "" } });
    return route.continue();
  });
  await page.goto(process.env.BOOKS_TEST_URL);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(await page.locator("#bookCount").textContent(), "0");
  assert.equal(
    await page.locator("#topSeriesName").textContent(),
    "No prices recorded yet",
  );
  const base = {
    isbn: "",
    type: "Manga (TH)",
    publisher: "Press A",
    status: "Read",
    volume: 1,
    source: "Store A",
    price: "",
    date: "",
    note: "",
  };
  const fixtures = [
    {
      ...base,
      series: marker + "Alpha",
      price: 100,
      date: "2026-01-01",
      isbn: "9780140328721",
    },
    {
      ...base,
      series: marker + "Alpha",
      volume: 2,
      price: 300,
      date: "2026-03-01",
      publisher: "Press B",
      source: "Store B",
      status: "Reading",
    },
    { ...base, series: marker + "Alpha", volume: 3 },
    {
      ...base,
      series: marker + "Beta",
      price: 250.5,
      date: "2026-02-15",
      status: "Sealed",
      note: "birthday purchase",
    },
    {
      ...base,
      series: marker + "Beta",
      volume: 2,
      price: 250.5,
      date: "2026-02-16",
    },
    {
      ...base,
      series: marker + "Gamma",
      price: 0,
      date: "2026-04-01",
      publisher: "Press B",
      source: "Store B",
      status: "Sealed",
    },
    {
      ...base,
      series: marker + "Delta",
      price: 25,
      date: "2026-05-01",
      publisher: "Press B",
      source: "",
    },
    { ...base, series: marker + "Epsilon", source: "" },
  ];
  await page.evaluate(async (books) => {
    for (const book of books)
      await window.bookCollection?.rpc("saveBook", {
        book,
        requestId: crypto.randomUUID(),
      });
    document.getElementById("refreshButton").click();
  }, fixtures);
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  const names = async () =>
    (
      await page
        .locator(".series-card")
        .evaluateAll((links) => links.map((link) => link.title))
    ).map((name) => name.slice(marker.length));
  const clear = () => page.locator("#clearCollectionFilters").click();
  assert.equal(await page.locator("#spent").textContent(), "926");
  assert.equal(
    await page.locator("#topSeriesName").textContent(),
    marker + "Beta",
  );
  assert.equal(await page.locator("#topSeriesAmount").textContent(), "฿501");
  assert.equal(await page.locator("#topStoreName").textContent(), "Store A");
  assert.equal(await page.locator("#topStoreAmount").textContent(), "฿601");
  await page.locator(".spending-details summary").click();
  assert.match(
    await page.locator("#spendingCoverage").textContent(),
    /6 of 8 books have prices.*154.33.*2 without prices.*฿25/,
  );
  assert.equal(
    await page.locator("#seriesSpendingList .spending-item").count(),
    4,
  );
  assert.equal(
    await page.locator("#storeSpendingList .spending-item").count(),
    2,
  );
  console.log(
    "PASS spending rankings, total-series cost, decimals, free books, missing prices and unknown stores",
  );

  await page.locator("#collectionFiltersSummary").click();
  await page.locator("#publisherFilter").selectOption("Press B");
  await page.locator("#sourceFilter").selectOption("Store A");
  assert.deepEqual(await names(), []); // Different volumes cannot satisfy separate filters.
  await page.locator("#sourceFilter").selectOption("Store B");
  assert.deepEqual(await names(), ["Alpha", "Gamma"]);
  assert.match(
    await page.locator(".series-card").first().getAttribute("aria-label"),
    /1 matching volume$/,
  );
  await page.locator("#minPriceFilter").fill("300");
  await page.locator("#maxPriceFilter").fill("300");
  await page.locator("#dateFromFilter").fill("2026-03-01");
  await page.locator("#dateToFilter").fill("2026-03-01");
  await page.locator("#typeFilter").selectOption("Manga (TH)");
  await page.locator("#statusFilter").selectOption("Reading");
  assert.deepEqual(await names(), ["Alpha"]);
  await page.locator("#isbnFilter").selectOption("present");
  assert.deepEqual(await names(), []);
  await page.locator("#isbnFilter").selectOption("missing");
  assert.deepEqual(await names(), ["Alpha"]);
  assert.equal(await page.locator("#topSeriesAmount").textContent(), "฿501");
  await page.locator("#collectionFiltersSummary").click();
  assert.match(
    await page.locator("#collectionFiltersSummary").textContent(),
    /7 active/,
  );
  await clear();
  await page.locator("#collectionFiltersSummary").click();
  await page.locator("#minPriceFilter").fill("0");
  await page.locator("#maxPriceFilter").fill("0");
  assert.deepEqual(await names(), ["Gamma"]);
  await clear();
  await page.locator("#priceFilter").selectOption("missing");
  assert.deepEqual(await names(), ["Alpha", "Epsilon"]);
  await page.locator("#priceFilter").selectOption("present");
  assert.deepEqual(await names(), ["Alpha", "Beta", "Delta", "Gamma"]);
  await clear();
  await page.locator("#dateFromFilter").fill("2026-02-15");
  await page.locator("#dateToFilter").fill("2026-02-16");
  assert.deepEqual(await names(), ["Beta"]);
  assert.match(
    await page.locator(".series-card").getAttribute("aria-label"),
    /2 matching volumes$/,
  );
  await clear();
  await page.locator("#search").fill("birthday purchase");
  assert.deepEqual(await names(), ["Beta"]);
  assert.match(
    await page.locator(".series-card").getAttribute("aria-label"),
    /1 matching volume$/,
  );
  await clear();
  for (const [sort, expected] of [
    ["spent", ["Beta", "Alpha", "Delta", "Gamma", "Epsilon"]],
    ["books", ["Alpha", "Beta", "Delta", "Epsilon", "Gamma"]],
    ["recent", ["Delta", "Gamma", "Alpha", "Beta", "Epsilon"]],
  ]) {
    await page.locator("#collectionSort").selectOption(sort);
    assert.deepEqual(await names(), expected);
  }
  await clear();
  console.log(
    "PASS combined book-level filters, inclusive dates and prices, missing metadata, search, clear and sorting",
  );

  await page.evaluate(() => {
    document.querySelectorAll("details[open]").forEach((details) => {
      details.open = false;
    });
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      await page
        .locator("#bookList")
        .evaluate((grid) => getComputedStyle(grid).display),
      "grid",
    );
    const covers = await page.locator(".series-cover").evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
    assert.ok(covers[0].width > 100 && covers[0].height > covers[0].width);
    assert.equal(covers[0].y, covers[1].y);
    assert.ok(covers[1].x > covers[0].x);
    assert.equal(
      await page
        .locator(
          ".series-card .series-meta, .series-card .series-total, .series-card .series-arrow",
        )
        .count(),
      0,
    );
    await page.screenshot({
      path: fileURLToPath(
        new URL(`../../outputs/cover-grid-${width}.png`, import.meta.url),
      ),
      fullPage: true,
    });
  }
  await page.locator("#search").fill(marker + "Alpha");
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(await page.locator(".book-row").count(), 3);
  assert.match(
    await page.locator("#seriesSummary").textContent(),
    /฿400 recorded spending/,
  );
  await page.locator("#collectionFilters summary").click();
  await page.locator("#sourceFilter").selectOption("Store A");
  assert.equal(await page.locator(".book-row").count(), 2);
  await clear();
  await page.locator("#collectionSort").selectOption("spent");
  assert.deepEqual(
    await page
      .locator(".book-card")
      .evaluateAll((cards) => cards.map((card) => card.title)),
    [2, 1, 3].map((volume) => `${marker}Alpha, volume ${volume}`),
  );
  await clear();
  await page.locator("#addButton").click();
  assert.equal(await page.locator("#source").isVisible(), true);
  assert.equal(await page.locator("#publisher").isVisible(), false);
  await page.locator("#source").fill("Store C");
  await page.locator("#volume").fill("4");
  await page.locator("#price").fill("150");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection?.state.busy,
  );
  await page.reload();
  await page.locator("#backSeries").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(
    await page.locator("#topSeriesName").textContent(),
    marker + "Alpha",
  );
  assert.equal(await page.locator("#topSeriesAmount").textContent(), "฿550");
  assert.equal(
    await page.locator("#sourceFilter option[value='Store C']").count(),
    1,
  );
  await page.locator("#search").fill(marker + "Alpha");
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page
    .getByRole("button", { name: `Edit ${marker}Alpha, volume 4`, exact: true })
    .click();
  assert.equal(await page.locator("#source").inputValue(), "Store C");
  await page.locator("#removeButton").click();
  await page.locator("#confirmRemove").click();
  await page.waitForFunction(
    () =>
      !window.bookCollection?.state.busy &&
      !document.getElementById("bookDialog").open,
  );
  await page.locator("#backSeries").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(
    await page.locator("#topSeriesName").textContent(),
    marker + "Beta",
  );
  assert.equal(await page.locator("#spent").textContent(), "926");
  await page.locator("#trashTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(await page.locator("#collectionSpending").isVisible(), false);
  await page.locator(".restore").click();
  await page.waitForFunction(
    () =>
      !window.bookCollection?.state.busy &&
      window.bookCollection?.state.data.books.length === 9,
  );
  await page.locator("#collectionTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(await page.locator("#topSeriesAmount").textContent(), "฿550");
  assert.deepEqual(errors, []);
  console.log(
    "PASS phone/desktop layout, volume filters/sorting, editable store, reload persistence and remove/restore summary updates",
  );
} finally {
  const cleanup = await browser.newPage();
  await cleanup.goto(process.env.BOOKS_TEST_URL);
  await cleanup.waitForFunction(
    () => typeof window.bookCollection?.rpc === "function",
  );
  await cleanup.evaluate(async (marker) => {
    const data = await window.bookCollection?.rpc("getCollection");
    for (const book of data.books.filter((book) =>
      book.series.startsWith(marker),
    ))
      await window.bookCollection?.rpc("removeBook", {
        requestId: crypto.randomUUID(),
        row: book.row,
        token: book.token,
      });
  }, marker);
  await browser.close();
}
