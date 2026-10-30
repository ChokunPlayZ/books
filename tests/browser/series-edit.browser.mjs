import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { seriesPath } from "../../lib/domain/navigation.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const series = "เรื่องทดสอบ / Series edit " + Date.now();
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
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export series", exact: true }).click(),
  ]);
  assert.match(download.suggestedFilename(), /เรื่องทดสอบ.*\.json$/);
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.format, "book-collection");
  assert.equal(exported.books.length, 3);
  assert.equal(
    exported.books.every((book) => book.series === series),
    true,
  );
  assert.equal(
    (await page.request.get(testUrl + "/api/backup?series=Missing")).status(),
    404,
  );
  await page.locator("#search").fill("Manga (JP)");
  assert.equal(await page.locator(".book-row").count(), 1);
  await page.getByRole("button", { name: "Edit volumes", exact: true }).click();
  assert.equal(await page.locator("#collectionBrowser").isVisible(), false);
  assert.equal(
    await page.locator("#seriesEditRows .series-edit-volume").count(),
    3,
  );
  assert.equal(await page.locator("#saveSeriesEdits").isDisabled(), true);
  assert.equal(await page.locator("#addButton").isDisabled(), true);
  const row = (index) =>
    page.locator(
      `#seriesEditRows .series-edit-volume[data-row="${before[index].row}"]`,
    );
  const input = (index, field) =>
    page.locator(`#volume-${before[index].row}-${field}`);
  const details = (index) => row(index).locator(".series-edit-toggle");
  assert.equal(await page.getByRole("table").count(), 1);
  assert.equal(
    await page.locator("#seriesEditRows > tr.series-edit-volume").count(),
    3,
  );
  assert.equal(await details(0).getAttribute("aria-expanded"), "false");
  await input(0, "price").fill("90.00");
  assert.equal(await page.locator("#saveSeriesEdits").isDisabled(), true);
  await input(0, "date").fill("2026-10-15");
  await input(0, "price").fill("0");
  await input(0, "source").fill("New shop");
  await input(1, "date").fill("");
  await input(1, "price").fill("");
  await input(1, "source").fill("");
  await details(0).click();
  assert.equal(await details(0).getAttribute("aria-expanded"), "true");
  await input(0, "volume").fill("1.5");
  await input(0, "status").selectOption("Read");
  await input(0, "isbn").fill("0140328726");
  await input(0, "type").selectOption("LN (EN)");
  await input(0, "publisher").fill("Updated press");
  await input(0, "pageCount").fill("260");
  await input(0, "note").fill("Updated notes, including =literal text");
  await input(0, "coverUrl").fill(
    "https://www.phoenixnext.com/media/catalog/product/cached-test.png",
  );
  await input(0, "publisherUrl").fill(
    "https://www.phoenixnext.com/series-01.html",
  );
  await details(0).click();
  await details(1).click();
  await input(1, "volume").fill("");
  await details(1).click();
  await page.locator(".series-edit-scroll").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
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

  await details(0).click();
  await page
    .locator(`#volume-${before[0].row}-details .series-edit-details-body`)
    .screenshot({
      path: fileURLToPath(
        new URL(
          "../../outputs/browser-series-edit-details-desktop.png",
          import.meta.url,
        ),
      ),
    });
  await details(0).click();

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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-series-edit-phone.png", import.meta.url),
    ),
  });
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../outputs/browser-series-edit-phone-dark.png",
        import.meta.url,
      ),
    ),
  });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await details(0).click();
  await page
    .locator(`#volume-${before[0].row}-details .series-edit-details-body`)
    .screenshot({
      path: fileURLToPath(
        new URL(
          "../../outputs/browser-series-edit-details-phone.png",
          import.meta.url,
        ),
      ),
    });
  await details(0).click();
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });

  // A failed save keeps the drafts and retry uses the same receipt ID.
  const attempts = [];
  await page.route("**/api/rpc", (route) => {
    const payload = route.request().postDataJSON();
    if (payload.name !== "saveSeriesVolumes") return route.continue();
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
  assert.equal(saved[0].volume, 1.5);
  assert.equal(saved[0].status, "Read");
  assert.equal(saved[0].isbn, "0140328726");
  assert.equal(saved[0].type, "LN (EN)");
  assert.equal(saved[0].publisher, "Updated press");
  assert.equal(saved[0].pageCount, 260);
  assert.equal(saved[0].note, "Updated notes, including =literal text");
  assert.equal(saved[1].volume, "");
  const afterExport = await (
    await page.request.get(
      testUrl + "/api/backup?series=" + encodeURIComponent(series),
    )
  ).json();
  assert.equal(afterExport.books.length, 3);
  assert.equal(afterExport.covers.length, 1);
  assert.equal(afterExport.books[0].coverId, afterExport.covers[0].id);
  assert.match(
    await page.locator("#seriesSummary").textContent(),
    /฿0 recorded spending/,
  );
  await page.reload();
  await ready();
  await page.locator("#editVolumesButton").click();
  assert.equal(await input(0, "price").inputValue(), "0");
  assert.equal(await input(1, "price").inputValue(), "");
  await details(0).click();
  assert.equal(await input(0, "pageCount").inputValue(), "260");
  assert.equal(
    await input(0, "note").inputValue(),
    "Updated notes, including =literal text",
  );
  await input(0, "isbn").fill("invalid isbn");
  await page.locator("#saveSeriesEdits").click();
  await page.locator("#seriesEditError").waitFor();
  await ready();
  assert.equal(await input(0, "isbn").inputValue(), "invalid isbn");
  await input(0, "isbn").fill("0140328726");
  await input(0, "publisherUrl").fill("not a URL");
  await details(0).click();
  assert.equal(await input(0, "publisherUrl").isVisible(), false);
  await page.locator("#saveSeriesEdits").click();
  assert.equal(await input(0, "publisherUrl").isVisible(), true);
  assert.equal(await details(0).getAttribute("aria-expanded"), "true");
  assert.equal(attempts.length, 3);
  await input(0, "publisherUrl").fill(
    "https://www.phoenixnext.com/series-01.html",
  );
  await input(0, "price").fill("-1");
  assert.equal(
    await page
      .locator("#seriesEditor")
      .evaluate((form) => form.checkValidity()),
    false,
  );
  await page.locator("#saveSeriesEdits").click();
  assert.equal(attempts.length, 3);
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
    "PASS series export, table editing with expandable volume details, responsive desktop/mobile save prompt, navigation warning, validation, retry, persistence and discard",
  );
} finally {
  await browser.close();
}
