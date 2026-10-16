import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { seriesPath } from "../../lib/domain/navigation.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const series = "Navigation " + Date.now() + " เรื่อง / 100% ? #";
const path = seriesPath(series);
const ready = (page) =>
  page.waitForFunction(() => !!window.bookCollection?.state.data);
let records = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const volume of [1, 2]) {
    const response = await page.request.post(testUrl + "/api/rpc", {
      data: {
        name: "saveBook",
        arg: {
          requestId: crypto.randomUUID(),
          book: {
            series,
            volume,
            isbn: "",
            type: "Other",
            publisher: "",
            source: "",
            status: "Read",
            price: 100,
            date: "",
            note: "",
          },
        },
      },
    });
    assert.equal(response.status(), 200);
  }
  const data = await (
    await page.request.post(testUrl + "/api/rpc", {
      data: { name: "getCollection" },
    })
  ).json();
  records = data.books.filter((book) => book.series === series);

  // The shelf links and title contents must be usable in the server HTML.
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const serverPage = await plain.newPage();
  await serverPage.goto(testUrl);
  const link = serverPage.getByRole("link", {
    name: `Open ${series}, 2 owned volumes`,
    exact: true,
  });
  assert.equal(await link.getAttribute("href"), path);
  await link.click();
  assert.equal(new URL(serverPage.url()).pathname, path);
  assert.equal(await serverPage.locator("#seriesTitle").textContent(), series);
  assert.equal(await serverPage.locator(".book-row").count(), 2);
  assert.equal(
    await serverPage
      .locator("#releasesPanel, #discoverPanel, #collectionStats")
      .count(),
    0,
  );
  await plain.close();

  await page.goto(testUrl);
  await ready(page);
  await page.locator("#search").fill(series);
  await page.evaluate(() => {
    window.documentMarker = true;
  });
  await page.locator(".series-row").focus();
  await Promise.all([
    page.waitForURL(testUrl + path),
    page.locator(".series-row").press("Enter"),
  ]);
  await ready(page);
  assert.equal(new URL(page.url()).pathname, path);
  assert.equal(await page.evaluate(() => window.documentMarker), undefined);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator("#seriesTitle").textContent(), series);
  assert.equal(await page.locator(".book-row").count(), 2);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const first = await page.locator(".book-row").first().boundingBox();
    await page.screenshot({
      path: join(process.cwd(), "outputs", `book-page-${width}.png`),
      fullPage: true,
    });
    assert.ok(
      first.y < (width === 390 ? 530 : 390),
      `Owned volumes stay near the top of the page (${width}px viewport, first row at ${first.y}px)`,
    );
  }
  await page.locator("#backSeries").click();
  await ready(page);
  assert.equal(new URL(page.url()).pathname, "/");
  await page.goBack();
  await ready(page);
  assert.equal(await page.locator("#seriesTitle").textContent(), series);
  await page.goForward();
  await ready(page);
  assert.equal(new URL(page.url()).pathname, "/");

  for (const [id, destination, panel] of [
    ["releasesTab", "/releases", "releasesPanel"],
    ["discoverTab", "/discover", "discoverPanel"],
    ["trashTab", "/removed", "collectionBrowser"],
  ]) {
    await page.locator("#" + id).click();
    await ready(page);
    assert.equal(new URL(page.url()).pathname, destination);
    assert.equal(
      await page.locator("#" + id).getAttribute("aria-current"),
      "page",
    );
    assert.equal(await page.locator("#" + panel).isVisible(), true);
    await page.reload();
    await ready(page);
    assert.equal(new URL(page.url()).pathname, destination);
    if (destination !== "/removed")
      assert.equal(
        await page.locator("#collectionBrowser, #seriesHeader").count(),
        0,
      );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS server-rendered title pages, encoded names, document navigation, direct reload, Back/Forward, separate views and compact phone/desktop layouts",
  );
} finally {
  const cleanup = await browser.newPage();
  for (const book of records)
    await cleanup.request.post(testUrl + "/api/rpc", {
      data: {
        name: "removeBook",
        arg: {
          requestId: crypto.randomUUID(),
          row: book.row,
          token: book.token,
        },
      },
    });
  await browser.close();
}
