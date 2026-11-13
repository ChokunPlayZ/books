import { testUrl as url } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
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
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const series = "แผนสมรสไม่สมเลิฟ";
  // Synthetic ownership and catalog records for the reported series.
  for (let volume = 1; volume <= 5; volume++) {
    const response = await page.request.post(url + "/api/rpc", {
      data: {
        name: "saveBook",
        arg: {
          requestId: crypto.randomUUID(),
          book: {
            series,
            volume,
            type: "Manga",
            edition: "(TH)",
            publisher: "PHOENIX Next",
            status: "Read",
          },
        },
      },
    });
    assert.equal(response.ok(), true, await response.text());
  }
  const listing = (volume, revised = false, title = series) =>
    normalizeRecordTypes({
      ...releaseItem(
        "phoenix",
        `(มังงะ) ${title}${revised ? " (ฉบับปรับปรุงใหม่)" : ""} เล่ม ${volume}`,
        `https://www.phoenixnext.com/test-revised-${volume}-${revised}.html`,
        175,
        "",
        "Manga (TH)",
      ),
      catalogSeries: series,
      catalogVariant: revised,
    });
  const revised = listing(5, true);
  const futureRevised = listing(7, true);
  const regular = [listing(1), listing(5)];
  let items = [...regular, revised, futureRevised];
  let stale = false;
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
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
    if (name === "getSeriesCatalog")
      return route.fulfill({
        json: {
          series,
          type: "Manga",
          publisherId: "phoenix",
          title: series,
          url: "https://www.phoenixnext.com/book-series/fuufu-ijou.html",
          items,
          complete: !stale,
          stale,
          error: stale ? "Test outage" : "",
          checkedAt: "2026-11-12T00:00:00Z",
        },
      });
    return route.continue();
  });
  await page.goto(url + seriesPath(series));
  const settled = () =>
    page.waitForFunction(
      () =>
        !!window.bookCollection?.state.data &&
        !window.bookCollection.state.catalogLoading.size &&
        !window.bookCollection.state.catalogRefreshing,
    );
  await settled();
  const section = page.locator("#seriesRevisedEditions");
  await page.locator("#bookList .book-row").first().waitFor();
  const notice = page.getByRole("link", {
    name: "Revised editions available",
    exact: true,
  });
  await notice.waitFor();
  assert.equal(
    await notice.evaluate(
      (element) => element.getBoundingClientRect().top < innerHeight,
    ),
    true,
  );
  await notice.click();
  await section.waitFor();
  assert.equal(new URL(page.url()).hash, "#seriesRevisedEditions");
  assert.equal(await page.locator("#seriesRevisedList li").count(), 2);
  assert.match(
    await page.locator("#seriesMissingSummary").textContent(),
    /0 gaps.*2 revised-edition listings/,
  );
  assert.equal(
    await page.locator("#seriesReleaseList .release-card").count(),
    0,
  );
  assert.equal(
    await page.locator("#seriesCatalogDetails").getAttribute("open"),
    null,
  );
  assert.equal(
    await page.locator("#seriesReleaseReview").getAttribute("open"),
    null,
  );
  assert.equal(
    await section.getByRole("button").count(),
    0,
    "Alternatives must not change ownership",
  );
  const link = section.getByRole("link", { name: revised.title, exact: true });
  const source = new URL(await link.getAttribute("href"));
  assert.equal(source.origin + source.pathname, revised.url);
  assert.equal(await link.getAttribute("target"), "_blank");
  await link.focus();
  assert.equal(
    await link.evaluate(
      (element) => element.getBoundingClientRect().height >= 44,
    ),
    true,
  );
  mkdirSync("outputs", { recursive: true });
  for (const [theme, width] of [
    ["light", 1440],
    ["light", 390],
    ["dark", 390],
  ]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `outputs/revised-editions-${theme}-${width}.png`,
      fullPage: true,
    });
  }
  stale = true;
  await page.locator("#refreshSeriesReleases").click();
  await settled();
  assert.equal(
    await section.isVisible(),
    true,
    "Stale catalogs retain revised alternatives",
  );
  assert.match(
    await page.locator("#seriesReleaseStatus").textContent(),
    /unavailable/,
  );
  stale = false;
  items = regular;
  await page.locator("#refreshSeriesReleases").click();
  await settled();
  assert.equal(await section.isVisible(), false);
  assert.equal(await notice.isVisible(), false);
  assert.equal(await page.locator("#seriesMissing").isVisible(), false);
  assert.equal(await page.locator("#seriesCatalogToggle").isVisible(), true);
  items = [revised, futureRevised, listing(9, true, "Unrelated work")];
  await page.locator("#seriesCatalogToggle").click();
  await page.locator("#refreshSeriesReleases").click();
  await settled();
  assert.equal(
    await page.locator("#seriesRevisedList li").count(),
    2,
    "An unrelated revised work stays in generic edition review",
  );
  const response = await page.request.post(url + "/api/rpc", {
    data: { name: "getCollection" },
  });
  assert.equal(
    (await response.json()).books.filter((book) => book.series === series)
      .length,
    5,
  );
  items = [...regular, revised, futureRevised];
  assert.equal(
    (
      await page.request.patch(url + "/api/preferences", {
        data: { locale: "th" },
      })
    ).ok(),
    true,
  );
  await page.reload();
  await settled();
  await page.locator("#bookList .book-row").first().waitFor();
  await page
    .getByRole("link", { name: "มีฉบับปรับปรุงใหม่", exact: true })
    .click();
  await section
    .getByRole("heading", { name: "ฉบับปรับปรุงใหม่", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "มีฉบับปรับปรุงใหม่", exact: true })
    .waitFor();
  assert.match(
    await section.textContent(),
    /ไม่เปลี่ยนหนังสือที่คุณมีหรือจำนวนเล่มที่ขาด/,
  );
  assert.match(
    await page.locator("#seriesMissingSummary").textContent(),
    /ฉบับปรับปรุงใหม่ 2 รายการ/,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "outputs/revised-editions-th-390.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Revised editions: visible alternatives, complete shelves, unchanged ownership/counts, publisher links, stale/empty catalogs, unrelated variants and responsive themes passed.",
  );
} finally {
  await browser.close();
}
