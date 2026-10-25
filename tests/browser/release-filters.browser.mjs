import { testUrl } from "../helpers/browser.mjs";
// Browser scenario against an isolated Next.js test library.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createTestLibrary } from "../helpers/library.mjs";
const { chromium } = await import(
  process.env.BOOKS_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const h = createTestLibrary([
  {
    series: "A novel on the shelf",
    volume: 1,
    type: "LN (TH)",
    publisher: "PHOENIX Next",
    isbn: "9780140328721",
    status: "Read",
  },
]);

let productId = 99000;
const item = (publisher, title, type, isbn = "") => {
  const slug = String(++productId);
  return h.api.releaseItem(
    publisher,
    title,
    publisher === "phoenix"
      ? "https://www.phoenixnext.com/filter-" + slug + ".html"
      : publisher === "firstpage"
        ? "https://www.firstpagepro.com/product/" + slug
        : "https://www.luckpim.com/product/detail/" + slug,
    175,
    isbn,
    type,
  );
};
const novel = item(
  "phoenix",
  "A novel on the shelf เล่ม 1",
  "LN (TH)",
  "0140328726",
);
const englishNovel = item("firstpage", "An English novel เล่ม 2", "LN (EN)");
const manga = item("luckpim", "A manga to read เล่ม 3", "Manga (TH)");
const colorManga = item(
  "phoenix",
  "A color manga เล่ม 4",
  "Manga (JP) (Color)",
);
const specialNovel = item("phoenix", "Special Set A novel เล่ม 1", "LN (TH)");
const specialManga = item(
  "luckpim",
  "Limited Edition Box Set A manga เล่ม 5",
  "Manga (TH)",
);
const unknown = item("firstpage", "A catalog title เล่ม 6", "");
let feeds = {
  phoenix: [novel, colorManga, specialNovel],
  firstpage: [englishNovel, unknown],
  luckpim: [manga, specialManga],
};
const nextNovel = item("phoenix", "A novel on the shelf เล่ม 2", "LN (TH)");
const volumeCalls = [];
let failVolumes = false,
  emptyVolumes = false,
  releaseVolumes;
const delayedVolumes = new Promise((resolve) => (releaseVolumes = resolve));
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getSeriesCatalog") {
      volumeCalls.push(arg);
      await delayedVolumes;
      if (failVolumes)
        return route.fulfill({
          status: 503,
          json: { message: "Test volume outage" },
        });
      return route.fulfill({
        json: {
          items: emptyVolumes ? [] : [nextNovel, novel, specialNovel, novel],
          complete: true,
          error: "",
        },
      });
    }
    if (name === "getPublisherReleases")
      return route.fulfill({
        json: {
          publisherId: arg.publisherId,
          items: feeds[arg.publisherId] || [],
          checkedAt: "2026-10-09T07:00:00Z",
          stale: false,
          error: "",
        },
      });
    try {
      return await route.fulfill({ json: await h.api[name](arg) });
    } catch (error) {
      return route.fulfill({ status: 400, json: { message: error.message } });
    }
  });
  await page.goto(testUrl);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#releasesTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.waitForFunction(
    () =>
      window.bookCollection?.state.releasesLoaded &&
      !window.bookCollection?.state.releasesLoading,
  );
  const cards = page.locator("#releaseList .release-card");
  const card = (title) =>
    cards.filter({
      has: page.getByRole("heading", { name: title, exact: true }),
    });
  const hide = page.getByRole("button", {
    name: "Hide special editions",
    exact: true,
  });
  const hideSaved = page.getByRole("button", {
    name: "Hide saved for later",
    exact: true,
  });
  const hideOwned = page.getByRole("button", {
    name: "Hide owned",
    exact: true,
  });
  assert.equal(
    await page.getByLabel("Release type", { exact: true }).inputValue(),
    "",
  );
  assert.equal(await hide.getAttribute("aria-pressed"), "false");
  assert.equal(await hideSaved.getAttribute("aria-pressed"), "false");
  assert.equal(await hideOwned.getAttribute("aria-pressed"), "false");
  assert.equal(await cards.count(), 6);
  await page.locator("#releaseScope").selectOption("all");
  assert.equal(await cards.count(), 7);
  assert.equal(await card(unknown.title).count(), 1);
  await hideOwned.click();
  assert.equal(await hideOwned.getAttribute("aria-pressed"), "true");
  assert.equal(await cards.count(), 6);
  assert.equal(await card(novel.title).count(), 0);
  assert.equal(
    await card(specialNovel.title).count(),
    1,
    "Possible editions stay available for review",
  );
  await page.locator("#releaseScope").selectOption("owned");
  assert.equal(await cards.count(), 0);
  await hideOwned.click();
  assert.equal(await card(novel.title).count(), 1);
  await page.locator("#releaseScope").selectOption("all");
  await page.locator("#releaseType").selectOption("LN");
  assert.deepEqual(await cards.locator("h2").allTextContents(), [
    novel.title,
    specialNovel.title,
    englishNovel.title,
  ]);
  await hide.click();
  assert.equal(await hide.getAttribute("aria-pressed"), "true");
  assert.equal(await cards.count(), 2);
  assert.equal(await card(specialNovel.title).count(), 0);
  await page.locator("#releaseScope").selectOption("unbought");
  assert.deepEqual(await cards.locator("h2").allTextContents(), [
    englishNovel.title,
  ]);
  await page.locator("#releaseScope").selectOption("owned");
  assert.deepEqual(await cards.locator("h2").allTextContents(), [novel.title]);
  await page.locator("#releaseScope").selectOption("all");
  await page.locator("#releaseType").selectOption("Manga");
  assert.deepEqual(await cards.locator("h2").allTextContents(), [
    colorManga.title,
    manga.title,
  ]);
  await page.locator("#releasePublisher").selectOption("luckpim");
  assert.deepEqual(await cards.locator("h2").allTextContents(), [manga.title]);
  await page.locator("#releaseSearch").fill("color");
  assert.equal(await cards.count(), 0);
  assert.match(
    await page.locator("#releaseResultCount").textContent(),
    /^0 releases/,
  );
  assert.match(
    await page.locator("#releaseList").textContent(),
    /No releases match these filters/,
  );
  await page.locator("#releasePublisher").selectOption("");
  assert.deepEqual(await cards.locator("h2").allTextContents(), [
    colorManga.title,
  ]);
  await page.locator("#releaseSearch").fill("");
  await page.locator("#releaseType").selectOption("");
  assert.equal(await cards.count(), 5);
  assert.equal(await card(unknown.title).count(), 1);
  console.log(
    "PASS LN/manga across languages and color editions, unknown types, combined publisher/search/ownership filters, special sets and empty results",
  );

  await hide.click();
  await card(specialNovel.title)
    .getByRole("button", { name: "Save for later", exact: true })
    .click();
  await page.waitForFunction(
    () => !window.bookCollection?.state.savingReleases.size,
  );
  await hideSaved.click();
  assert.equal(await hideSaved.getAttribute("aria-pressed"), "true");
  assert.equal(await card(specialNovel.title).count(), 0);
  assert.equal(await cards.count(), 6);
  assert.equal(h.api.getCollection().savedReleases.length, 1);
  await hideOwned.click();
  assert.equal(await cards.count(), 5);
  await page.locator("#releaseType").selectOption("LN");
  assert.deepEqual(await cards.locator("h2").allTextContents(), [
    englishNovel.title,
  ]);
  await page.locator("#releaseScope").selectOption("saved");
  assert.equal(await cards.count(), 0);
  assert.match(
    await page.locator("#releaseList").textContent(),
    /turn off a hide option/,
  );
  await page.locator("#releaseType").selectOption("");
  await page.locator("#releaseScope").selectOption("all");
  await page.locator("#refreshReleases").click();
  await page.waitForFunction(
    () => !window.bookCollection?.state.releasesLoading,
  );
  assert.equal(await hideSaved.getAttribute("aria-pressed"), "true");
  assert.equal(await hideOwned.getAttribute("aria-pressed"), "true");
  assert.equal(await cards.count(), 5);
  await page.locator("#collectionTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#releasesTab").click();
  await page.waitForFunction(
    () =>
      window.bookCollection?.state.releasesLoaded &&
      !window.bookCollection?.state.releasesLoading,
  );
  assert.equal(await hideSaved.getAttribute("aria-pressed"), "true");
  assert.equal(await hideOwned.getAttribute("aria-pressed"), "true");
  assert.equal(await cards.count(), 5);
  await hideSaved.click();
  await hideOwned.click();
  assert.equal(await cards.count(), 7);
  console.log(
    "PASS saved/owned hide options combine with filters, preserve saved records and survive refresh and navigation",
  );
  await page.locator("#releaseScope").selectOption("saved");
  assert.equal(await cards.count(), 1);
  await page.locator("#releaseType").selectOption("Manga");
  assert.equal(await cards.count(), 0);
  await page.locator("#releaseType").selectOption("LN");
  assert.equal(await cards.count(), 1);
  await hide.click();
  assert.equal(await cards.count(), 0);
  assert.equal(h.api.getCollection().savedReleases.length, 1);
  feeds.phoenix = [novel, colorManga];
  await page.locator("#refreshReleases").click();
  await page.waitForFunction(
    () => !window.bookCollection?.state.releasesLoading,
  );
  assert.equal(await page.locator("#releaseType").inputValue(), "LN");
  assert.equal(await hide.getAttribute("aria-pressed"), "true");
  assert.equal(await cards.count(), 0);
  await hide.click();
  assert.equal(await cards.count(), 1);
  assert.match(
    await card(specialNovel.title).textContent(),
    /Saved listing · Not in the latest check/,
  );
  await hide.click();
  await page.locator("#collectionTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#releasesTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(await page.locator("#releaseType").inputValue(), "LN");
  assert.equal(await hide.getAttribute("aria-pressed"), "true");
  assert.equal(await cards.count(), 0);
  console.log(
    "PASS saved releases keep their records while hidden, saved listings outside the feed, refresh and tab navigation retain filters",
  );

  await page.locator("#releaseScope").selectOption("all");
  await page.locator("#releaseType").selectOption("");
  assert.equal(volumeCalls.length, 0, "Volumes load only when opened");
  const novelCard = card(novel.title);
  const novelCardElement = await novelCard.elementHandle();
  const toggle = novelCard.getByRole("button", {
    name: /^(View|Hide) volumes$/,
  });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const volumes = novelCard.getByRole("region", {
    name: "Volumes in " + novel.series,
  });
  await volumes.getByText("Loading volumes…", { exact: true }).waitFor();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.equal(
    await toggle.getAttribute("aria-controls"),
    await volumes.getAttribute("id"),
  );
  assert.equal(await volumes.getAttribute("aria-busy"), "true");
  assert.equal(
    await toggle.evaluate((button) => button === document.activeElement),
    true,
    "Opening volumes preserves keyboard focus",
  );
  releaseVolumes();
  await volumes
    .getByText("3 listings from the publisher", { exact: true })
    .waitFor();
  assert.deepEqual(volumeCalls[0], {
    publisherId: novel.publisherId,
    series: novel.series,
    type: novel.type,
    refresh: false,
  });
  assert.deepEqual(
    await volumes
      .locator(".book-card")
      .evaluateAll((covers) => covers.map((cover) => cover.title)),
    [novel.title, specialNovel.title, nextNovel.title],
    "Publisher volumes are deduplicated and sorted by volume and edition",
  );
  assert.equal(
    await volumes
      .getByRole("button", {
        name: "View owned series for " + novel.title,
        exact: true,
      })
      .count(),
    1,
  );
  await volumes
    .getByRole("button", {
      name: "Add to shelf: " + nextNovel.title,
      exact: true,
    })
    .click();
  assert.equal(await page.locator("#series").inputValue(), novel.series);
  assert.equal(await page.locator("#volume").inputValue(), "2");
  assert.equal(await page.locator("#publisherUrl").inputValue(), nextNovel.url);
  await page.locator("#cancelBook").click();
  await novelCard
    .getByRole("button", { name: "Save for later", exact: true })
    .click();
  await novelCard
    .getByRole("button", { name: "Saved · Unsave", exact: true })
    .waitFor();
  assert.equal(
    await novelCardElement.evaluate((card) => card.isConnected),
    true,
  );
  assert.equal(
    await volumes.isVisible(),
    true,
    "Saving keeps the gallery expanded",
  );
  await novelCard
    .getByRole("button", { name: "Hide volumes", exact: true })
    .click();
  assert.equal(await volumes.isVisible(), false);
  await novelCard
    .getByRole("button", { name: "View volumes", exact: true })
    .click();
  await volumes
    .getByText("3 listings from the publisher", { exact: true })
    .waitFor();
  assert.equal(volumeCalls.length, 1, "Reopening uses cached volumes");
  failVolumes = true;
  await volumes
    .getByRole("button", { name: "Refresh volumes", exact: true })
    .click();
  await volumes.getByText(/Could not load volumes/).waitFor();
  assert.equal(await volumes.locator(".book-card").count(), 3);
  failVolumes = false;
  emptyVolumes = true;
  await volumes
    .getByRole("button", { name: "Retry volumes", exact: true })
    .click();
  await volumes
    .getByText("No volumes are currently listed by the publisher.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await volumes.locator(".book-card").count(), 0);
  emptyVolumes = false;
  await volumes
    .getByRole("button", { name: "Refresh volumes", exact: true })
    .click();
  await volumes
    .getByText("3 listings from the publisher", { exact: true })
    .waitFor();
  assert.equal(volumeCalls.at(-1).refresh, true);
  await page.locator("#refreshReleases").click();
  await page.waitForFunction(
    () => !window.bookCollection?.state.releasesLoading,
  );
  assert.equal(
    await volumes.isVisible(),
    true,
    "Refreshing releases keeps the gallery expanded",
  );
  console.log(
    "PASS release volume loading, keyboard focus, sorted covers, ownership, add-to-shelf, cached reopening, refresh, retry and empty state",
  );
  await page.locator("#toast").waitFor({ state: "hidden" });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    for (const selector of [
      "#releaseSearch",
      "#releasePublisher",
      "#releaseScope",
      "#releaseType",
      "#hideSpecialReleases",
      "#hideSavedReleases",
      "#hideOwnedReleases",
    ]) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= width,
        selector + " fits at " + width,
      );
      assert.ok(box.height >= 44, selector + " has a touch-sized target");
    }
    if (width === 390 || width === 1280)
      await page.screenshot({
        path: fileURLToPath(
          new URL(
            "../../outputs/browser-release-filters-" +
              (width === 390 ? "phone" : "desktop") +
              ".png",
            import.meta.url,
          ),
        ),
        fullPage: true,
      });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS accessible controls, 320px/phone/tablet/desktop layout and no browser errors",
  );
} finally {
  await browser.close();
  h.close();
}
