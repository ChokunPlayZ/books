import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const store = openStore(":memory:");
let offline = false;
const catalogs = createCatalogService(store, async (url, options) => {
  if (offline) return new Response("Offline", { status: 503 });
  if (url === "https://yenpress.com/search")
    return new Response(fixture("yenpress-search.html"));
  if (url.includes("enterprise-search.yenpress.com")) {
    const query = JSON.parse(options.body);
    return new Response(
      fixture(
        query.filters.all.some((filter) => filter.type === "series")
          ? `yenpress-directory-${query.page.current}.json`
          : "yenpress-print-releases.json",
      ),
    );
  }
  if (url === "https://yenpress.com/series/solo-leveling-comic")
    return new Response(fixture("yenpress-series.html"));
  if (url === "https://yenpress.com/series/solo-leveling-novel")
    return new Response(fixture("yenpress-novel-series.html"));
  if (url === "https://yenpress.com/calendar")
    return new Response(fixture("yenpress-calendar.html"));
  return new Response(
    '<section><a href="/category/light-novels">Novels</a><h1>Upcoming title<sup>0</sup></h1></section><section id="volumes-list"></section>',
  );
});
const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const coverId = createHash("sha256").update(bytes).digest("hex");
function images(value) {
  if (!value || typeof value !== "object") return;
  if (value.coverUrl) value.coverId = coverId;
  for (const child of Object.values(value)) images(child);
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    if (name === "getPublisherReleases" && arg.publisherId !== "yenpress")
      return route.fulfill({
        json: {
          publisherId: arg.publisherId,
          items: [],
          checkedAt: new Date().toISOString(),
        },
      });
    if (
      ![
        "getPublisherDirectory",
        "getPublisherTitle",
        "getPublisherReleases",
        "getSeriesCatalog",
        "getSeriesCategories",
      ].includes(name)
    )
      return route.continue();
    const result = structuredClone(await catalogs[name](arg));
    images(result);
    return route.fulfill({ json: result });
  });
  await page.goto(testUrl + "/discover");
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#discoveryPreset").selectOption("https://yenpress.com/");
  await page.waitForFunction(
    () => document.querySelectorAll(".discovery-card").length === 3,
  );
  for (const title of [
    "Solo Leveling (comic)",
    "Solo Leveling (novel)",
    "The Returned Tyrant Princess Rewrites Her Dark Past",
  ]) {
    await page.evaluate((title) => {
      const card = [...document.querySelectorAll(".discovery-card")].find(
        (card) => card.textContent.includes(title),
      );
      card?.scrollIntoView({ block: "center" });
    }, title);
    await page.waitForFunction((title) => {
      const card = [...document.querySelectorAll(".discovery-card")].find(
        (card) => card.textContent.includes(title),
      );
      return title.startsWith("Solo Leveling")
        ? card?.textContent.includes("Volume 1")
        : !card;
    }, title);
  }
  await page.waitForFunction(
    () => document.querySelectorAll(".discovery-card").length === 2,
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".discovery-card")].filter(
        (card) =>
          card.textContent.includes("Solo Leveling") &&
          card.textContent.includes("Volume 1"),
      ).length === 2,
  );
  await page.locator("#discoveryType").selectOption("LN");
  assert.equal(await page.locator(".discovery-card").count(), 1);
  assert.match(
    await page.locator(".discovery-card").textContent(),
    /LN \(EN\)/,
  );
  await page.locator("#discoveryType").selectOption("Manga");
  assert.equal(await page.locator(".discovery-card").count(), 1);
  assert.match(
    await page.locator(".discovery-card").textContent(),
    /Manga \(EN\)/,
  );
  await page
    .locator(".discovery-card")
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#type").inputValue(), "Manga (EN)");
  assert.equal(await page.locator("#publisher").inputValue(), "Yen Press");
  await page.locator("#publisher").fill("Ize Press");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection.state.busy,
  );
  await page.locator("#collectionTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#search").fill("Solo Leveling");
  await page.locator(".series-row").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#seriesReleaseList .release-card").length ===
      14,
  );
  assert.match(
    await page.locator("#seriesReleaseSources").textContent(),
    /Yen Press/,
  );
  assert.match(
    await page.locator("#seriesReleaseList").textContent(),
    /Volume 2/,
  );
  await page.locator("#releasesTab").click();
  await page.waitForFunction(
    () =>
      window.bookCollection?.state.releasesLoaded &&
      !window.bookCollection.state.releasesLoading,
  );
  await page.locator("#releasePublisher").selectOption("yenpress");
  await page.locator("#releaseScope").selectOption("all");
  assert.equal(await page.locator(".release-card").count(), 3);
  await page.locator("#releaseType").selectOption("LN");
  assert.equal(await page.locator(".release-card").count(), 2);
  await page
    .locator(".release-card")
    .first()
    .getByRole("button", { name: "Save for later", exact: true })
    .click();
  await page.waitForFunction(
    () => !window.bookCollection.state.savingReleases.size,
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      window.bookCollection?.state.releasesLoaded &&
      !window.bookCollection.state.releasesLoading,
  );
  await page.locator("#releasePublisher").selectOption("yenpress");
  await page.locator("#releaseScope").selectOption("saved");
  assert.equal(await page.locator(".release-card").count(), 1);
  offline = true;
  await page.locator("#refreshReleases").click();
  await page.waitForFunction(
    () => !window.bookCollection.state.releasesLoading,
  );
  assert.match(
    await page.locator("#publisherSources").textContent(),
    /Could not refresh Yen Press/,
  );
  assert.equal(await page.locator(".release-card").count(), 1);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS Yen Press discovery with separate English formats, Ize Press series matching, missing volumes, release filters, save/reload and cached outages",
  );
} finally {
  await browser.close();
  store.close();
}
