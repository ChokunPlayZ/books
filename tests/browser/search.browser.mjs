import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { seriesPath } from "../../lib/domain/navigation.ts";

const coverId = "a".repeat(64);
const lazyId = "b".repeat(64);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
  "base64",
);
const result = (id, series, volume, extra = {}) => ({
  id,
  kind: "title",
  title: `${series}, volume ${volume}`,
  series,
  publisher: "Phoenix Next",
  type: "Manga",
  volume,
  isbn: "",
  url: "https://www.phoenixnext.com/" + id + ".html",
  known: true,
  owned: false,
  sources: [],
  score: 0,
  ...extra,
});
const results = [
  result("owned-1", "Moon Library", 1, {
    owned: true,
    librarySeries: "Moon Library",
    coverId,
  }),
  result("owned-2", "Moon Library", 2, {
    owned: true,
    librarySeries: "Moon Library",
    coverId,
  }),
  result("online-3", "Moon Library", 3, {
    coverUrl: "https://www.phoenixnext.com/media/catalog/product/moon.png",
    sources: [
      {
        id: "phoenix",
        name: "Phoenix Next",
        url: "https://www.phoenixnext.com/online-3.html",
      },
    ],
  }),
  result("no-cover", "Moon Garden", 1),
  result("broken-cover", "Moon Station", 1, { coverId: "c".repeat(64) }),
  result("novel", "Moon Library", 1, { type: "Light novel", coverId }),
  result("publisher", "Moon Press", "", {
    kind: "publisher",
    title: "Moon Press",
    series: "",
  }),
];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const errors = [];
  const coverRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/covers/*", (route) =>
    route.request().url().endsWith("c".repeat(64))
      ? route.abort()
      : route.fulfill({ body: png, contentType: "image/png" }),
  );
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "searchKnownEntities")
      return route.fulfill({
        json: {
          query: arg.query,
          results: arg.query === "Nothing" ? [] : results,
          sources: [],
        },
      });
    if (name === "getSearchCover") {
      coverRequests.push(arg);
      return route.fulfill({ json: { coverId: lazyId } });
    }
    return route.continue();
  });
  await page.goto(testUrl + "/search?q=Moon");
  const cards = page.locator("#universalSearchResults > li");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#universalSearchResults > li").length === 5,
  );
  const group = page.getByRole("button", { name: "Group series", exact: true });
  assert.equal(await group.getAttribute("aria-pressed"), "true");
  await group.click();
  assert.equal(await cards.count(), 7);
  await page.locator(`img[src="/api/covers/${lazyId}"]`).waitFor();
  assert.ok(
    coverRequests.some(
      (request) => request.id === "online-3" && request.query === "Moon",
    ),
  );
  assert.equal(
    await cards.first().locator(".universal-search-book").getAttribute("href"),
    seriesPath("Moon Library"),
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".universal-search-result .cover-placeholder")
        .length === 2,
  );
  assert.equal(
    await page.locator(".universal-search-result .cover-placeholder").count(),
    2,
  );
  const boxes = await cards.evaluateAll((items) =>
    items.map((item) => {
      const { x, y } = item.getBoundingClientRect();
      return { x, y };
    }),
  );
  assert.ok(boxes.filter((box) => box.y === boxes[0].y).length >= 4);
  const searchWidth = await page
    .locator(".universal-search")
    .evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(searchWidth > 1000, "desktop search uses the full content width");
  if (process.env.BOOKS_TEST_SCREENSHOT_DIR)
    await page.screenshot({
      path: process.env.BOOKS_TEST_SCREENSHOT_DIR + "/search-desktop.png",
      fullPage: true,
    });
  await group.click();
  assert.equal(await group.getAttribute("aria-pressed"), "true");
  assert.equal(await cards.count(), 5);
  if (process.env.BOOKS_TEST_SCREENSHOT_DIR)
    await page.screenshot({
      path: process.env.BOOKS_TEST_SCREENSHOT_DIR + "/search-grouped.png",
      fullPage: true,
    });
  const series = page.locator(".universal-search-series");
  await series.locator("summary").click();
  assert.equal(await series.locator("details").getAttribute("open"), "");
  if (process.env.BOOKS_TEST_SCREENSHOT_DIR)
    await page.screenshot({
      path: process.env.BOOKS_TEST_SCREENSHOT_DIR + "/search-expanded.png",
      fullPage: true,
    });
  assert.equal(await series.locator(".universal-search-volume").count(), 3);
  assert.match(
    await series.locator("ol").innerText(),
    /Volume 1[\s\S]*Volume 2[\s\S]*Volume 3/,
  );
  assert.equal(
    await series
      .getByRole("link", { name: "Phoenix Next ↗", exact: true })
      .getAttribute("href"),
    "https://www.phoenixnext.com/online-3.html?ref=meemai.ckl.moe",
  );
  await page.keyboard.press("Enter");
  assert.equal(await series.locator("details").getAttribute("open"), null);
  await group.click();
  assert.equal(await cards.count(), 7);
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  assert.equal(await group.isVisible(), true);
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "light"),
  );
  for (const width of [1440, 1000, 760, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `no overflow at ${width}px`,
    );
    if (width <= 760) {
      const columns = await page
        .locator(".universal-search-results")
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        );
      assert.equal(columns, width < 560 ? 2 : 3);
    }
    if (width === 390 && process.env.BOOKS_TEST_SCREENSHOT_DIR)
      await page.screenshot({
        path: process.env.BOOKS_TEST_SCREENSHOT_DIR + "/search-phone.png",
        fullPage: true,
      });
  }
  await page.locator("#universalSearchQuery").fill("Nothing");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("heading", { name: "No matching titles found" })
    .waitFor();
  assert.equal(await cards.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS search covers, lazy images, missing/broken cover fallback, desktop grid, series grouping, links, keyboard and responsive layout",
  );
} finally {
  await browser.close();
}
