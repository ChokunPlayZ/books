import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { releaseItem } from "../../lib/domain/releases.ts";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
    calls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const isbn = "9786166247404";
  const make = (publisherId, title) =>
    releaseItem(
      publisherId,
      title,
      publisherId === "phoenix"
        ? "https://www.phoenixnext.com/ln0838-01.html"
        : "https://www.firstpagepro.com/product/1152",
      175,
      publisherId === "phoenix" ? isbn : "",
    );
  const phoenix = make("phoenix", "(LN) ISBN outside loaded category เล่ม 7");
  const firstpage = make("firstpage", "การ์ตูน First Page ISBN search เล่ม 2");
  let fail = false;
  await page.route("**/api/rpc", async (route) => {
    const request = route.request().postDataJSON();
    if (request.name === "getPublisherDirectory")
      return route.fulfill({
        json: { titles: [], items: [], url: request.arg.url, complete: true },
      });
    if (request.name === "getPublisherReleases")
      return route.fulfill({ json: { items: [], complete: true } });
    if (request.name === "searchPublisherIsbn") {
      calls.push(request.arg);
      if (request.arg.isbn === "9780140328721") {
        await new Promise((resolve) => setTimeout(resolve, 700));
        return route.fulfill({
          json: {
            ...request.arg,
            items: [make("phoenix", "Old search result")],
            warnings: [],
          },
        });
      }
      if (fail)
        return route.fulfill({
          status: 503,
          json: { message: "Publisher unavailable for ISBN search" },
        });
      return route.fulfill({
        json: {
          ...request.arg,
          url:
            request.arg.publisherId === "phoenix"
              ? "https://www.phoenixnext.com/catalogsearch/result/?q=" + isbn
              : "https://www.firstpagepro.com/search?q=" + isbn,
          items: [request.arg.publisherId === "phoenix" ? phoenix : firstpage],
          warnings:
            request.arg.publisherId === "firstpage"
              ? [
                  "First Page Pro returned this book for the ISBN. Its product pages do not publish an ISBN; check the book’s barcode before adding it.",
                ]
              : [],
        },
      });
    }
    if (request.name === "getBookCover")
      return route.fulfill({ json: { coverUrl: "" } });
    return route.continue();
  });
  await page.goto(testUrl + "/discover");
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#discoverySearch").fill("ISBN: 978-616-624-740-4");
  await page.locator("#discoveryList .release-card").waitFor();
  assert.equal(calls[0].isbn, isbn);
  assert.equal(calls[0].publisherId, "phoenix");
  assert.match(
    await page.locator("#discoveryList").textContent(),
    /outside loaded category/,
  );
  await page
    .locator("#discoveryList .release-card")
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#isbn").inputValue(), isbn);
  assert.equal(await page.locator("#volume").inputValue(), "7");
  await page.locator("#cancelBook").click();
  await page.locator("#discoverySearch").fill("0140328726");
  await page.waitForFunction(() =>
    document.getElementById("discoveryCount").textContent.includes("Searching"),
  );
  await page.waitForTimeout(400);
  await page.locator("#discoverySearch").fill("ordinary title query");
  await page.waitForTimeout(800);
  assert.equal(await page.locator("#discoveryList .release-card").count(), 0);
  await page
    .locator("#discoveryPreset")
    .selectOption("https://www.firstpagepro.com/");
  await page.locator("#discoverySearch").fill(isbn);
  await page.locator("#discoveryList .release-card").waitFor();
  assert.equal(calls.at(-1).publisherId, "firstpage");
  assert.match(
    await page.locator("#discoveryList .publisher-isbn-status").textContent(),
    /do not publish an ISBN/,
  );
  assert.doesNotMatch(
    await page.locator("#discoveryList .release-match").textContent(),
    /ISBN match/,
  );
  await page
    .locator("#discoveryList .release-card")
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#isbn").inputValue(), isbn);
  assert.match(
    await page.locator("#lookupResult").textContent(),
    /comes from your search/,
  );
  await page.locator("#cancelBook").click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  fail = true;
  await page.locator("#refreshDiscovery").click();
  await page.locator("#discoveryList .source-error").waitFor();
  assert.equal(calls.at(-1).refresh, true);
  assert.match(
    await page.locator("#discoveryList .source-error").textContent(),
    /Publisher unavailable/,
  );
  fail = false;
  await page.goto(testUrl + "/releases");
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#releasePublisher").selectOption("phoenix");
  await page.locator("#releaseSearch").fill(isbn);
  await page.locator("#releaseList .release-card").waitFor();
  assert.match(
    await page.locator("#releaseList").textContent(),
    /outside loaded category/,
  );
  await page.locator("#releaseScope").selectOption("owned");
  assert.equal(await page.locator("#releaseList .release-card").count(), 0);
  await page.locator("#releaseScope").selectOption("all");
  assert.equal(await page.locator("#releaseList .release-card").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Phoenix/First Page Pro full-catalog ISBN search, canonical input, review form, stale results, source errors and release search",
  );
} finally {
  await browser.close();
}
