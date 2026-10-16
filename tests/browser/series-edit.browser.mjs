import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { seriesPath } from "../../lib/domain/navigation.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const series = "Series purchase edit " + Date.now();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const post = async (name, arg) => {
    const response = await page.request.post(testUrl + "/api/rpc", {
      data: { name, arg },
    });
    assert.equal(response.ok(), true, await response.text());
    return response.json();
  };
  for (const book of [
    { volume: 1, type: "Manga (TH)", price: 90 },
    { volume: 2, type: "Manga (TH)", price: 120.5 },
    { volume: 1, type: "Manga (JP)", price: 0 },
  ])
    await post("saveBook", {
      requestId: randomUUID(),
      book: {
        ...book,
        series,
        isbn: "",
        publisher: "Test press",
        status: "Reading",
        source: "Original shop",
        date: "2026-10-01",
        note: "Keep this volume note",
      },
    });
  const before = (await post("getCollection")).books.filter(
    (book) => book.series === series,
  );
  const ready = () =>
    page.waitForFunction(
      () =>
        !!window.bookCollection?.state.data &&
        !window.bookCollection.state.busy,
    );
  await page.goto(testUrl + seriesPath(series));
  await ready();
  await page.locator("#search").fill("Manga (JP)");
  assert.equal(await page.locator(".book-row").count(), 1);
  await page.getByRole("button", { name: "Edit volumes", exact: true }).click();
  assert.equal(await page.locator("#collectionBrowser").isVisible(), false);
  assert.equal(await page.locator("#seriesEditRows tr").count(), 3);
  assert.equal(await page.locator("#saveSeriesEdits").isDisabled(), true);
  assert.equal(await page.locator("#addButton").isDisabled(), true);
  const row = (index) =>
    page.locator(`#seriesEditRows tr[data-row="${before[index].row}"]`);
  const input = (index, field) => row(index).locator(`input[name="${field}"]`);
  await input(0, "price").fill("90.00");
  assert.equal(await page.locator("#saveSeriesEdits").isDisabled(), true);
  await input(0, "date").fill("2026-10-15");
  await input(0, "price").fill("0");
  await input(0, "source").fill("New shop");
  await input(1, "date").fill("");
  await input(1, "price").fill("");
  await input(1, "source").fill("");
  assert.match(
    await page.locator("#seriesSaveStatus").textContent(),
    /Unsaved changes · 2 volumes/,
  );
  assert.deepEqual(
    (await post("getCollection")).books.filter(
      (book) => book.series === series,
    ),
    before,
  );
  const bar = await page.locator("#seriesSaveBar").boundingBox();
  assert.ok(Math.abs(bar.x + bar.width / 2 - 720) < 2);
  assert.ok(bar.y + bar.height <= 1000 && bar.y > 700);
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-series-edit-desktop.png", import.meta.url),
    ),
  });

  let warned = false;
  page.once("dialog", async (dialog) => {
    assert.equal(dialog.type(), "beforeunload");
    warned = true;
    await dialog.dismiss();
  });
  await page.locator("#backSeries").click();
  assert.equal(warned, true);
  assert.equal(await input(0, "source").inputValue(), "New shop");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.equal(
    await page
      .locator(".series-edit-scroll")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
    true,
  );
  const phoneBar = await page.locator("#seriesSaveBar").boundingBox();
  assert.ok(Math.abs(phoneBar.x + phoneBar.width / 2 - 195) < 2);
  assert.ok(phoneBar.y + phoneBar.height <= 844);
  assert.equal(await page.locator("#saveSeriesEdits").isVisible(), true);
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-series-edit-phone.png", import.meta.url),
    ),
  });

  // A failed save keeps the drafts and retry uses the same receipt ID.
  const attempts = [];
  await page.route("**/api/rpc", (route) => {
    const payload = route.request().postDataJSON();
    if (payload.name !== "saveSeriesPurchases") return route.continue();
    attempts.push(payload.arg);
    if (attempts.length === 1)
      return route.fulfill({
        status: 503,
        json: { message: "Temporary save failure. Try again." },
      });
    return route.continue();
  });
  await page.locator("#saveSeriesEdits").click();
  await page.locator("#seriesEditError").waitFor();
  await ready();
  assert.equal(await input(0, "price").inputValue(), "0");
  assert.equal(await input(0, "source").inputValue(), "New shop");
  await page.locator("#saveSeriesEdits").click();
  await page.waitForFunction(
    () =>
      document.getElementById("seriesEditor").hidden &&
      !window.bookCollection.state.busy,
  );
  assert.deepEqual(attempts[1], attempts[0]);
  let saved = (await post("getCollection")).books.filter(
    (book) => book.series === series,
  );
  assert.deepEqual(
    saved
      .slice(0, 2)
      .map(({ date, price, source }) => ({ date, price, source })),
    [
      { date: "2026-10-15", price: 0, source: "New shop" },
      { date: "", price: "", source: "" },
    ],
  );
  assert.deepEqual(saved[2], before[2]);
  assert.equal(saved[0].note, before[0].note);
  assert.match(
    await page.locator("#seriesSummary").textContent(),
    /฿0 recorded spending/,
  );
  await page.reload();
  await ready();
  await page.locator("#editVolumesButton").click();
  assert.equal(await input(0, "price").inputValue(), "0");
  assert.equal(await input(1, "price").inputValue(), "");
  await input(0, "price").fill("-1");
  assert.equal(
    await page
      .locator("#seriesEditor")
      .evaluate((form) => form.checkValidity()),
    false,
  );
  await page.locator("#saveSeriesEdits").click();
  assert.equal(attempts.length, 2);
  await input(0, "price").fill("999");
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  assert.equal(await page.locator("#seriesEditor").isVisible(), false);
  assert.equal(await page.locator("#collectionBrowser").isVisible(), true);
  await page.locator("#editVolumesButton").click();
  assert.equal(await input(0, "price").inputValue(), "0");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  saved = (await post("getCollection")).books.filter(
    (book) => book.series === series,
  );
  assert.equal(saved[0].price, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS series table editing, centered desktop/mobile save prompt, navigation warning, retry, persistence and discard",
  );
} finally {
  await browser.close();
}
