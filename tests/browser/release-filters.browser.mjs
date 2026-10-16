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
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
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
  assert.equal(
    await page.getByLabel("Release type", { exact: true }).inputValue(),
    "",
  );
  assert.equal(await hide.getAttribute("aria-pressed"), "false");
  assert.equal(await cards.count(), 6);
  await page.locator("#releaseScope").selectOption("all");
  assert.equal(await cards.count(), 7);
  assert.equal(await card(unknown.title).count(), 1);
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
    ]) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= width,
        selector + " fits at " + width,
      );
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
