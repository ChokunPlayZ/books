import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { seriesPath } from "../../lib/domain/navigation.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const series = "Volume dialog / รายละเอียดเล่ม " + Date.now();
  const response = await page.request.post(testUrl + "/api/rpc", {
    data: {
      name: "saveBook",
      arg: {
        requestId: crypto.randomUUID(),
        book: {
          series,
          type: "Manga",
          publisher: "Test publisher",
          volume: 1,
          status: "Reading",
          price: 95,
          source: "Bookshop",
          date: "2026-11-12",
          note: "A personal note",
          pageCount: 208,
          msrp: 175,
          msrpCurrency: "THB",
          edition: "(TH)",
        },
      },
    },
  });
  assert.equal(response.ok(), true, await response.text());
  await page.route("**/api/rpc", (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    if (name === "pullSeriesInfo")
      return route.fulfill({
        json: {
          series,
          type: "Manga",
          titles: [],
          synopses: [],
          editions: [],
          candidates: [],
          warnings: [],
          workId: "",
        },
      });
    if (name === "getAnimeAdaptations")
      return route.fulfill({
        json: { items: [], exactId: null, complete: true },
      });
    return route.continue();
  });
  await page.goto(testUrl + seriesPath(series));
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator(".book-card").first().click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    const fit = await page
      .locator("#bookDialog .dialog-body")
      .evaluate((body) => ({
        height: body.clientHeight,
        content: body.scrollHeight,
        width: body.clientWidth,
        contentWidth: body.scrollWidth,
      }));
    await page.screenshot({
      path: `outputs/volume-dialog-${viewport.width}.png`,
      animations: "disabled",
    });
    assert.ok(
      fit.content <= fit.height + 1,
      `All volume information fits at ${viewport.width}×${viewport.height}: ${JSON.stringify(fit)}`,
    );
    assert.ok(fit.contentWidth <= fit.width + 1);
    for (const id of [
      "isbn",
      "volume",
      "status",
      "source",
      "date",
      "price",
      "note",
      "msrp",
      "msrpCurrency",
      "edition",
      "pageCount",
      "publisherUrl",
      "coverUrl",
    ])
      assert.equal(
        await page.locator("#" + id).isVisible(),
        true,
        `${id} is immediately visible`,
      );
  }
  for (const width of [320, 390, 560, 760, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page
        .locator("#bookDialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    const save = await page.locator("#saveButton").boundingBox();
    assert.ok(save && save.y >= 0 && save.y + save.height <= 845);
  }
  await page.locator("#cancelBook").click();
  for (const preferences of [
    { locale: "th", theme: "light" },
    { locale: "th", theme: "dark" },
    { locale: "en", theme: "dark" },
  ]) {
    assert.equal(
      (
        await page.request.patch(testUrl + "/api/preferences", {
          data: preferences,
        })
      ).ok(),
      true,
    );
    await page.goto(testUrl + seriesPath(series));
    await page.waitForFunction(() => !!window.bookCollection?.state.data);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator(".book-card").first().click();
    assert.equal(
      await page
        .locator("#bookDialog .dialog-body")
        .evaluate((body) => body.scrollHeight <= body.clientHeight + 1),
      true,
      JSON.stringify(preferences),
    );
    await page.screenshot({
      path: `outputs/volume-dialog-${preferences.locale}-${preferences.theme}.png`,
      animations: "disabled",
    });
    await page.locator("#cancelBook").click();
    await page.locator("#editVolumesButton").click();
    await page.locator(".series-edit-toggle").first().click();
    assert.equal(
      await page
        .locator("#seriesVolumeFields")
        .evaluate((body) => body.scrollHeight <= body.clientHeight + 1),
      true,
      JSON.stringify(preferences),
    );
    await page.screenshot({
      path: `outputs/series-volume-${preferences.locale}-${preferences.theme}.png`,
      animations: "disabled",
    });
    await page.locator("#doneSeriesVolume").click();
    await page.locator("#cancelSeriesEdit").click();
  }
  await page.request.patch(testUrl + "/api/preferences", {
    data: { locale: "en", theme: "light" },
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS owned-volume dialog: all fields visible without desktop scrolling, responsive fields and persistent actions at nine sizes, English/Thai and light/dark editors",
  );
} finally {
  await browser.close();
}
