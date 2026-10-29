import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { createTestLibrary } from "../helpers/library.mjs";
import { seriesPath } from "../../lib/domain/navigation.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/kodansha-" + name, import.meta.url),
    "utf8",
  );
const seriesUrl = "https://www.kodansha.co.jp/titles/1000033206";
const library = createTestLibrary([
  {
    series: "Blue Lock",
    type: "Manga (JP)",
    publisher: "講談社",
    volume: 1,
    status: "Read",
    isbn: "9784065134009",
  },
]);
const entries = [
  { match: "comic/new-releases/p?page=2", text: fixture("releases-2.html") },
  { match: "comic/new-releases/p", text: fixture("releases.html") },
  ...Array.from({ length: 5 }, (_, count) => ({
    match: "/titles/1000033206/api?count=" + count,
    text: fixture("series-" + count + ".json"),
  })),
  { match: "/titles/1000033206", text: fixture("series.html") },
];
library.setResponses(entries);
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
      return route.fulfill({ json: { row: arg.row, coverUrl: "" } });
    if (name === "getPublisherReleases" && arg.publisherId !== "kodansha")
      return route.fulfill({
        json: {
          publisherId: arg.publisherId,
          items: [],
          checkedAt: "",
          stale: false,
          error: "",
        },
      });
    try {
      return await route.fulfill({ json: await library.api[name](arg) });
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
  await page.locator("#releasePublisher").selectOption("kodansha");
  await page.locator("#releaseScope").selectOption("all");
  assert.ok((await page.locator("#releaseList .release-card").count()) > 0);
  assert.match(
    await page.locator("#publisherSources").textContent(),
    /Kodansha JP/,
  );
  await page
    .locator("#releaseList .release-card")
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
  await page.locator("#releasePublisher").selectOption("kodansha");
  await page.locator("#releaseScope").selectOption("saved");
  assert.equal(await page.locator("#releaseList .release-card").count(), 1);

  await page.goto(testUrl + "/discover");
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page
    .locator("#discoveryPreset")
    .selectOption("https://www.kodansha.co.jp/comic/new-releases/p");
  await page.waitForFunction(
    () => document.querySelectorAll(".discovery-card").length > 0,
  );
  assert.match(
    await page.locator("#discoverySource").textContent(),
    /Kodansha JP/,
  );
  await page
    .locator(".discovery-card")
    .filter({ hasText: "Manga (JP)" })
    .first()
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#publisher").inputValue(), "Kodansha JP");
  assert.equal(await page.locator("#type").inputValue(), "Manga (JP)");
  assert.equal(await page.locator("#price").inputValue(), "");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.goto(testUrl + seriesPath("Blue Lock"));
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page
    .getByLabel("Or paste the series category URL")
    .fill(seriesUrl + "#publications");
  await page
    .getByRole("button", { name: "Use this catalog", exact: true })
    .click();
  await page.waitForFunction(() =>
    [...(window.bookCollection?.state.seriesCatalogs.values() || [])].some(
      (catalog) => catalog.publisherId === "kodansha" && catalog.complete,
    ),
  );
  assert.match(
    await page.locator("#seriesReleaseList").textContent(),
    /Volume 2/,
  );
  assert.equal(library.api.getCollection().seriesCatalogs[0].url, seriesUrl);
  library.setResponses(entries.map((entry) => ({ ...entry, status: 503 })));
  await page.reload();
  await page.waitForFunction(() =>
    [...(window.bookCollection?.state.seriesCatalogs.values() || [])].some(
      (catalog) => catalog.publisherId === "kodansha" && catalog.complete,
    ),
  );
  assert.match(
    await page.locator("#seriesReleaseList").textContent(),
    /Volume 2/,
  );
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
    "PASS Kodansha JP releases, saved listings, Japanese discovery, explicit series links, missing volumes and offline reuse",
  );
} finally {
  await browser.close();
  library.close();
}
