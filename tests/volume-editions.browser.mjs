// Uses the real Node catalog parser and an isolated in-memory library.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { openStore } from "../lib/server/store.mjs";
import { createCatalogService } from "../lib/server/catalogs.mjs";
import { releaseItem_ } from "../lib/domain.mjs";

const title = "ดอกรักผลิบานที่กลางใจ",
  colorTitle = "ชิโนะกับเร็น";
const store = openStore(":memory:");
const snapshot = JSON.parse(
  readFileSync(new URL("../preview/books.json", import.meta.url), "utf8"),
);
for (const book of snapshot.filter(
  (book) => book.series === title || book.series === colorTitle,
))
  store.api.saveBook({ book, requestId: crypto.randomUUID() });
const card = (volume, special = "") =>
  `<a class="product-item-link" href="https://www.phoenixnext.com/color-${special ? "special-" : ""}${volume}.html">(มังงะ) ${special}${colorTitle} เล่ม ${volume}</a>`;
const service = createCatalogService(
  store,
  async (url) =>
    new Response(
      url.includes("book-series.html")
        ? readFileSync(
            new URL(
              "./fixtures/series-catalogs/phoenix-directory.html",
              import.meta.url,
            ),
            "utf8",
          )
        : url.includes("shino-to-ren")
          ? `<h1>${colorTitle}</h1><span class="toolbar-number">8</span>${[1, 2, 3, 4, 5, 6, 7].map((v) => card(v)).join("")}${card(6, "Special Set ")}`
          : readFileSync(
              new URL(
                "./fixtures/series-catalogs/phoenix-category.html",
                import.meta.url,
              ),
              "utf8",
            ),
    ),
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  const coloredListing = releaseItem_(
    "phoenix",
    `(มังงะ) ${colorTitle} เล่ม 7 (Color)`,
    "https://www.phoenixnext.com/color-edition-7.html",
    175,
    "",
    "Manga (TH) (Color)",
  );
  const wrongLanguage = releaseItem_(
    "phoenix",
    `(มังงะ) ${colorTitle} เล่ม 8`,
    "https://www.phoenixnext.com/color-jp-8.html",
    175,
    "",
    "Manga (JP)",
  );
  await page.route("**/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    try {
      let result;
      if (name === "getSeriesCatalog") {
        result = await service.getSeriesCatalog(arg);
        if (arg.series === colorTitle)
          result = {
            ...result,
            items: [...result.items, coloredListing, wrongLanguage],
          };
      } else if (name === "getPublisherReleases") {
        result = {
          publisherId: arg.publisherId,
          checkedAt: new Date().toISOString(),
          items:
            arg.publisherId === "phoenix"
              ? (
                  await service.getSeriesCatalog({
                    series: colorTitle,
                    publisherId: "phoenix",
                    type: "Manga (TH)",
                  })
                ).items
              : [],
          stale: false,
          error: "",
        };
      } else result = store.api[name](arg);
      return route.fulfill({ json: result });
    } catch (error) {
      return route.fulfill({ status: 400, json: { message: error.message } });
    }
  });
  await page.goto(process.env.BOOKS_PREVIEW_URL || "http://localhost:3000");
  await page.waitForFunction(() => !!state.data);
  const openSeries = async (series) => {
    await page.locator("#search").fill(series);
    await page.locator(".series-row").click();
    await page.waitForFunction(() => !state.catalogLoading.size);
  };
  await openSeries(title);
  const missing = page.locator("#seriesReleaseList .release-card");
  assert.equal(await missing.count(), 1);
  assert.match(await missing.textContent(), /Volume 22/);
  assert.match(
    await missing.textContent(),
    /Other listings for this volume \(4\)/,
  );
  assert.match(
    await page.locator("#seriesMissingSummary").textContent(),
    /0 gaps.*1 catalog volume/,
  );
  assert.equal(
    await page
      .locator("#seriesReleaseReviewList .release-card")
      .filter({ hasText: "Special Set B" })
      .count(),
    1,
  );
  assert.match(
    await page
      .locator("#seriesReleaseReviewList .release-card")
      .filter({ hasText: "Special Set B" })
      .textContent(),
    /Volume on your shelf/,
  );
  const special22 = (
    await service.getSeriesCatalog({
      series: title,
      publisherId: "phoenix",
      type: "Manga (TH)",
    })
  ).items.find((item) => item.special && item.volume === 22);
  store.api.saveBook({
    book: {
      series: title,
      type: "Manga (TH)",
      publisher: "PHOENIX Next",
      volume: 22,
      status: "Read",
      note: special22.title,
    },
    requestId: crypto.randomUUID(),
  });
  await page.locator("#refreshSeriesReleases").click();
  await page.waitForFunction(
    () => !state.catalogLoading.size && !state.catalogRefreshing,
  );
  assert.equal(await missing.count(), 0);
  assert.ok(
    (
      await page
        .locator("#seriesReleaseReviewList .release-card")
        .filter({ hasText: "Volume 22" })
        .allTextContents()
    ).every((text) => text.includes("Volume on your shelf")),
  );
  console.log(
    "PASS real Phoenix alternate editions group into one missing volume; either edition satisfies ownership",
  );

  await page.locator("#backSeries").click();
  await openSeries(colorTitle);
  assert.equal(await page.locator(".missing-edition").count(), 1);
  assert.match(
    await page.locator("#seriesGaps").textContent(),
    /No gaps through volume 5/,
  );
  assert.match(
    await page.locator("#seriesMissingSummary").textContent(),
    /0 gaps.*2 catalog volumes/,
  );
  assert.equal(await missing.count(), 2);
  assert.ok(
    (await missing.allTextContents()).every((text) =>
      /Other listings for this volume \(1\)/.test(text),
    ),
  );
  assert.equal(await missing.filter({ hasText: "Volume 8" }).count(), 0);
  const volume6 = missing.filter({
    has: page.getByRole("heading", {
      name: `(มังงะ) ${colorTitle} เล่ม 6`,
      exact: true,
    }),
  });
  await volume6
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#series").inputValue(), colorTitle);
  assert.equal(await page.locator("#type").inputValue(), "Manga (TH)");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () => !document.getElementById("bookDialog").open && !state.busy,
  );
  assert.equal(await missing.count(), 1);
  assert.match(await missing.textContent(), /Volume 7/);
  assert.match(
    await page.locator("#seriesGaps").textContent(),
    /No gaps through volume 6/,
  );
  assert.equal(
    store.api
      .getCollection()
      .books.filter(
        (book) =>
          book.series === colorTitle && book.type === "Manga (TH) (Color)",
      ).length,
    4,
  );
  await page.locator("#releasesTab").click();
  await page.waitForFunction(
    () => state.releasesLoaded && !state.releasesLoading,
  );
  assert.equal(await page.locator("#releaseList .release-card").count(), 1);
  assert.match(await page.locator("#releaseList").textContent(), /Volume 7/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS mixed colored/regular manga has no false gaps or owned releases; new purchases update both views",
  );
} finally {
  await browser.close();
  store.close();
}
