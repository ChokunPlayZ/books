import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { seriesPath } from "../../lib/domain/navigation.ts";
import { releaseItem } from "../../lib/domain/releases.ts";
import { normalizeRecordTypes } from "../../lib/domain/book-type.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const gate = Promise.withResolvers();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const series = "Synthetic daily catalog shelf";
  const response = await page.request.post(testUrl + "/api/rpc", {
    data: {
      name: "saveBook",
      arg: {
        requestId: crypto.randomUUID(),
        book: {
          series,
          type: "Manga",
          edition: "(TH)",
          publisher: "PHOENIX Next",
          volume: 1,
          status: "Read",
        },
      },
    },
  });
  assert.equal(response.ok(), true, await response.text());
  const day = 24 * 60 * 60 * 1000;
  const start = new Date("2026-11-13T00:00:00.000Z");
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start);
  const listing = (volume) =>
    normalizeRecordTypes({
      ...releaseItem(
        "phoenix",
        series + " เล่ม " + volume,
        `https://www.phoenixnext.com/synthetic-daily-${volume}.html`,
        175,
        "",
        "Manga (TH)",
      ),
      catalogSeries: series,
    });
  let items = [1, 2, 3].map(listing);
  let catalogCalls = 0;
  let volumeCalls = 0;
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getSeriesCatalog") {
      catalogCalls++;
      if (catalogCalls === 1) await gate.promise;
      return route.fulfill({
        json: {
          ...arg,
          title: series,
          url: "https://www.phoenixnext.com/book-series/synthetic-daily.html",
          items,
          checkedAt: new Date(
            start.getTime() + (catalogCalls - 1) * day,
          ).toISOString(),
          complete: true,
          stale: false,
          error: "",
        },
      });
    }
    if (name === "getSeriesVolumes") {
      volumeCalls++;
      return route.fulfill({
        json: {
          items: items.map((item) => ({
            ...item,
            key: item.id,
            owned: item.volume === 1,
            language: "th",
          })),
        },
      });
    }
    if (["getSeriesInfo", "pullSeriesInfo"].includes(name))
      return route.fulfill({
        json: {
          series,
          type: "Manga",
          workId: "",
          titles: [],
          synopses: [],
          editions: [],
          candidates: [],
          warnings: [],
        },
      });
    if (name === "getAnimeAdaptations")
      return route.fulfill({ json: { items: [], complete: true } });
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    return route.continue();
  });
  await page.goto(testUrl + seriesPath(series));
  await page.waitForFunction(
    () => window.bookCollection?.state.catalogLoading.size === 1,
  );
  assert.equal(catalogCalls, 1, "Entering the series starts catalog discovery");
  assert.equal(volumeCalls, 0, "Volume metadata waits for catalog discovery");
  gate.resolve();
  await page.waitForFunction(
    () => window.bookCollection?.state.knownSeriesVolumes.length === 3,
  );
  assert.equal(await page.locator("#bookList .is-missing").count(), 2);
  await page.clock.fastForward(day - 1);
  assert.equal(catalogCalls, 1, "A fresh catalog is reused for the entire day");
  items = [1, 2, 3, 4].map(listing);
  await page.clock.fastForward(1);
  await page.waitForFunction(
    () => window.bookCollection?.state.knownSeriesVolumes.length === 4,
  );
  assert.equal(catalogCalls, 2, "Expiry checks the source automatically");
  assert.equal(volumeCalls, 2);
  assert.equal(await page.locator("#bookList .is-missing").count(), 3);
  assert.deepEqual(errors, []);
  console.log(
    "PASS series entry discovers missing volumes and refreshes them after one day",
  );
} finally {
  gate.resolve();
  await browser.close();
}
