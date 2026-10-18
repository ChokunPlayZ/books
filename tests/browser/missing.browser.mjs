import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { seriesPath } from "../../lib/domain/navigation.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const prefix = "Missing overview " + Date.now();
const title = prefix + " เรื่อง / 100% ? #";
const alpha = prefix + " Alpha";
const base = {
  series: title,
  type: "Manga (TH)",
  publisher: "PHOENIX Next",
  source: "Test shop",
  status: "Read",
};
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rpc = async (name, arg) => {
    const response = await page.request.post(testUrl + "/api/rpc", {
      data: { name, arg },
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  await page.goto(testUrl + "/missing");
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(
    await page
      .getByRole("heading", { name: "Your shelf starts here" })
      .isVisible(),
    true,
  );
  for (const entry of [
    { volume: 1, type: "Manga (TH) (Color)" },
    { volume: 2 },
    { volume: 4 },
    { volume: 4 },
    { volume: 4.5 },
    { volume: 1, type: "Manga (JP)" },
    { volume: 3, type: "Manga (JP)" },
    { volume: 3, type: "LN (TH)" },
    { volume: 1, publisher: "Kodansha" },
    { volume: 3, publisher: "Kodansha" },
    { volume: 4, series: alpha },
    { volume: 1, series: prefix + " Complete" },
    { volume: 2, series: prefix + " Complete" },
    { volume: "", series: prefix + " Unnumbered" },
    { volume: 3, series: title },
  ]) {
    await rpc("saveBook", {
      requestId: crypto.randomUUID(),
      book: { ...base, ...entry },
      allowDuplicate: true,
    });
  }
  const records = (await rpc("getCollection")).books.filter((book) =>
    book.series.startsWith(prefix),
  );
  const removed = records.find(
    (book) =>
      book.series === title &&
      book.volume === 3 &&
      book.type === "Manga (TH)" &&
      book.publisher === base.publisher,
  );
  await rpc("removeBook", {
    requestId: crypto.randomUUID(),
    row: removed.row,
    token: removed.token,
  });

  const plain = await browser.newContext({ javaScriptEnabled: false });
  const serverPage = await plain.newPage();
  await serverPage.goto(testUrl + "/missing");
  const serverCard = serverPage.locator(".missing-series").filter({
    has: serverPage.getByRole("heading", { name: title, exact: true }),
  });
  assert.equal(await serverCard.count(), 1);
  assert.equal(
    await serverCard.locator(".missing-total").textContent(),
    "5 missing",
  );
  assert.equal(
    await serverCard
      .getByRole("link", { name: title, exact: true })
      .getAttribute("href"),
    seriesPath(title),
  );
  await plain.close();

  await page.goto(testUrl);
  await page.locator("#missingTab").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(new URL(page.url()).pathname, "/missing");
  assert.equal(
    await page.locator("#missingTab").getAttribute("aria-current"),
    "page",
  );
  assert.equal(
    await page
      .locator("#collectionBrowser, #releasesPanel, #discoverPanel")
      .count(),
    0,
  );
  await page.locator("#missingSearch").fill(prefix);
  assert.equal(await page.locator(".missing-series").count(), 2);
  assert.equal(
    await page.locator("#missingSummary").textContent(),
    "8 missing volumes across 2 series",
  );
  assert.equal(
    await page.locator(".missing-series h2").first().textContent(),
    alpha,
  );
  await page.locator("#missingSort").selectOption("missing");
  assert.equal(
    await page.locator(".missing-series h2").first().textContent(),
    title,
  );
  await page.locator("#missingSearch").fill(title);
  assert.equal(await page.locator(".missing-series-edition").count(), 4);
  assert.equal(
    await page.locator("#missingSummary").textContent(),
    "5 missing volumes across 1 series",
  );
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      await page
        .locator(".tab-label")
        .evaluateAll((labels) =>
          labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
        ),
      true,
      `Navigation labels fit at ${width}px`,
    );
    await page.screenshot({
      path: join(process.cwd(), "outputs", `missing-page-${width}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("button", {
      name: `Add missing volume 3 of ${title}, Manga (TH), PHOENIX Next`,
      exact: true,
    })
    .click();
  assert.equal(await page.locator("#series").inputValue(), title);
  assert.equal(await page.locator("#volume").inputValue(), "3");
  assert.equal(await page.locator("#type").inputValue(), "Manga (TH)");
  assert.equal(await page.locator("#publisher").inputValue(), base.publisher);
  assert.equal(await page.locator("#source").inputValue(), base.source);
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      document.getElementById("missingSummary").textContent ===
        "4 missing volumes across 1 series",
  );
  await page
    .getByRole("button", {
      name: `Add missing volume 1 of ${title}, LN (TH), PHOENIX Next`,
      exact: true,
    })
    .click();
  assert.equal(await page.locator("#volume").inputValue(), "1");
  assert.equal(await page.locator("#type").inputValue(), "LN (TH)");
  await page.locator("#cancelBook").click();
  await page.locator("#missingSearch").fill("no such missing series");
  assert.equal(
    await page.getByRole("heading", { name: "No matching series" }).isVisible(),
    true,
  );
  await page.locator("#missingSearch").fill(title);
  await page.locator("#refreshButton").click();
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  assert.equal(
    await page.locator("#missingSummary").textContent(),
    "4 missing volumes across 1 series",
  );
  await page.reload();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#missingSearch").fill(title);
  assert.equal(
    await page.locator("#missingSummary").textContent(),
    "4 missing volumes across 1 series",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS missing overview: server HTML, series/edition grouping, removed books, ranges, search/sort, add volume, refresh, reload and responsive layouts",
  );
} finally {
  const cleanup = await browser.newPage();
  const response = await cleanup.request.post(testUrl + "/api/rpc", {
    data: { name: "getCollection" },
  });
  const books = (await response.json()).books.filter((book) =>
    book.series.startsWith(prefix),
  );
  for (const book of books)
    await cleanup.request.post(testUrl + "/api/rpc", {
      data: {
        name: "removeBook",
        arg: {
          requestId: crypto.randomUUID(),
          row: book.row,
          token: book.token,
        },
      },
    });
  await browser.close();
}
