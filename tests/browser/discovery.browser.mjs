import { testUrl } from "../helpers/browser.mjs";
// Runs against an isolated Next.js instance created by tests/browser/run.mjs.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { releaseItem } from "../../lib/domain.ts";
const url = process.env.BOOKS_TEST_URL;
const coverId = (source) => createHash("sha256").update(source).digest("hex");
const coverUrl = (source) => "/api/covers/" + coverId(source);
if (!url)
  throw new Error("Use npm run test:e2e to start the isolated test app.");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const make = (slug, title, type = "Manga (TH)") => ({
  ...releaseItem(
    "phoenix",
    title,
    `https://www.phoenixnext.com/${slug}.html`,
    175,
    "",
    type,
  ),
  coverUrl: `https://www.phoenixnext.com/media/catalog/product/${slug}.jpg`,
  coverId: coverId(
    `https://www.phoenixnext.com/media/catalog/product/${slug}.jpg`,
  ),
});
const items = [
  make("owned-1", "(มังงะ) Discovery owned เล่ม 1"),
  make("fresh-3", "(มังงะ) Discovery fresh เล่ม 3"),
  make("fresh-set-1", "(มังงะ) Special Set Discovery fresh เล่ม 1"),
  make("fresh-1", "(มังงะ) Discovery fresh เล่ม 1"),
  make("later-3", "(มังงะ) Discovery later เล่ม 3"),
  make("standalone", "(มังงะ) Discovery one-shot", "Manga (JP) (Color)"),
  make("novel-1", "(LN) Discovery novel เล่ม 1", "LN (TH)"),
];
const titles = [items[0], items[3], items[4], items[5], items[6]].map(
  (item) => ({
    ...item,
    id: item.id + ":title",
    title: item.series,
    type: item.type.startsWith("LN") ? "" : item.type,
    directory: true,
    coverUrl: "",
    coverId: "",
    volume: "",
    isbn: "",
    categories: [
      {
        url: "https://www.phoenixnext.com/gl/" + item.url.split("/").pop(),
        type: item.type.startsWith("LN") ? "" : item.type,
      },
    ],
  }),
);
const upcoming = {
  ...titles[1],
  id: "phoenix:title:upcoming",
  series: "Discovery upcoming",
  title: "Discovery upcoming",
  url: "https://www.phoenixnext.com/gl/the-story-of-unforgettable-witch.html",
  categories: [
    {
      url: "https://www.phoenixnext.com/gl/the-story-of-unforgettable-witch.html",
      type: "",
    },
  ],
};
titles.push(upcoming);
let upcomingResult = {
  item: null,
  complete: true,
  checkedAt: "2026-10-14T05:00:00Z",
  stale: true,
  error: "Could not refresh this publisher category.",
};
const firstpageUpcoming = {
  ...upcoming,
  id: "firstpage:title:upcoming",
  publisherId: "firstpage",
  publisher: "First Page Pro",
  series: "16 ปี แค่ได้คิดถึงเธอ มันก็ช่างใหญ่เกินใจ",
  title: "16 ปี แค่ได้คิดถึงเธอ มันก็ช่างใหญ่เกินใจ",
  type: "Manga (TH)",
  url: "https://www.firstpagepro.com/category/154",
  categories: [
    { url: "https://www.firstpagepro.com/category/154", type: "Manga (TH)" },
  ],
};
let firstpageResult = { ...upcomingResult };
let fail = false,
  calls = 0;
const titleCalls = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [],
    externalImages = [];
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
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/rpc", async (route) => {
    const request = route.request().postDataJSON();
    if (request.name === "getBookCover")
      return route.fulfill({
        json: { row: request.arg.row, coverId: items[0].coverId },
      });
    if (request.name === "getSeriesCatalog")
      return route.fulfill({
        json: { items: [], complete: true, checkedAt: "2026-10-14T05:00:00Z" },
      });
    if (request.name === "getPublisherReleases")
      return route.fulfill({
        json: {
          items: [items[3]],
          complete: true,
          checkedAt: "2026-10-14T05:00:00Z",
        },
      });
    if (request.name === "getPublisherTitle") {
      const category = request.arg.categories[0].url;
      titleCalls.push(category);
      if (category === upcoming.url)
        return route.fulfill({ json: upcomingResult });
      if (category === firstpageUpcoming.url)
        return route.fulfill({ json: firstpageResult });
      const title = titles.find((item) => item.categories[0].url === category);
      const item =
        items.find(
          (item) =>
            item.series === title.series && item.volume === 1 && !item.special,
        ) || items.find((item) => item.series === title.series);
      return route.fulfill({
        json: {
          item,
          complete: true,
          checkedAt: "2026-10-14T05:00:00Z",
          stale: false,
          error: "",
        },
      });
    }
    if (request.name !== "getPublisherDirectory") return route.continue();
    calls++;
    if (fail)
      return route.fulfill({
        status: 503,
        json: { message: "Test publisher outage" },
      });
    const firstpage = request.arg.url.startsWith(
      "https://www.firstpagepro.com/",
    );
    return route.fulfill({
      json: {
        titles: firstpage ? [firstpageUpcoming] : titles,
        items: [],
        url: request.arg.url,
        publisherId: firstpage ? "firstpage" : "phoenix",
        title: firstpage ? "First Page Pro titles" : "Girl’s Love",
        complete: true,
        checkedAt: "2026-10-14T05:00:00Z",
        stale: false,
        error: "",
      },
    });
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.evaluate(async () => {
    await window.bookCollection?.rpc("saveBook", {
      requestId: crypto.randomUUID(),
      book: {
        series: "Discovery owned",
        type: "Manga (TH)",
        publisher: "PHOENIX Next",
        status: "Read",
        volume: 5,
      },
    });
    document.getElementById("refreshButton").click();
  });
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  await page
    .getByRole("link", {
      name: "Open Discovery owned, 1 owned volume",
      exact: true,
    })
    .locator("img")
    .waitFor();
  await page
    .getByRole("link", {
      name: "Open Discovery owned, 1 owned volume",
      exact: true,
    })
    .click();
  await page.locator(".book-row .shelf-cover img").waitFor();
  assert.equal(
    await page.locator(".book-row .shelf-cover img").getAttribute("alt"),
    "Discovery owned, volume 5 cover",
  );
  await page.locator("#discoverTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.waitForFunction(
    () =>
      !window.bookCollection?.state.discoveryLoading &&
      window.bookCollection?.state.discoveryFeeds.size > 0,
  );
  assert.equal(await page.locator("#collectionBrowser").isVisible(), false);
  assert.equal(await page.locator(".discovery-card").count(), 5);
  assert.equal(
    await page
      .locator(".discovery-card")
      .filter({ hasText: "Discovery owned" })
      .count(),
    0,
  );
  const upcomingCard = page
    .locator(".discovery-card")
    .filter({ hasText: upcoming.series });
  await upcomingCard.evaluateAll((cards) => cards[0]?.scrollIntoView());
  await upcomingCard
    .getByText("No current book listing", { exact: true })
    .waitFor();
  assert.equal(await upcomingCard.count(), 1);
  upcomingResult = { ...upcomingResult, stale: false, error: "" };
  await page.locator("#refreshDiscovery").click();
  await page.waitForFunction(
    () => !window.bookCollection?.state.discoveryLoading,
  );
  await upcomingCard.evaluateAll((cards) => cards[0]?.scrollIntoView());
  await page.waitForFunction(
    () =>
      !window.bookCollection?.state.discoveryLoading &&
      [...window.bookCollection.state.discoveryTitleResults.values()].some(
        (result) => result.item === null && result.complete && !result.stale,
      ),
  );
  assert.equal(await upcomingCard.count(), 0);
  assert.equal(await page.locator(".discovery-card").count(), 4);
  assert.match(await page.locator("#discoveryCount").textContent(), /4 titles/);
  await page.locator("#discoverySearch").fill(upcoming.series);
  assert.equal(await page.locator(".discovery-card").count(), 0);
  assert.match(await page.locator("#discoveryCount").textContent(), /0 titles/);
  await page.locator("#discoverySearch").fill("");
  const fresh = () =>
    page.locator(".discovery-card").filter({
      has: page.getByRole("heading", {
        name: "Discovery fresh",
        exact: true,
      }),
    });
  await fresh().locator("img").waitFor();
  assert.equal(
    await fresh().locator("img").getAttribute("src"),
    coverUrl(items[3].coverUrl),
  );
  assert.match(
    await fresh().locator(".release-meta").textContent(),
    /Volume 1/,
  );
  assert.doesNotMatch(
    await fresh().locator(".release-meta").textContent(),
    /Special/,
  );
  // First-volume metadata loads when each compact row approaches the viewport.
  const later = page
    .locator(".discovery-card")
    .filter({ hasText: "Discovery later" });
  await later.scrollIntoViewIfNeeded();
  await later.getByText(/Volume 1 not listed/).waitFor();
  assert.match(await later.textContent(), /Volume 1 not listed/);
  assert.match(
    await page.locator("#discoverySource").textContent(),
    /titles from publisher navigation/,
  );
  await page.locator("#discoverySearch").fill("fresh");
  assert.equal(await page.locator(".discovery-card").count(), 1);
  await page.locator("#discoverySearch").fill("");
  const directoryCalls = calls;
  await page.getByLabel("Title type", { exact: true }).selectOption("Manga");
  // Phoenix directory entries can omit types until the first volume loads.
  const novel = page
    .locator(".discovery-card")
    .filter({ hasText: "Discovery novel" });
  if (await novel.count()) await novel.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelectorAll(".discovery-card").length === 3,
  );
  assert.deepEqual(
    await page.locator(".discovery-card .book-title").allTextContents(),
    ["Discovery fresh", "Discovery later", "Discovery one-shot"],
  );
  assert.match(await page.locator("#discoveryCount").textContent(), /3 titles/);
  await page.locator("#discoverySearch").fill("novel");
  assert.equal(await page.locator(".discovery-card").count(), 0);
  await page
    .getByRole("heading", { name: "No titles match these filters" })
    .waitFor();
  assert.match(await page.locator("#discoveryCount").textContent(), /0 titles/);
  await page.locator("#discoveryType").selectOption("LN");
  assert.deepEqual(
    await page.locator(".discovery-card .book-title").allTextContents(),
    ["Discovery novel"],
  );
  assert.match(await page.locator("#discoveryCount").textContent(), /1 title /);
  assert.equal(calls, directoryCalls);
  await page.locator("#discoverySearch").fill("");
  await page.locator("#discoveryType").selectOption("");
  assert.equal(await page.locator(".discovery-card").count(), 4);
  await fresh().getByRole("button", { name: "Save for later" }).click();
  await fresh().getByRole("button", { name: "Saved · Unsave" }).waitFor();
  const backup = await (await page.request.get(url + "/api/backup")).json();
  assert.equal(
    backup.savedReleases.find((item) => item.id === items[3].id).coverUrl,
    items[3].coverUrl,
  );
  fail = true;
  await page.locator("#refreshDiscovery").click();
  await page.waitForFunction(
    () => !window.bookCollection?.state.discoveryLoading,
  );
  assert.equal(await page.locator(".discovery-card").count(), 4);
  assert.match(await page.locator("#discoveryError").textContent(), /outage/);
  fail = false;
  await page
    .locator("#discoveryPreset")
    .selectOption("https://www.phoenixnext.com/bl.html");
  await page.waitForFunction(
    () => !window.bookCollection?.state.discoveryLoading,
  );
  assert.equal(
    await page.locator("#discoveryUrl").inputValue(),
    "https://www.phoenixnext.com/bl.html",
  );
  assert.ok(calls >= 3);
  assert.ok(titleCalls.every((category) => !category.includes("owned")));
  assert.equal(await upcomingCard.count(), 0);
  await page.locator("#discoveryType").selectOption("LN");
  await page.locator("#collectionTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#discoverTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.waitForFunction(
    () => !window.bookCollection?.state.discoveryLoading,
  );
  assert.equal(await page.locator("#discoveryType").inputValue(), "LN");
  assert.deepEqual(
    await page.locator(".discovery-card .book-title").allTextContents(),
    ["Discovery novel"],
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      !window.bookCollection?.state.discoveryLoading &&
      window.bookCollection?.state.discoveryFeeds.size > 0,
  );
  assert.equal(await page.locator("#discoveryType").inputValue(), "LN");
  assert.deepEqual(
    await page.locator(".discovery-card .book-title").allTextContents(),
    ["Discovery novel"],
  );
  await page.locator("#discoveryType").selectOption("");
  await upcomingCard.evaluateAll((cards) => cards[0]?.scrollIntoView());
  await page.waitForFunction(
    () => document.querySelectorAll(".discovery-card").length === 4,
  );
  assert.equal(await page.locator(".discovery-card").count(), 4);
  await page.locator(".discovery-cover img").first().waitFor();
  await page
    .locator(".discovery-cover img")
    .first()
    .evaluate((img) => img.dispatchEvent(new Event("error")));
  assert.equal(
    await page
      .locator(".discovery-cover .cover-placeholder")
      .first()
      .isVisible(),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-discovery-phone.png", import.meta.url),
    ),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-discovery-desktop.png", import.meta.url),
    ),
    fullPage: true,
  });
  await fresh().getByRole("button", { name: "Add to shelf" }).click();
  assert.equal(await page.locator("#series").inputValue(), "Discovery fresh");
  assert.equal(await page.locator("#volume").inputValue(), "1");
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => !document.getElementById("bookDialog").open);
  await fresh().waitFor({ state: "detached" });
  assert.equal(await fresh().count(), 0);
  await page.locator("#releasesTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.waitForFunction(
    () =>
      window.bookCollection?.state.releasesLoaded &&
      !window.bookCollection?.state.releasesLoading,
  );
  await page.locator("#releaseScope").selectOption("all");
  assert.equal(
    await page.locator(".release-cover img").first().getAttribute("src"),
    coverUrl(items[3].coverUrl),
  );
  await page.locator("#discoverTab").click();
  await page.waitForFunction(
    () =>
      !window.bookCollection?.state.discoveryLoading &&
      window.bookCollection?.state.discoveryFeeds.size > 0,
  );
  for (const [id, label] of [
    [22, "General"],
    [7, "18+"],
    [63, "20+"],
  ]) {
    const categoryUrl = "https://www.firstpagepro.com/category/" + id;
    const loaded = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/rpc")) return false;
      const request = response.request().postDataJSON();
      return (
        request.name === "getPublisherDirectory" &&
        request.arg.url === categoryUrl
      );
    });
    await page.locator("#discoveryPreset").selectOption({
      label: "First Page Pro · Manga (" + label + ")",
    });
    assert.equal((await loaded).status(), 200);
    await page.waitForFunction(
      (selected) =>
        !window.bookCollection?.state.discoveryLoading &&
        window.bookCollection?.state.discoveryFeeds.has(selected),
      categoryUrl,
    );
    assert.equal(await page.locator("#discoveryUrl").inputValue(), categoryUrl);
  }
  await page.reload();
  await page.waitForFunction(
    () =>
      !window.bookCollection?.state.discoveryLoading &&
      window.bookCollection?.state.discoveryFeeds.has(
        "https://www.firstpagepro.com/category/63",
      ),
  );
  assert.equal(
    await page.locator("#discoveryPreset").inputValue(),
    "https://www.firstpagepro.com/category/63",
  );
  assert.equal(
    await page.locator("#discoveryUrl").inputValue(),
    "https://www.firstpagepro.com/category/63",
  );
  const firstpageCard = page.locator(".discovery-card").filter({
    has: page.getByRole("heading", {
      name: firstpageUpcoming.series,
      exact: true,
    }),
  });
  await firstpageCard
    .getByText("No current book listing", { exact: true })
    .waitFor();
  assert.equal(
    await firstpageCard
      .getByRole("button", { name: "Add to shelf" })
      .isDisabled(),
    true,
  );
  // An incomplete check must keep the category visible even without a listing.
  firstpageResult = { ...firstpageResult, complete: false, stale: false };
  await page.locator("#refreshDiscovery").click();
  await firstpageCard.getByText("Cover unavailable", { exact: true }).waitFor();
  firstpageResult = { ...firstpageResult, complete: true, error: "" };
  await page.locator("#refreshDiscovery").click();
  await firstpageCard.waitFor({ state: "detached" });
  assert.match(await page.locator("#discoveryCount").textContent(), /0 titles/);
  await page
    .getByRole("heading", { name: "No new titles in this category" })
    .waitFor();
  // A newly listed unnumbered book should return on the next successful refresh.
  firstpageResult = {
    ...firstpageResult,
    item: {
      ...releaseItem(
        "firstpage",
        "การ์ตูน " + firstpageUpcoming.series,
        "https://www.firstpagepro.com/product/1",
      ),
      coverId: items[3].coverId,
    },
  };
  await page.locator("#refreshDiscovery").click();
  await firstpageCard.getByText(/Single book \/ unnumbered/).waitFor();
  assert.equal(await firstpageCard.count(), 1);
  assert.equal(
    await firstpageCard
      .getByRole("button", { name: "Add to shelf" })
      .isEnabled(),
    true,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(externalImages, []);
  console.log(
    "PASS discovery deduplication, ownership, first-volume covers, filters, First Page rating presets and persistence, cached outage, save/add, image fallback and phone/desktop layout",
  );
} finally {
  await browser.close();
}
