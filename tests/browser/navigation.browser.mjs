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
const legacyPath = "/series/" + Buffer.from(series).toString("base64url");
assert.match(path, /^\/series\/navigation-\d+-rueang-100--[a-z0-9]{7}$/);
const ready = (page) =>
  page.waitForFunction(() => !!window.bookCollection?.state.data);
let records = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/rpc", (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    if (name === "getPublisherReleases")
      return route.fulfill({ json: { items: [], complete: true } });
    if (name === "getPublisherDirectory")
      return route.fulfill({
        json: { url: arg.url, titles: [], items: [], complete: true },
      });
    return route.continue();
  });
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
    await serverPage.locator("#bookList.cover-grid .book-card").count(),
    2,
  );
  assert.equal(
    await serverPage
      .locator("#releasesPanel, #discoverPanel, #collectionStats")
      .count(),
    0,
  );
  await serverPage.goto(testUrl + legacyPath + "?source=bookmark&tag=1&tag=2");
  await serverPage.waitForURL(testUrl + path + "?source=bookmark&tag=1&tag=2");
  assert.equal(await serverPage.locator("#seriesTitle").textContent(), series);
  assert.equal(await serverPage.title(), series + " · meemai");
  const outdatedPath = path.replace(/\/[^/]+--/, "/old-spelling--");
  await serverPage.goto(testUrl + outdatedPath);
  await serverPage.waitForURL(testUrl + path);
  assert.equal(await serverPage.locator(".book-row").count(), 2);
  await plain.close();

  await page.goto(testUrl);
  await ready(page);
  assert.equal(await page.locator("#pricesTab, #findBookPrices").count(), 0);
  assert.equal(await page.locator('a[href^="/prices"]').count(), 0);
  assert.equal((await page.request.get(testUrl + "/prices")).status(), 404);
  assert.equal(
    (
      await page.request.post(testUrl + "/api/rpc", {
        data: { name: "findLowestPrices", arg: { isbn: "9786166247275" } },
      })
    ).status(),
    404,
  );
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
  assert.deepEqual(
    await page
      .locator(".book-card")
      .evaluateAll((cards) => cards.map((card) => card.title)),
    [1, 2].map((volume) => `${series}, volume ${volume}`),
  );
  assert.equal(
    await page
      .locator(
        "#bookList .book-copy, #bookList .book-status, #bookList .price, #bookList .volume-actions",
      )
      .count(),
    0,
  );
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const first = await page.locator(".book-row").first().boundingBox();
    const second = await page.locator(".book-row").nth(1).boundingBox();
    assert.ok(first.width > 100 && first.height > first.width);
    assert.equal(first.y, second.y);
    assert.ok(second.x > first.x);
    await page.screenshot({
      path: join(process.cwd(), "outputs", `book-page-${width}.png`),
      fullPage: true,
    });
    // Series profiles can precede the shelf; owned books remain one jump away.
    await page
      .getByRole("link", { name: "Owned volumes", exact: true })
      .click();
    await page.waitForFunction(() => {
      const first = document
        .querySelector("#bookList .book-row")
        ?.getBoundingClientRect();
      return first && first.top < innerHeight && first.bottom > 0;
    });
  }
  const volume = page.getByRole("button", {
    name: `Edit ${series}, volume 2`,
    exact: true,
  });
  await volume.focus();
  await volume.press("Enter");
  assert.equal(await page.locator("#bookDialog").isVisible(), true);
  assert.equal(await page.locator("#volume").inputValue(), "2");
  assert.equal(await page.locator("#removeButton").isVisible(), true);
  await page.locator("#cancelBook").click();
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
    "PASS server-rendered title pages, karaoke slugs, legacy bookmark redirects, cover-only volume grids, keyboard editing, document navigation, direct reload, Back/Forward and phone/desktop layouts",
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
