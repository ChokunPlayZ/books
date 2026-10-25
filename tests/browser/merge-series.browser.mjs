import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const target = "ต้องทำยังไงถึงจะได้เป็นหวานใจเพื่อนวัยเด็ก!?";
const source = "ต้องทำยังไงถึงได้เป็นหวานใจเพื่อนวัยเด็ก!?";
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
  await page.route("**/api/rpc", async (route) => {
    const { name } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { coverUrl: "" } });
    if (["getSeriesCatalog", "getSeriesCategories"].includes(name))
      return route.fulfill({
        json: { items: [], categories: [], complete: true },
      });
    if (name === "mergeSeries")
      await new Promise((resolve) => setTimeout(resolve, 400));
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
  await page.evaluate(
    async ({ source, target }) => {
      for (const book of [
        {
          series: source,
          volume: 1,
          status: "Read",
          price: 0,
          note: "Same volume, separate copy",
        },
        {
          series: source,
          volume: 2,
          status: "Sealed",
          price: "",
          note: "Hidden by the filter",
        },
        {
          series: target,
          volume: 1,
          status: "Read",
          price: 90,
          note: "Keep every field",
        },
        { series: "Unrelated", volume: 1, status: "Read", price: 120 },
      ])
        await window.bookCollection.rpc("saveBook", {
          requestId: crypto.randomUUID(),
          book: {
            type: "Manga (TH)",
            publisher: "Test Press",
            source: "Bookshop",
            date: "2026-10-01",
            ...book,
          },
        });
      document.getElementById("refreshButton").click();
    },
    { source, target },
  );
  await ready();
  await page.locator("#statusFilter").selectOption("Read");
  await page.locator("#toggleSelection").click();
  assert.equal(await page.locator("#mergeSeriesButton").isDisabled(), true);
  await page.getByTitle(source, { exact: true }).click();
  assert.equal(await page.locator("#mergeSeriesButton").isDisabled(), true);
  await page.getByTitle(target, { exact: true }).click();
  assert.match(
    await page.locator("#selectionCount").textContent(),
    /2 books selected in 2 series/,
  );
  await page.locator("#mergeSeriesButton").click();
  const dialog = page.locator("#mergeSeriesDialog");
  assert.match(
    await page.locator("#mergeSeriesSummary").textContent(),
    /3 owned volumes/,
  );
  assert.equal(await page.locator("#mergeSeriesPreview li").count(), 2);
  assert.match(
    await page.locator("#mergeSeriesPreview").textContent(),
    /Vol\. 2/,
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "mergeSeriesName",
  );
  await page.locator("#mergeSeriesName").selectOption(target);
  await page.screenshot({
    path: join(root, "outputs", "merge-series-desktop.png"),
    animations: "disabled",
  });
  await page.locator("#cancelMergeSeries").click();
  assert.equal((await data()).titles.length, 3);
  await page.locator("#mergeSeriesButton").click();
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.locator("#bulkActions").isVisible(), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    localStorage.setItem("books-theme", "dark");
    document.documentElement.dataset.theme = "dark";
  });
  await page.locator("#mergeSeriesButton").click();
  await page.locator("#mergeSeriesName").selectOption(target);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.screenshot({
    path: join(root, "outputs", "merge-series-phone.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.evaluate(async () => {
    const book = window.bookCollection.state.data.books[0];
    await window.bookCollection.rpc("saveBook", {
      requestId: crypto.randomUUID(),
      row: book.row,
      token: book.token,
      book: { ...book, note: "Changed in another tab" },
    });
  });
  await page.locator("#confirmMergeSeries").click();
  await page.locator("#mergeSeriesError").waitFor();
  assert.match(
    await page.locator("#mergeSeriesError").textContent(),
    /selected series changed/,
  );
  assert.equal((await data()).titles.length, 3);
  await page.locator("#cancelMergeSeries").click();
  await page.locator("#refreshButton").click();
  await ready();
  const before = await data();
  await page.locator("#mergeSeriesButton").click();
  await page.locator("#mergeSeriesName").selectOption(target);
  await page.locator("#confirmMergeSeries").click();
  assert.equal(await page.locator("#cancelMergeSeries").isDisabled(), true);
  assert.equal(await page.locator("#mergeSeriesName").isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  await dialog.waitFor({ state: "hidden" });
  await ready();
  const after = await data();
  assert.equal(after.titles.length, 2);
  assert.equal(after.books.filter((book) => book.series === target).length, 3);
  assert.equal(after.books.length, before.books.length);
  for (let index = 0; index < before.books.length; index++) {
    const { series, token, ...details } = after.books[index];
    const {
      series: oldSeries,
      token: oldToken,
      ...oldDetails
    } = before.books[index];
    assert.deepEqual(details, oldDetails);
    assert.equal(series, oldSeries === source ? target : oldSeries);
  }
  assert.equal(await page.locator("#bulkActions").isVisible(), false);
  await page.reload();
  await ready();
  await page.locator("#statusFilter").selectOption("");
  assert.equal(await page.locator("#bookList .series-card").count(), 2);
  assert.match(
    await page.getByTitle(target, { exact: true }).textContent(),
    /3 volumes/,
  );
  await page.getByTitle(target, { exact: true }).click();
  await ready();
  assert.equal(await page.locator("#mergeSeriesButton").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS series merge preview, hidden volumes, duplicate copies, cancel, stale edits, busy controls, persistence and mobile layout",
  );
} finally {
  await browser.close();
}
