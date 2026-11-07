import { testUrl } from "../helpers/browser.mjs";
// Browser scenario against an isolated Next.js test library.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { releaseItem } from "../../lib/domain.ts";
import { normalizeRecordTypes } from "../../lib/domain/book-type.ts";
const { chromium } = await import(
  process.env.BOOKS_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const url = testUrl,
  marker = "Release check " + Date.now();
const item = (id, title, slug, isbn = "", type = "Manga (TH)") =>
  normalizeRecordTypes(
    releaseItem(
      id,
      title,
      id === "phoenix"
        ? "https://www.phoenixnext.com/" + slug + ".html"
        : id === "firstpage"
          ? "https://www.firstpagepro.com/product/" + slug
          : "https://www.luckpim.com/product/detail/" + slug,
      175,
      isbn,
      type,
    ),
  );
const exact = item(
    "phoenix",
    marker + " known เล่ม 2",
    "release-check-2",
    "9748585476",
    "LN (TH)",
  ),
  possible = item(
    "phoenix",
    marker + " known เล่ม 3",
    "release-check-3",
    "",
    "LN (TH)",
  ),
  different = item("phoenix", marker + " other เล่ม 4", "release-check-4"),
  special = item(
    "phoenix",
    "Special Set " + marker + " known เล่ม 2",
    "release-check-set",
    "9748585476",
    "LN (TH)",
  ),
  first = item(
    "firstpage",
    marker + " <img src=x onerror=alert(1)> เล่ม 1",
    "999991",
  ),
  luck = item("luckpim", "[PRE-ORDER] " + marker + " next 05", "999992");
luck.availability = "Pre-order";
const feeds = {
  phoenix: [exact, possible, different, special],
  firstpage: [first],
  luckpim: [luck],
};
let failLuck = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.abort());
  await page.route("**/rpc", async (route) => {
    const request = route.request().postDataJSON();
    if (request?.name === "lookupIsbn")
      return route.fulfill({
        json: {
          isbn: "9786166247275",
          found: true,
          details: {
            title: "ดอกรักผลิบานที่กลางใจ เล่ม 22",
            series: "ดอกรักผลิบานที่กลางใจ",
            volume: 22,
            type: "Manga",
            edition: "Manga (TH)",
            publisher: "PHOENIX Next",
            source: "Naiin",
          },
          warnings: [],
          searchUrl: "https://www.naiin.com/search-result?title=9786166247275",
        },
      });
    if (request?.name !== "getPublisherReleases") return route.continue();
    if (failLuck && request.arg.publisherId === "luckpim")
      return route.fulfill({ status: 503, json: { message: "Test outage" } });
    return route.fulfill({
      json: {
        publisherId: request.arg.publisherId,
        items: feeds[request.arg.publisherId] || [],
        checkedAt: "2026-10-09T07:00:00Z",
        stale: false,
        error: "",
      },
    });
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  for (const book of [
    {
      series: marker + " known",
      type: "LN (TH)",
      publisher: "PHOENIX Next",
      volume: 2,
      isbn: "9789748585475",
    },
    {
      series: marker + " known",
      type: "LN (TH)",
      publisher: "PHOENIX Next",
      volume: 3,
      isbn: "",
    },
    {
      series: marker + " other",
      type: "Manga (JP)",
      publisher: "Phoenix Next",
      volume: 4,
      isbn: "",
    },
  ])
    await page.evaluate(
      (book) =>
        window.bookCollection?.rpc("saveBook", {
          book: { ...book, status: "Read" },
          allowDuplicate: true,
          requestId: crypto.randomUUID(),
        }),
      book,
    );
  await page.locator("#refreshButton").click();
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  await page.locator("#releasesTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.waitForFunction(
    () =>
      window.bookCollection?.state.releasesLoaded &&
      !window.bookCollection?.state.releasesLoading,
  );
  assert.equal(await page.locator(".release-card").count(), 3);
  assert.match(
    await page.locator("#releaseResultCount").textContent(),
    /not bought yet/,
  );
  assert.match(
    await page.locator("#releaseOwnershipSummary").textContent(),
    /3 not bought yet.*1 on your shelf.*2 to check/,
  );
  await page.locator("#releaseScope").selectOption("all");
  assert.equal(await page.locator(".release-card").count(), 6);
  assert.equal(await page.locator("#collectionBrowser").isVisible(), false);
  const card = (title) =>
    page
      .locator(".release-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  assert.match(
    await card(exact.title).textContent(),
    /On your shelf · ISBN match/,
  );
  assert.match(await card(possible.title).textContent(), /Check the edition/);
  assert.match(await card(different.title).textContent(), /Not bought yet/);
  assert.match(await card(special.title).textContent(), /Volume on your shelf/);
  assert.equal(await card(first.title).locator("img").count(), 0);
  await page.locator("#releaseScope").selectOption("review");
  assert.equal(await page.locator(".release-card").count(), 2);
  assert.ok(
    (await page.locator(".release-card").allTextContents()).every((text) =>
      /Check the edition/.test(text),
    ),
  );
  await page.locator("#releaseScope").selectOption("owned");
  assert.equal(await page.locator(".release-card").count(), 1);
  await page.locator("#releaseScope").selectOption("series");
  assert.equal(await page.locator(".release-card").count(), 3);
  await page.locator("#releaseScope").selectOption("all");
  await page.locator("#releasePublisher").selectOption("luckpim");
  assert.equal(await page.locator(".release-card").count(), 1);
  assert.match(await page.locator(".release-card").textContent(), /Pre-order/);
  await page.locator("#releasePublisher").selectOption("");
  await page.locator("#releaseSearch").fill("9789748585475");
  assert.equal(await page.locator(".release-card").count(), 1);
  await page.locator("#releaseSearch").fill("");
  console.log(
    "PASS publisher/series/search filters, exact ISBN, edition hints, language matching, special sets and HTML safety",
  );
  await page.locator("#releaseScope").selectOption("all");
  failLuck = true;
  await page.locator("#refreshReleases").click();
  await page.waitForFunction(
    () => !window.bookCollection?.state.releasesLoading,
  );
  assert.match(
    await page.locator("#publisherSources").textContent(),
    /Unable to check Luckpim/,
  );
  assert.ok(await page.locator(".release-card").count());
  assert.equal(
    await card(exact.title)
      .getByRole("link", { name: "Find at Kinokuniya ↗" })
      .getAttribute("href"),
    "https://kinokuniya.co.th/search?type=product&q=" +
      exact.isbn +
      "&ref=meemai.ckl.moe",
  );
  await card(exact.title)
    .getByRole("button", { name: "View owned series" })
    .click();
  assert.equal(
    await page.locator("#seriesTitle").textContent(),
    marker + " known",
  );
  assert.equal(await page.locator("#releasesPanel").isVisible(), false);
  await page.locator("#backSeries").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  await page.locator("#isbn").fill("9786166247275");
  await page.locator("#lookupButton").click();
  await page.waitForFunction(() =>
    document
      .getElementById("lookupResult")
      .textContent.includes("Suggested by Naiin"),
  );
  assert.equal(
    await page.locator("#series").inputValue(),
    "ดอกรักผลิบานที่กลางใจ",
  );
  assert.equal(await page.locator("#volume").inputValue(), "22");
  assert.equal(await page.locator("#publisher").inputValue(), "PHOENIX Next");
  await page.locator("#toggleLookupDetails").click();
  assert.equal(
    await page
      .getByRole("link", { name: "Search this ISBN at Naiin ↗" })
      .getAttribute("href"),
    "https://www.naiin.com/search-result?title=9786166247275&ref=meemai.ckl.moe",
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Search this ISBN at Kinokuniya ↗" })
      .getAttribute("href"),
    "https://kinokuniya.co.th/search?type=product&q=9786166247275&ref=meemai.ckl.moe",
  );
  await page.locator("#cancelBook").click();
  await page.locator("#addButton").click();
  await page.locator("#series").fill("My manual title");
  await page.locator("#publisher").fill("My manual publisher");
  await page.locator("#volume").fill("14.5");
  await page.locator("#type").selectOption("Light novel");
  await page.locator("#isbn").fill("9786166247275");
  await page.locator("#lookupButton").click();
  await page.waitForFunction(() =>
    document
      .getElementById("lookupResult")
      .textContent.includes("Suggested by Naiin"),
  );
  assert.equal(await page.locator("#series").inputValue(), "My manual title");
  assert.equal(
    await page.locator("#publisher").inputValue(),
    "My manual publisher",
  );
  assert.equal(await page.locator("#volume").inputValue(), "14.5");
  assert.equal(await page.locator("#type").inputValue(), "Light novel");
  await page.locator("#cancelBook").click();
  await page.locator("#releasesTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-publishers-phone.png", import.meta.url),
    ),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-publishers-desktop.png", import.meta.url),
    ),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS partial feed outages, owned-series navigation, verified Naiin fill, manual details retained and phone/desktop layout",
  );
} finally {
  const cleanup = await browser.newPage();
  await cleanup.goto(url);
  await cleanup.waitForFunction(
    () => typeof window.bookCollection?.rpc === "function",
  );
  await cleanup.evaluate(async (marker) => {
    const data = await window.bookCollection?.rpc("getCollection");
    for (const b of data.books.filter((b) => b.series.startsWith(marker)))
      await window.bookCollection?.rpc("removeBook", {
        requestId: crypto.randomUUID(),
        row: b.row,
        token: b.token,
      });
  }, marker);
  await browser.close();
}
