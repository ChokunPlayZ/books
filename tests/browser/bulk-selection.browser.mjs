import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/rpc", (route) => {
    const { name } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { coverUrl: "" } });
    if (["getSeriesCatalog", "getSeriesCategories"].includes(name))
      return route.fulfill({
        json: { items: [], categories: [], complete: true },
      });
    return route.continue();
  });
  const ready = () =>
    page.waitForFunction(
      () =>
        !!window.bookCollection?.state.data &&
        !document.getElementById("refreshButton").disabled,
    );
  const data = () =>
    page.evaluate(() => window.bookCollection.rpc("getCollection"));
  await page.goto(testUrl);
  await ready();
  await page.evaluate(async () => {
    for (const [series, count] of [
      ["Batch Alpha", 65],
      ["Batch Beta", 2],
      ["Batch Gamma", 1],
    ]) {
      for (let volume = 1; volume <= count; volume++)
        await window.bookCollection.rpc("saveBook", {
          requestId: crypto.randomUUID(),
          book: {
            series,
            volume,
            type: "Manga (TH)",
            publisher: "Test Press",
            status: "Sealed",
            price: volume,
            note: volume % 2 ? "odd" : "even",
          },
        });
    }
    document.getElementById("refreshButton").click();
  });
  await ready();
  const series = page.locator("#bookList .series-card");
  await series.nth(0).click({ modifiers: [modifier] });
  assert.equal(new URL(page.url()).pathname, "/");
  assert.match(
    await page.locator("#selectionCount").textContent(),
    /65 books selected in 1 series/,
  );
  await series.nth(2).dispatchEvent("click", { ctrlKey: true });
  assert.equal(await page.locator("#bookList .is-selected").count(), 2);
  await series.nth(2).click({ modifiers: ["Meta"] });
  assert.equal(await page.locator("#bookList .is-selected").count(), 1);
  await series.nth(1).click({ modifiers: ["Shift"] });
  assert.match(
    await page.locator("#selectionCount").textContent(),
    /3 books selected in 2 series/,
  );
  await page.locator("#applyBulkStatus").click();
  await page.waitForFunction(() => !window.bookCollection.state.busy);
  let current = await data();
  assert.equal(
    current.books.filter((book) => book.status === "Read").length,
    3,
  );
  assert.equal(
    current.books.filter((book) => book.status === "Sealed").length,
    65,
  );
  assert.equal(await page.locator("#bulkActions").isVisible(), false);
  await page.locator("#statusFilter").selectOption("Sealed");
  await page.locator("#toggleSelection").click();
  await page.locator("#selectAllBooks").click();
  assert.match(await page.locator("#selectionCount").textContent(), /65 books/);
  await page.locator("#search").fill("Batch Beta");
  assert.match(await page.locator("#selectionCount").textContent(), /0 books/);
  await page.keyboard.press("Escape");
  await page.locator("#clearCollectionFilters").click();
  await series.nth(0).click();
  await ready();
  const volumes = page.locator("#bookList .book-card");
  await volumes.nth(0).click({ modifiers: ["Meta"] });
  await volumes.nth(2).click({ modifiers: ["Meta"] });
  assert.equal(await page.locator("#bookList .is-selected").count(), 2);
  await volumes.nth(7).click({ modifiers: ["Shift"] });
  assert.equal(await page.locator("#bookList .is-selected").count(), 6);
  assert.equal(
    await page.locator("#bookDialog").evaluate((dialog) => dialog.open),
    false,
  );
  await page.locator("#clearSelection").click();
  await volumes.nth(0).click();
  for (let i = 0; i < 8 && (await volumes.count()) < 65; i++) {
    await page.locator("#bookList + .infinite-scroll").scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
  }
  assert.equal(await volumes.count(), 65);
  await volumes.nth(64).click({ modifiers: [modifier, "Shift"] });
  assert.equal(await page.locator("#bookList .is-selected").count(), 65);
  await page.locator("#bulkStatus").selectOption("Reading");
  await page.locator("#applyBulkStatus").click();
  await page.waitForFunction(() => !window.bookCollection.state.busy);
  current = await data();
  assert.equal(
    current.books.filter(
      (book) => book.series === "Batch Alpha" && book.status === "Reading",
    ).length,
    65,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#toggleSelection").click();
  await volumes.nth(0).click();
  await volumes.nth(1).click();
  assert.equal(await page.locator("#bookList .is-selected").count(), 2);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator("#bulkActions").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(root, "outputs", "bulk-selection-phone.png"),
  });
  await page.locator("#bulkMoveBooks").click();
  await page.locator("#cancelBulkRemove").click();
  assert.equal((await data()).books.length, 68);
  await page.locator("#bulkMoveBooks").click();
  await page.locator("#confirmBulkRemove").click();
  await page.waitForFunction(() => !window.bookCollection.state.busy);
  current = await data();
  assert.equal(current.books.length, 66);
  assert.equal(current.trash.length, 2);
  await page.goto(testUrl + "/removed");
  await ready();
  const trash = page.locator("#bookList .book-row");
  await trash.nth(0).click({ modifiers: [modifier] });
  await trash.nth(1).click({ modifiers: ["Shift"] });
  await page.locator("#bulkMoveBooks").click();
  await page.waitForFunction(() => !window.bookCollection.state.busy);
  current = await data();
  assert.equal(current.books.length, 68);
  assert.equal(current.trash.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Ctrl/Cmd toggles, Shift ranges, filtered series selection, infinite lists, batch statuses, mobile selection, removal and restore",
  );
} finally {
  await browser.close();
}
