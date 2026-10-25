import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { openStore } from "../../lib/server/store.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { createCoverService } from "../../lib/server/covers.ts";
import { seriesPath } from "../../lib/domain/navigation.ts";

const fixture = (name) =>
  readFileSync(
    new URL(
      "../fixtures/publishers/lilyhouse-" + name + ".html",
      import.meta.url,
    ),
    "utf8",
  );
const series = "ธาราคั่งแค้น ฉันท์แสนหมื่นชัง";
const isbn = "9786163377302";
const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const store = openStore(":memory:");
store.api.saveBook({
  requestId: "lilyhouse_browser_seed",
  book: {
    series,
    publisher: "Lilly House",
    type: "LN (TH)",
    volume: 1,
    status: "Read",
    isbn: "",
    price: "",
    date: "",
    source: "",
    note: "",
  },
});
let offline = false;
const api = createApplicationApi(
  store,
  createCoverService(store, { fetchImpl: async () => new Response(bytes) }),
  async (raw) => {
    const url = new URL(raw);
    if (offline || url.hostname !== "lily-house.com")
      return new Response("Unavailable", { status: 503 });
    return new Response(
      fixture(
        url.pathname.includes("/tara4/")
          ? "product"
          : url.searchParams.has("s")
            ? "search"
            : "releases",
      ),
    );
  },
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
    externalImages = [],
    calls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.resourceType() === "image" &&
      request.url().startsWith("https://")
    )
      externalImages.push(request.url());
  });
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/api/covers/**", (route) =>
    route.fulfill({ body: bytes, contentType: "image/png" }),
  );
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    calls.push(name);
    try {
      return route.fulfill({ json: await api[name](arg) });
    } catch (error) {
      return route.fulfill({ status: 400, json: { message: error.message } });
    }
  });
  await page.goto(testUrl + "/releases");
  await page.waitForFunction(
    () =>
      window.bookCollection?.state.releasesLoaded &&
      !window.bookCollection.state.releasesLoading,
  );
  await page.locator("#releasePublisher").selectOption("lilyhouse");
  await page.locator("#releaseScope").selectOption("all");
  await page.locator("#releaseList .release-card").first().waitFor();
  assert.match(
    await page.locator("#publisherSources").textContent(),
    /Lily House/,
  );
  assert.ok(
    await page
      .locator('#releaseList a[href^="https://lily-house.com/shop-2/"]')
      .count(),
  );

  await page.goto(testUrl + "/discover");
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page
    .locator("#discoveryPreset")
    .selectOption("https://lily-house.com/product-category/english-book/");
  await page.locator("#discoverySearch").fill("BESIDE THE DRAGON");
  const english = page
    .locator(".discovery-card")
    .filter({ hasText: "BESIDE THE DRAGON" });
  await english.waitFor();
  assert.match(await english.textContent(), /LN \(EN\)/);
  await english
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#publisher").inputValue(), "Lily House");
  assert.equal(await page.locator("#type").inputValue(), "LN (EN)");
  assert.equal(await page.locator("#volume").inputValue(), "");
  await page.locator("#cancelBook").click();
  await page.locator("#discoverySearch").fill(isbn);
  await page.locator("#discoveryList .release-card").first().waitFor();
  assert.match(
    await page.locator("#discoveryList").textContent(),
    /unverified/,
  );
  await page
    .locator("#discoveryList .release-card")
    .first()
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#isbn").inputValue(), isbn);
  await page.locator("#cancelBook").click();

  await page.goto(testUrl + seriesPath(series));
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#seriesReleaseList .release-card").length ===
      3,
  );
  assert.match(
    await page.locator("#seriesReleaseSources").textContent(),
    /Lily House/,
  );
  await page.locator("#seriesCatalogDetails > summary").click();
  await page
    .getByRole("button", { name: "Change search title", exact: true })
    .click();
  const search = page.getByLabel("Series title on Lily House");
  assert.equal(await search.inputValue(), series);
  await search.fill(series);
  await page
    .getByRole("button", { name: "Use this catalog", exact: true })
    .click();
  await page.waitForFunction(
    () => !window.bookCollection.state.catalogLoading.size,
  );
  assert.ok(calls.includes("setSeriesCatalog"));
  assert.ok(!calls.includes("getSeriesCategories"));
  const volume4 = page
    .locator("#seriesReleaseList .release-card")
    .filter({ hasText: "Volume 4" });
  await volume4
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#series").inputValue(), series);
  assert.equal(await page.locator("#volume").inputValue(), "4");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection.state.busy,
  );
  assert.equal(store.api.getCollection().books.length, 2);
  offline = true;
  await page.locator("#refreshSeriesReleases").click();
  await page.waitForFunction(
    () =>
      !window.bookCollection.state.catalogRefreshing &&
      !window.bookCollection.state.catalogLoading.size,
  );
  assert.match(
    await page.locator("#seriesReleaseSources").textContent(),
    /previous check/i,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(externalImages, []);
  assert.deepEqual(errors, []);
  console.log(
    "Lily House browser scenario passed: releases, discovery, ISBN review, series search, saving, covers and offline reuse",
  );
} finally {
  await browser.close();
  store.close();
}
