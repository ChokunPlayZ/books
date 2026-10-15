import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { releaseItem } from "../../lib/domain.ts";

const url = process.env.BOOKS_TEST_URL;
if (!url) throw new Error("Run through npm run test:e2e.");
const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const coverId = createHash("sha256").update(bytes).digest("hex");
const marker = "Yaakz browser " + Date.now();
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
  const items = [2, 1].map((volume) => ({
    ...releaseItem(
      "yaakz",
      marker + " discovery เล่ม " + volume,
      "https://www.yaakz.com/product/" + (10000 + volume),
      95,
      "",
      "Manga (TH)",
    ),
    coverId,
    coverUrl: "https://du.lnwfile.com/cover-" + volume + ".jpg",
  }));
  await page.route("**/api/rpc", (route) => {
    const request = route.request().postDataJSON();
    if (request.name === "getBookCover")
      return route.fulfill({ json: { row: request.arg.row, coverId: "" } });
    if (request.name === "getSeriesCatalog")
      return route.fulfill({ json: { items: [], complete: true } });
    if (
      request.name === "getPublisherDirectory" &&
      request.arg.url.includes("yaakz")
    )
      return route.fulfill({
        json: {
          items,
          publisherId: "yaakz",
          url: request.arg.url,
          complete: true,
          checkedAt: new Date().toISOString(),
        },
      });
    if (request.name === "getPublisherDirectory")
      return route.fulfill({
        json: {
          titles: [],
          items: [],
          publisherId: "phoenix",
          url: request.arg.url,
        },
      });
    if (request.name === "getBookCoverOptions")
      return route.fulfill({
        json: {
          covers: [
            {
              source: "Naiin",
              coverId,
              coverUrl: "https://storage.naiin.com/browser-cover.png",
              publisherUrl: "",
              title: marker,
            },
            {
              source: "Yaakz",
              coverId,
              coverUrl: "https://du.lnwfile.com/browser-cover.png",
              publisherUrl: "",
              title: marker,
            },
          ],
          warnings: [],
        },
      });
    return route.continue();
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#discoverTab").click();
  await page.locator("#discoveryPreset").selectOption("https://www.yaakz.com/");
  const card = page.locator(".discovery-card").filter({ hasText: marker });
  await card.locator("img").waitFor();
  assert.equal(await card.count(), 1);
  assert.match(await card.textContent(), /Volume 1/);
  assert.equal(
    await card.locator("img").getAttribute("src"),
    "/api/covers/" + coverId,
  );
  await page.locator("#collectionTab").click();
  await page.evaluate(
    async ({ marker }) => {
      await window.bookCollection?.rpc("saveBook", {
        requestId: crypto.randomUUID(),
        book: {
          series: marker,
          volume: 1,
          type: "Manga (TH)",
          publisher: "Other publisher",
          status: "Read",
        },
      });
      document.getElementById("refreshButton").click();
    },
    { marker },
  );
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  await page.locator("#search").fill(marker);
  await page.locator(".series-row").click();
  await page
    .getByRole("button", {
      name: "Volume options for " + marker + ", volume 1",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Change cover", exact: true }).click();
  await page.locator("#pullPublisherCovers").click();
  await page.locator(".cover-choice").nth(1).waitFor();
  assert.match(
    await page.locator("#publisherCoverChoices").textContent(),
    /Naiin.*Yaakz/,
  );
  await page.locator(".cover-choice").first().click();
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => !document.getElementById("bookDialog").open);
  await page.reload();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  const saved = await page.evaluate(
    (marker) =>
      window.bookCollection?.state.data.books.find(
        (book) => book.series === marker,
      ),
    marker,
  );
  assert.equal(saved.coverId, coverId);
  assert.equal(saved.coverUrl, "https://storage.naiin.com/browser-cover.png");
  assert.deepEqual(errors, []);
  assert.deepEqual(externalImages, []);
  console.log(
    "PASS Yaakz discovery, first-volume IDs, bookstore choice labels and saved cover persistence",
  );
} finally {
  const cleanup = await browser.newPage();
  await cleanup.goto(url);
  await cleanup.waitForFunction(
    () => typeof window.bookCollection?.rpc === "function",
  );
  await cleanup.evaluate(async (marker) => {
    for (const book of (
      await window.bookCollection?.rpc("getCollection")
    ).books.filter((book) => book.series === marker))
      await window.bookCollection?.rpc("removeBook", {
        row: book.row,
        token: book.token,
        requestId: crypto.randomUUID(),
      });
  }, marker);
  await browser.close();
}
