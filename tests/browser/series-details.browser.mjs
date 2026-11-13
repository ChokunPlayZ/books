import { testUrl as url } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
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
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (failure) => errors.push(failure.message));
  // All names, prices and personal records in this scenario are synthetic.
  const series = "Synthetic Detail Library";
  for (const [title, edition, volume] of [
    [series, "(EN)", 1],
    [series, "(EN)", 3],
    ["合成図書館", "(JP)", 1],
  ]) {
    const response = await page.request.post(url + "/api/rpc", {
      data: {
        name: "saveBook",
        arg: {
          requestId: crypto.randomUUID(),
          book: {
            series: title,
            edition,
            type: "Manga",
            publisher: "Synthetic Detail Press",
            volume,
            isbn: "",
            price: 80,
            msrp: 160,
            msrpCurrency: "THB",
            pageCount: 192,
            status: "Read",
            source: "Synthetic shop",
            date: "2026-11-11",
            note: "Synthetic purchase note",
          },
        },
      },
    });
    assert.equal(response.ok(), true, await response.text());
  }
  assert.equal(
    (
      await page.request.post(url + "/api/rpc", {
        data: {
          name: "linkSeriesInfo",
          arg: { series, type: "Manga", targetSeries: "合成図書館" },
        },
      })
    ).ok(),
    true,
  );
  const source = "https://example.com/synthetic-book";
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getSeriesVolumes")
      return route.fulfill({
        json: {
          items: [1, 2, 3, 4, 4].map((volume, index) => ({
            key: "catalog-synthetic-" + index,
            series,
            title: series + " Vol. " + volume,
            type: "Manga",
            edition: "(EN)",
            language: "en",
            publisher: "Synthetic Detail Press",
            volume,
            isbn: "",
            owned: false,
            url: source + "-" + index,
          })),
        },
      });
    if (name === "getSeriesInfo" || name === "pullSeriesInfo")
      return route.fulfill({
        json: {
          series,
          type: "Manga",
          workId: "local:synthetic-details",
          titles: [
            {
              title: series,
              language: "en",
              source: "Synthetic publisher",
              url: source,
            },
            {
              title: "合成図書館",
              language: "ja",
              source: "Synthetic publisher",
              url: source,
            },
          ],
          synopses: [
            {
              text: "Synthetic synopsis for the detailed series record.",
              language: "en",
              source: "Synthetic publisher",
              url: source,
            },
          ],
          facts: [
            {
              label: "Author",
              value: "Synthetic Creator",
              source: "Synthetic publisher",
              url: source,
            },
          ],
          tags: [
            {
              name: "Romance",
              kind: "Genre",
              source: "Synthetic publisher",
              url: source,
            },
          ],
          editions: [
            { series, type: "Manga", language: "en", count: 1 },
            { series: "合成図書館", type: "Manga", language: "ja", count: 1 },
          ],
          candidates: [],
          warnings: [],
        },
      });
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    if (name === "getAnimeAdaptations")
      return route.fulfill({
        json: { items: [], exactId: null, complete: true },
      });
    return route.continue();
  });
  await page.goto(url + seriesPath(series));
  await page.getByRole("heading", { name: "Publication details" }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll("#bookList .is-missing").length === 2,
  );
  assert.equal(await page.locator(".series-volume-index").count(), 0);
  assert.equal(await page.locator("#bookList .volume-shelf-entry").count(), 4);
  assert.deepEqual(
    await page.locator("#bookList .shelf-caption").allTextContents(),
    ["Volume 1", "Volume 2", "Volume 3", "Volume 4"],
  );
  assert.deepEqual(
    await page
      .locator("#bookList .is-missing .missing-cover-label")
      .allTextContents(),
    ["Missing", "Missing"],
  );
  assert.equal(
    await page.locator("#bookList .book-row .missing-cover-label").count(),
    0,
  );
  assert.match(
    await page.locator("#resultCount").textContent(),
    /2 owned volumes · 2 missing/,
  );
  await page.locator("#toggleSelection").click();
  assert.equal(
    await page.locator("#bookList .is-missing").first().isVisible(),
    false,
  );
  await page.locator("#toggleSelection").click();
  await page.locator("#statusFilter").selectOption("Read");
  assert.equal(await page.locator("#bookList .is-missing").count(), 0);
  await page.locator("#statusFilter").selectOption("");
  assert.match(
    await page.locator(".series-profile-tags").textContent(),
    /Romance/,
  );
  const creator = page.getByRole("link", {
    name: "Synthetic Creator",
    exact: true,
  });
  assert.equal(
    new URL(await creator.getAttribute("href"), url).searchParams.get("field"),
    "Author",
  );
  assert.equal(await page.locator(".metadata-attribution").count(), 0);
  assert.equal(
    await page.locator(".synopsis-source").innerText(),
    "Source: Synthetic publisher",
  );
  assert.equal(await page.getByLabel("Synopsis language").count(), 0);
  assert.doesNotMatch(
    await page.locator(".metadata-facts").textContent(),
    /Synthetic publisher|Your library/,
  );
  mkdirSync(".impeccable/review", { recursive: true });
  await page.screenshot({
    path: ".impeccable/review/publication-desktop.png",
    fullPage: true,
  });
  await page.locator(".suggest-edit > summary").click();
  await page.getByLabel("Field to correct").fill("Author");
  await page
    .getByLabel("Proposed correction")
    .fill("Synthetic corrected creator");
  await page.getByLabel("Source URL (optional)").fill(source);
  await page.getByRole("button", { name: "Submit suggestion" }).click();
  await page
    .getByText("Suggestion saved · Pending review", { exact: true })
    .waitFor();
  assert.equal(
    await creator.textContent(),
    "Synthetic Creator",
    "A suggestion must not replace current metadata",
  );
  await page.reload();
  await page.locator(".suggest-edit > summary").click();
  await page
    .locator(".suggestion-history")
    .getByText("Synthetic corrected creator", { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".impeccable/review/publication-mobile.png",
    fullPage: true,
  });
  for (const [width, theme] of [
    [390, "dark"],
    [320, "light"],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      await page
        .locator("#bookList .is-missing .volume-cover")
        .first()
        .evaluate(
          (cover) =>
            getComputedStyle(cover).borderColor ===
            getComputedStyle(cover.querySelector(".missing-cover-label"))
              .backgroundColor,
        ),
      true,
    );
    await page.locator("#collectionBrowser").screenshot({
      path: `.impeccable/review/series-grid-${width}-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page
      .locator(".title-edit-label")
      .evaluate(
        (element) =>
          element.getBoundingClientRect().width > 30 &&
          getComputedStyle(element).clipPath === "none",
      ),
    true,
    "The edit action must retain a visible handheld label",
  );
  assert.equal(
    await page.evaluate(() => {
      const synopsis = document.querySelector(".series-description-column");
      const metadata = document.querySelector(".series-fact-column");
      const volumes = document.querySelector(".series-owned-content");
      return (
        !!(
          synopsis.compareDocumentPosition(metadata) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ) &&
        !!(
          metadata.compareDocumentPosition(volumes) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
    }),
    true,
    "DOM and keyboard order must follow the handheld reading order",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator(".suggest-edit > summary").click();
  await page.getByRole("button", { name: /Add missing volume 2 of/ }).click();
  assert.equal(await page.locator("#volume").inputValue(), "2");
  assert.equal(await page.locator("#edition").inputValue(), "(EN)");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      document.querySelectorAll("#bookList .is-missing").length === 1,
  );
  assert.deepEqual(
    await page.locator("#bookList .shelf-caption").allTextContents(),
    ["Volume 1", "Volume 2", "Volume 3", "Volume 4"],
  );
  assert.equal(await page.locator("#bookList .book-row").count(), 3);
  const detail = page.locator(".volume-detail-link").first();
  await detail.waitFor();
  await detail.click();
  await page.waitForURL("**/volumes/owned-*");
  assert.match(
    await page.locator(".volume-facts").first().textContent(),
    /THB 160/,
  );
  assert.match(
    await page.locator(".volume-facts").nth(1).textContent(),
    /THB 80/,
  );
  assert.match(
    await page.locator("main").textContent(),
    /Synthetic purchase note/,
  );
  await page
    .locator(".volume-language-editions")
    .getByRole("link", { name: /合成図書館/ })
    .click();
  await page.waitForURL("**/volumes/owned-*");
  assert.match(
    await page.getByRole("heading", { level: 1 }).textContent(),
    /合成図書館/,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.goto(
    url +
      "/browse?" +
      new URLSearchParams({
        field: "Publisher",
        value: "Synthetic Detail Press",
      }),
  );
  assert.equal(await page.locator(".series-card").count(), 2);
  await page.goto(url + "/admin/suggestions");
  await page
    .getByRole("heading", { name: "Metadata suggestions", exact: true })
    .waitFor();
  const suggestion = page
    .locator(".metadata-review-queue li")
    .filter({ hasText: "Synthetic corrected creator" });
  await suggestion.getByRole("button", { name: "Mark reviewed" }).click();
  await page.waitForFunction(
    () => !document.querySelector(".metadata-review-queue li button"),
  );
  await page.reload();
  assert.match(
    await page.locator(".metadata-review-queue").textContent(),
    /Reviewed/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Series details: metadata links, persisted suggestions, admin review, volume pages, prices, language editions and phone overflow passed.",
  );
} finally {
  await browser.close();
}
