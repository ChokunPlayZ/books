import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const isbn = "9780385496490";
const checkedAt = new Date().toISOString();
const offer = (id, shop, price, availability, currency = "THB") => ({
  shopId: id,
  shop,
  price,
  availability,
  currency,
  isbn,
  checkedAt,
  title: "Tuesdays with Morrie",
  url: "https://kinokuniya.co.th/products/" + isbn,
});
const comparison = {
  isbn,
  offers: [
    offer("naiin", "Naiin", 166.25, "in_stock"),
    offer("kinokuniya", "Kinokuniya", 355, "in_stock"),
    offer("firstpage", "First Page Pro", 99, "out_of_stock"),
    offer("animag", "Animag", 120, "unknown"),
    offer("dexpress", "DEXpress", null, "preorder"),
  ],
  sources: [
    "naiin",
    "kinokuniya",
    "firstpage",
    "animag",
    "dexpress",
    "phoenix",
  ].map((id) => ({
    id,
    name: id === "phoenix" ? "Phoenix Next" : comparisonName(id),
    searchUrl: "https://kinokuniya.co.th/search?q=" + isbn,
    status: id === "phoenix" ? "unavailable" : "found",
    checkedAt,
  })),
};
function comparisonName(id) {
  return {
    naiin: "Naiin",
    kinokuniya: "Kinokuniya",
    firstpage: "First Page Pro",
    animag: "Animag",
    dexpress: "DEXpress",
  }[id];
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
    requests = [];
  let response = comparison,
    status = 200,
    hold = null;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/rpc", async (route) => {
    const data = route.request().postDataJSON();
    if (data.name !== "findLowestPrices") return route.continue();
    requests.push(data.arg);
    if (hold) await hold;
    await route.fulfill({ status, json: response }).catch(() => {});
  });
  await page.goto(testUrl + "/prices");
  await page.getByRole("heading", { name: "Find the lowest price" }).waitFor();
  assert.equal(
    await page.locator("#pricesTab").getAttribute("aria-current"),
    "page",
  );
  await page.getByRole("button", { name: "Compare prices" }).click();
  await page.locator("#priceSearchError").waitFor();
  assert.equal(requests.length, 0);
  await page.locator("#priceSearchIsbn").fill("ISBN: 0-385-49649-4");
  let release;
  hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Compare prices" }).click();
  await page.getByRole("button", { name: "Checking shops…" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Checking shops…" }).isDisabled(),
    true,
  );
  release();
  hold = null;
  await page.locator(".price-offer").first().waitFor();
  assert.equal(requests[0].isbn, isbn);
  assert.equal(await page.locator(".price-offer-best").count(), 1);
  assert.equal(
    await page.locator(".price-offer-best h3").textContent(),
    "Naiin",
  );
  assert.match(await page.locator(".price-offer-best").textContent(), /166.25/);
  assert.match(
    await page.locator(".price-warning").textContent(),
    /Phoenix Next/,
  );
  assert.equal(new URL(page.url()).searchParams.get("isbn"), isbn);
  assert.equal(
    await page.locator(".price-offer a").first().getAttribute("target"),
    "_blank",
  );
  await page.getByText("All 6 shop checks", { exact: true }).click();
  assert.equal(await page.locator(".price-sources li").count(), 6);

  const directory = join(process.cwd(), ".impeccable", "review");
  mkdirSync(directory, { recursive: true });
  const settleCapture = async () => {
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  await settleCapture();
  await page.screenshot({
    path: join(directory, "price-finder-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settleCapture();
  await page.screenshot({
    path: join(directory, "price-finder-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "Dark theme" }).click();
  await settleCapture();
  await page.screenshot({
    path: join(directory, "price-finder-dark.png"),
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Refresh prices" }).click();
  await page.locator(".price-offer").first().waitFor();
  assert.equal(requests.at(-1).refresh, true);

  // Editing the query cancels the old search and removes stale results.
  hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Refresh prices" }).click();
  await page.getByRole("button", { name: "Checking shops…" }).waitFor();
  await page.locator("#priceSearchIsbn").fill("9786166247275");
  release();
  hold = null;
  assert.equal(await page.locator(".price-offer").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Compare prices" }).isDisabled(),
    false,
  );

  response = {
    isbn: "9786166247275",
    offers: [],
    sources: comparison.sources.map((source) => ({
      ...source,
      status: "not_found",
    })),
  };
  await page.getByRole("button", { name: "Compare prices" }).click();
  await page
    .getByRole("heading", { name: "No matching listings found" })
    .waitFor();
  assert.match(
    await page.locator(".price-search-status").textContent(),
    /No exact ISBN matches/,
  );
  response = {
    ...response,
    sources: response.sources.map((source) => ({
      ...source,
      status: "unavailable",
    })),
  };
  await page.getByRole("button", { name: "Refresh prices" }).click();
  await page
    .getByText("The shops could not be reached.", { exact: false })
    .waitFor();
  status = 500;
  response = { message: "Prices could not be checked. Try again." };
  await page.getByRole("button", { name: "Refresh prices" }).click();
  await page.locator("#priceSearchError").waitFor();
  assert.match(
    await page.locator("#priceSearchError").textContent(),
    /Try again/,
  );

  status = 200;
  response = comparison;
  await page.goto(testUrl + "/prices?isbn=" + isbn);
  await page.locator(".price-offer").first().waitFor();
  assert.equal(await page.locator("#priceSearchIsbn").inputValue(), isbn);

  // The book form opens a comparison in a new tab and retains the draft.
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  await page.locator("#addButton").click();
  await page.locator("#isbn").fill(isbn);
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#findBookPrices").click();
  const popup = await popupPromise;
  await popup.waitForURL("**/prices?isbn=" + isbn);
  await popup.close();
  assert.equal(
    await page.locator("#bookDialog").evaluate((dialog) => dialog.open),
    true,
  );
  assert.equal(await page.locator("#isbn").inputValue(), isbn);
  assert.deepEqual(errors, []);
  console.log(
    "PASS lowest price finder: validation, comparisons, refresh, failures, cancellation, deep links, draft shortcut, desktop/mobile/dark",
  );
} finally {
  await browser.close();
}
