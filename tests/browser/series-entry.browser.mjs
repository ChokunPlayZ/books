import { testUrl } from "../helpers/browser.mjs";
// Browser scenario against an isolated Next.js test library.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.BOOKS_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const marker = "Series entry check " + Date.now();
const title = marker + " existing",
  other = marker + " other",
  sparse = marker + " sparse";
const base = {
  isbn: "",
  series: title,
  type: "Manga (TH)",
  publisher: "Thai press",
  source: "Old shop",
  volume: "1",
  status: "Read",
  price: "90",
  date: "2025-01-01",
  note: "Only this volume",
};
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
    saves = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.url().endsWith("/rpc") &&
      request.postDataJSON()?.name === "saveBook"
    )
      saves.push(request.postDataJSON().arg);
  });
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto(testUrl);
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  for (const book of [
    base,
    {
      ...base,
      volume: "2",
      type: "Manga (JP)",
      publisher: "Japanese press",
      source: "Latest shop",
      date: "2026-09-01",
      isbn: "9780140328721",
    },
    {
      ...base,
      volume: "3",
      type: "Manga (JP)",
      publisher: "",
      source: "",
      date: "2026-10-01",
    },
    {
      ...base,
      series: other,
      type: "LN (TH)",
      publisher: "Other press",
      source: "Other shop",
    },
    { ...base, series: sparse, publisher: "", source: "", date: "" },
  ])
    await page.evaluate(
      (book) =>
        window.bookCollection?.rpc("saveBook", {
          book,
          requestId: crypto.randomUUID(),
          allowDuplicate: true,
        }),
      book,
    );
  saves.length = 0;
  await page.locator("#refreshButton").click();
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  const value = (id) => page.locator("#" + id).inputValue();
  const savedBooks = () =>
    page
      .evaluate(() => window.bookCollection?.rpc("getCollection"))
      .then((data) =>
        data.books.filter((book) => book.series.startsWith(marker)),
      );
  const closed = () =>
    page.waitForFunction(
      () =>
        !document.getElementById("bookDialog").open &&
        !window.bookCollection?.state.busy,
    );

  await page.locator("#addButton").click();
  await page.locator("#type").selectOption("Other");
  await page.locator("#publisher").fill("Manual press");
  await page.locator("#source").fill("Manual shop");
  await page.locator("#volume").fill("14.5");
  await page.locator("#status").selectOption("Reading");
  await page.locator("#price").fill("0");
  await page.locator("#date").fill("2026-10-02");
  await page.locator("#series").fill("  " + title.toUpperCase() + "  ");
  for (const id of ["series", "volume", "source", "status", "price", "date"])
    assert.equal(await page.locator("#" + id).isVisible(), true);
  for (const id of [
    "isbn",
    "type",
    "publisher",
    "note",
    "allowDuplicate",
    "regularPrice",
    "discount",
  ])
    assert.equal(await page.locator("#" + id).isVisible(), false);
  assert.equal(await value("type"), "Manga (JP)");
  assert.equal(await value("publisher"), "Japanese press");
  assert.equal(await value("source"), "Manual shop");
  assert.equal(await value("isbn"), "");
  assert.equal(await value("note"), "");
  assert.equal(await value("volume"), "14.5");
  assert.equal(await value("status"), "Reading");
  assert.equal(await value("price"), "0");
  assert.equal(await value("date"), "2026-10-02");
  assert.match(
    await page.locator("#seriesDefaultsText").textContent(),
    /Japanese press/,
  );
  console.log(
    "PASS short form, recent edition defaults, blank-field fallback and volume-specific values",
  );

  await page.locator("#series").fill(other);
  assert.equal(await value("type"), "LN (TH)");
  assert.equal(await value("publisher"), "Other press");
  assert.equal(await value("source"), "Manual shop");
  await page.locator("#series").fill(marker + " new title");
  assert.equal(await page.locator("#seriesDefaults").isVisible(), false);
  assert.equal(await page.locator("#isbn").isVisible(), true);
  assert.equal(await value("type"), "Other");
  assert.equal(await value("publisher"), "Manual press");
  assert.equal(await value("source"), "Manual shop");
  await page.locator("#series").fill(sparse);
  assert.equal(await value("publisher"), "");
  assert.equal(await value("source"), "Manual shop");
  assert.equal(
    await page.locator("#bookForm").evaluate((form) => form.checkValidity()),
    true,
  );
  await page.locator("#series").fill(title.toLowerCase());
  await page.locator("#keepAdding").check();
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    (title) =>
      document.getElementById("bookDialog").open &&
      document.getElementById("series").value === title &&
      !window.bookCollection?.state.busy,
    title,
  );
  const added = (await savedBooks()).find(
    (book) => book.series === title && book.volume === 14.5,
  );
  assert.ok(added);
  assert.equal(added.type, "Manga (JP)");
  assert.equal(added.publisher, "Japanese press");
  assert.equal(added.source, "Manual shop");
  assert.equal(added.isbn, "");
  assert.equal(added.note, "");
  assert.equal(added.status, "Reading");
  assert.equal(added.price, 0);
  assert.equal(added.date, "2026-10-02");
  assert.equal(saves[0].book.series, title);
  for (const id of [
    "volume",
    "price",
    "isbn",
    "note",
    "regularPrice",
    "discount",
  ])
    assert.equal(await value(id), "");
  assert.equal(await value("status"), "Reading");
  assert.equal(await value("date"), "2026-10-02");
  assert.equal(await value("source"), "");
  assert.equal(await page.locator("#type").isVisible(), false);
  console.log(
    "PASS switching titles without leaked defaults, canonical title save, zero price and keep-adding reset",
  );

  await page.locator("#volume").fill("4");
  await page.locator("#price").fill("230");
  assert.equal(
    await page
      .locator("#bookDialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
  );
  assert.equal(
    await page
      .locator(".purchase-price")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
  );
  const footer = await page.locator("#saveButton").boundingBox();
  assert.ok(footer.y >= 0 && footer.y + footer.height <= 844);
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../outputs/browser-series-entry-preview.png",
        import.meta.url,
      ),
    ),
  });
  await page.locator("#toggleBookDetails").click();
  assert.equal(
    await page.locator("#toggleBookDetails").getAttribute("aria-expanded"),
    "true",
  );
  for (const id of ["isbn", "source", "note"])
    assert.equal(await page.locator("#" + id).isVisible(), true);
  for (const id of ["type", "publisher"])
    assert.equal(await page.locator("#" + id).isVisible(), false);
  await page.locator("#isbn").fill("9780804429573");
  await page.locator("#note").fill("This new volume");
  await page.locator("#source").fill("Changed shop");
  await page.locator("#allowDuplicate").check();
  await page.locator("#toggleBookDetails").click();
  assert.equal(await page.locator("#source").isVisible(), true);
  assert.equal(await value("source"), "Changed shop");
  await page.locator("#keepAdding").uncheck();
  await page.locator("#saveButton").click();
  await closed();
  const overridden = (await savedBooks()).find(
    (book) => book.series === title && book.volume === 4,
  );
  assert.equal(overridden.source, "Changed shop");
  assert.equal(overridden.isbn, "9780804429573");
  assert.equal(overridden.note, "This new volume");
  console.log(
    "PASS optional metadata and unique ISBN/notes save after collapsing details",
  );

  await page.locator("#search").fill(title);
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  assert.equal(await value("series"), title);
  assert.equal(await page.locator("#type").isVisible(), false);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "bookDialogTitle",
  );
  await page.locator("#cancelBook").click();
  await page
    .getByRole("button", { name: "Edit " + title + ", volume 4", exact: true })
    .click();
  assert.equal(await page.locator("#seriesDefaults").isVisible(), true);
  assert.equal(await page.locator("#isbn").isVisible(), true);
  for (const id of ["series", "type", "publisher"])
    assert.equal(await page.locator("#" + id).isVisible(), false);
  assert.equal(await value("source"), "Changed shop");
  assert.equal(await value("note"), "This new volume");
  await page.locator("#cancelBook").click();
  await page.locator("#addButton").click();
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(
    await page
      .locator("#bookDialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
  );
  await page.locator("#cancelBook").click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS Add volume entry, complete edit form, phone/desktop layout and no browser errors",
  );

  // A scanned/typed ISBN survives title selection, and lookup suggestions also select a known title.
  await page.locator("#backSeries").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  await page.locator("#isbn").fill("9780140328721");
  await page.locator("#series").fill(title);
  assert.equal(await value("isbn"), "9780140328721");
  await page.locator("#cancelBook").click();
  await page.locator("#addButton").click();
  await page.route("**/rpc", async (route) => {
    if (route.request().postDataJSON()?.name !== "lookupIsbn")
      return route.continue();
    return route.fulfill({
      json: {
        isbn: "9780140328721",
        found: true,
        details: { title, publisher: "Lookup press", source: "Preview" },
        warnings: [],
      },
    });
  });
  await page.locator("#isbn").fill("9780140328721");
  await page.locator("#lookupButton").click();
  await page.waitForFunction(
    () => !document.getElementById("seriesDefaults").hidden,
  );
  assert.equal(await value("publisher"), "Japanese press");
  assert.equal(await value("isbn"), "9780140328721");
  assert.equal(await page.locator("#lookupResult").isVisible(), true);
  assert.equal(await page.locator("#isbn").isVisible(), false);
  assert.equal(await page.locator("#source").inputValue(), "");
  await page.locator("#toggleLookupDetails").click();
  await page.locator("#isbn").fill("9780385496490");
  assert.equal(await page.locator("#isbn").isVisible(), true);
  assert.equal(await page.locator("#toggleLookupDetails").isVisible(), false);
  assert.equal(await page.locator("#volume").isVisible(), true);
  console.log(
    "PASS ISBN retained and lookup-detected existing title uses series defaults",
  );
} finally {
  // Remove only the records created by this scenario, even when an assertion fails.
  const cleanup = await browser.newPage();
  await cleanup.goto(testUrl);
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
