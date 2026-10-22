import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { kinokuniyaBook } from "../../lib/domain/kinokuniya.ts";

const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const coverId = createHash("sha256").update(bytes).digest("hex");
const isbn = "9780385496490";
const details = kinokuniyaBook(
  readFileSync(
    new URL("../fixtures/publishers/kinokuniya-book.html", import.meta.url),
    "utf8",
  ),
  isbn,
);
const marker = "Kinokuniya browser " + Date.now();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
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
    route.fulfill({ body: bytes, contentType: "image/png" }),
  );
  await page.route("**/api/rpc", (route) => {
    const request = route.request().postDataJSON();
    if (request.name === "lookupIsbn")
      return route.fulfill({
        json: { isbn, found: true, details, warnings: [] },
      });
    if (request.name === "getBookCover")
      return route.fulfill({ json: { row: request.arg.row, coverId: "" } });
    if (request.name === "getBookCoverOptions")
      return route.fulfill({
        json: {
          covers: [
            {
              source: "Kinokuniya",
              sourceUrl: details.url,
              publisherUrl: "",
              title: details.title,
              coverUrl: details.coverUrl,
              coverId,
            },
          ],
          warnings: [],
        },
      });
    return route.continue();
  });
  await page.goto(testUrl);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  await page.locator("#type").selectOption("Other");
  await page.locator("#isbn").fill("0385496494");
  await page.locator("#lookupButton").click();
  await page.waitForFunction(() =>
    document
      .getElementById("lookupResult")
      .textContent.includes("Suggested by Kinokuniya"),
  );
  assert.equal(await page.locator("#isbn").inputValue(), isbn);
  assert.equal(
    await page.locator("#series").inputValue(),
    "Tuesdays with Morrie",
  );
  assert.equal(
    await page.locator("#publisher").inputValue(),
    "Bantam Doubleday Dell",
  );
  assert.equal(await page.locator("#type").inputValue(), "Other");
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator("#regularPrice").inputValue(), "355");
  assert.equal(await page.locator("#price").inputValue(), "");
  await page.locator("#toggleLookupDetails").click();
  assert.equal(
    await page
      .getByRole("link", { name: "Search this ISBN at Kinokuniya ↗" })
      .getAttribute("href"),
    "https://kinokuniya.co.th/search?type=product&q=" + isbn,
  );
  await page.locator("#series").fill(marker);
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection?.state.busy,
  );
  await page.locator("#search").fill(marker);
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page
    .getByRole("button", { name: "Edit " + marker, exact: true })
    .click();
  await page.locator("#pullPublisherCovers").click();
  await page.locator(".cover-choice").waitFor();
  assert.match(
    await page.locator("#publisherCoverChoices").textContent(),
    /Kinokuniya/,
  );
  await page.locator(".cover-choice").click();
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => !document.getElementById("bookDialog").open);
  await page.reload();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  const saved = await page.evaluate(
    (marker) =>
      window.bookCollection.state.data.books.find(
        (book) => book.series === marker,
      ),
    marker,
  );
  assert.equal(saved.coverId, coverId);
  assert.equal(saved.coverUrl, details.coverUrl);
  assert.equal(saved.publisher, "Bantam Doubleday Dell");
  assert.equal(saved.publisherUrl, "");
  assert.deepEqual(errors, []);
  assert.deepEqual(externalImages, []);
  console.log(
    "PASS Kinokuniya ISBN suggestions, search link, cover choice and saved cover persistence",
  );
} finally {
  await browser.close();
}
