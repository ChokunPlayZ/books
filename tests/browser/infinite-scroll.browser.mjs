import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { seriesPath } from "../../lib/domain/navigation.ts";
import { releaseItem } from "../../lib/domain.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const padded = (index) => String(index + 1).padStart(3, "0");
const book = (series, volume = 1) => ({
  series,
  volume,
  type: "Manga (TH)",
  status: "Read",
});
const longSeries = "Long scroll series";
const releases = Array.from({ length: 45 }, (_, index) =>
  releaseItem(
    "phoenix",
    `Scroll release ${padded(index)} เล่ม 1`,
    `https://www.phoenixnext.com/scroll-${index}.html`,
    175,
    "",
    "Manga (TH)",
  ),
);

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/rpc", (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { coverId: "" } });
    if (name === "getPublisherReleases")
      return route.fulfill({
        json: {
          items: arg.publisherId === "phoenix" ? releases : [],
          complete: true,
        },
      });
    if (name === "getPublisherDirectory")
      return route.fulfill({
        json: { items: releases, url: arg.url, complete: true },
      });
    return route.continue();
  });
  const file = {
    name: "infinite-scroll.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "book-collection",
        version: 1,
        books: [
          ...Array.from({ length: 44 }, (_, index) =>
            book("Scroll series " + padded(index)),
          ),
          ...Array.from({ length: 45 }, (_, index) =>
            book(longSeries, index + 1),
          ),
        ],
        trash: Array.from({ length: 45 }, (_, index) => ({
          id: "scroll-trash-" + index,
          removedAt: "2026-10-16T00:00:00Z",
          book: book("Removed scroll " + padded(index)),
        })),
      }),
    ),
  };
  const preview = await page.request.post(testUrl + "/api/import", {
    multipart: { action: "preview", file },
  });
  assert.equal(preview.status(), 200);
  const imported = await page.request.post(testUrl + "/api/import", {
    multipart: {
      action: "import",
      fingerprint: (await preview.json()).fingerprint,
      file,
    },
  });
  assert.equal(imported.status(), 200);

  const serverContext = await browser.newContext({ javaScriptEnabled: false });
  const serverPage = await serverContext.newPage();
  for (const [path, selector] of [
    ["/", ".series-card"],
    [seriesPath(longSeries), ".book-row"],
    ["/removed", ".book-row"],
  ]) {
    await serverPage.goto(testUrl + path);
    assert.equal(await serverPage.locator(selector).count(), 20);
    assert.equal(
      await serverPage.locator("#previousPage, #nextPage, #pagination").count(),
      0,
    );
  }
  await serverContext.close();

  async function open(path, selector) {
    await page.goto(testUrl + path);
    await page.waitForFunction(() => !!window.bookCollection?.state.data);
    await page.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 20,
      selector,
    );
  }
  async function loadAll(selector) {
    const first = await page.locator(selector).first().elementHandle();
    let count = await page.locator(selector).count();
    while (count < 45) {
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await page.waitForFunction(
        ({ selector, count }) =>
          document.querySelectorAll(selector).length > count,
        { selector, count },
      );
      count = await page.locator(selector).count();
    }
    assert.equal(count, 45);
    assert.equal(await first.evaluate((element) => element.isConnected), true);
    assert.match(
      await page.locator(".infinite-scroll").textContent(),
      /All 45/,
    );
  }

  await open("/", ".series-card");
  await loadAll(".series-card");
  assert.equal(
    new Set(
      await page
        .locator(".series-card")
        .evaluateAll((cards) => cards.map((card) => card.title)),
    ).size,
    45,
  );
  await page.locator("#refreshButton").click();
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  assert.equal(await page.locator(".series-card").count(), 45);
  await page.locator("#search").fill("Scroll series 044");
  assert.equal(await page.locator(".series-card").count(), 1);
  await page.locator("#search").fill("no matching scroll series");
  assert.equal(await page.locator(".series-card").count(), 0);
  assert.equal(await page.locator(".infinite-scroll").isHidden(), true);
  await page.locator("#search").fill("");
  assert.equal(await page.locator(".series-card").count(), 20);
  await loadAll(".series-card");
  await page.locator("#collectionFiltersSummary").click();
  await page.locator("#collectionSort").selectOption("recent");
  assert.equal(await page.locator(".series-card").count(), 20);

  await open(seriesPath(longSeries), ".book-row");
  await loadAll(".book-row");
  assert.equal(
    await page.locator(".book-card").last().getAttribute("title"),
    longSeries + ", volume 45",
  );
  await open("/removed", ".book-row");
  await loadAll(".book-row");
  await page.locator(".restore").last().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".book-row").length === 44,
  );
  assert.match(await page.locator(".infinite-scroll").textContent(), /All 44/);
  console.log(
    "PASS infinite shelf, volumes and removed books, stable rows, filter/sort resets, refresh and restore",
  );

  for (const [path, selector, search] of [
    ["/releases", ".release-card", "#releaseSearch"],
    ["/discover", ".discovery-card", "#discoverySearch"],
  ]) {
    await open(path, selector);
    await loadAll(selector);
    await page.locator(search).fill("Scroll release 045");
    assert.equal(await page.locator(selector).count(), 1);
    await page.locator(search).fill("");
    assert.equal(await page.locator(selector).count(), 20);
    await loadAll(selector);
  }

  // A viewport taller than a batch must keep loading without another scroll.
  await page.setViewportSize({ width: 1440, height: 10000 });
  await page.goto(testUrl);
  await page.waitForFunction(
    () => document.querySelectorAll(".series-card").length === 46,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS infinite releases/discovery, final partial batches, tall viewports and route cleanup",
  );
} finally {
  await browser.close();
}
