import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const prefix = "Unowned catalog " + Date.now();
const series = Object.fromEntries(
  [
    "Consecutive",
    "Gap",
    "Choose",
    "Outage",
    "Complete",
    "Another",
    "Unsupported",
  ].map((name) => [name, prefix + " " + name]),
);
const base = {
  type: "Manga (TH)",
  publisher: "PHOENIX Next",
  source: "Owned shop",
  status: "Read",
};
const item = (name, volume, extra = {}) => ({
  id: name + ":" + volume,
  series: series[name],
  title: series[name] + " เล่ม " + volume,
  volume,
  type: base.type,
  publisher: base.publisher,
  publisherId: "phoenix",
  isbn: "",
  url: `https://www.phoenixnext.com/catalog-${name.toLowerCase()}-${volume}.html`,
  price: 175,
  special: false,
  bundle: false,
  availability: "",
  ...extra,
});
const feeds = {
  [series.Consecutive]: [
    item("Consecutive", 1),
    item("Consecutive", 2),
    item("Consecutive", 2.5),
    item("Consecutive", 3),
    item("Consecutive", 4, { special: true, id: "special-4" }),
    item("Consecutive", 4),
    item("Consecutive", 5, {
      availability: "Pre-order",
      isbn: "9780140328721",
    }),
    item("Consecutive", 6, { type: "Manga (JP)" }),
    item("Consecutive", 7, { catalogVariant: true }),
    item("Consecutive", 8, { bundle: true }),
  ],
  [series.Gap]: [item("Gap", 2), item("Gap", 4)],
  [series.Complete]: [item("Complete", 1), item("Complete", 2)],
  [series.Another]: [item("Another", 2)],
};
let releaseInitial;
const initialGate = new Promise((resolve) => {
  releaseInitial = resolve;
});
let active = 0,
  peak = 0,
  failingRefresh = false,
  recentCalls = 0;
const requests = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rpc = async (name, arg) => {
    const response = await page.request.post(testUrl + "/api/rpc", {
      data: { name, arg },
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  for (const [name, volumes] of Object.entries({
    Consecutive: [1, 2],
    Gap: [1, 3],
    Choose: [1],
    Outage: [1],
    Complete: [1, 2],
    Another: [1],
    Unsupported: [1, 3],
  }))
    for (const volume of volumes)
      await rpc("saveBook", {
        requestId: crypto.randomUUID(),
        book: {
          ...base,
          series: series[name],
          volume,
          ...(name === "Unsupported"
            ? { publisher: "Unsupported publisher" }
            : {}),
        },
      });
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getPublisherReleases") recentCalls++;
    if (name !== "getSeriesCatalog") return route.continue();
    requests.push(arg);
    active++;
    peak = Math.max(peak, active);
    try {
      await initialGate;
      if (
        arg.series === series.Outage ||
        (failingRefresh && arg.series === series.Consecutive)
      )
        return await route.fulfill({
          status: 503,
          json: { message: "Test outage" },
        });
      return await route.fulfill({
        json: {
          items: feeds[arg.series] || [],
          complete: arg.series !== series.Choose,
          needsSelection: arg.series === series.Choose,
          checkedAt: "2026-10-19T00:00:00Z",
        },
      });
    } finally {
      active--;
    }
  });
  await page.goto(testUrl + "/missing");
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.waitForFunction(() =>
    document
      .getElementById("missingCatalogStatus")
      .textContent.includes("0 of 6"),
  );
  assert.equal(
    await page.locator("#refreshMissingCatalogs").isDisabled(),
    true,
  );
  assert.equal(requests.length <= 3, true);
  releaseInitial();
  await page.waitForFunction(() =>
    document
      .getElementById("missingCatalogStatus")
      .textContent.startsWith("6 publisher catalogs checked"),
  );
  assert.equal(peak <= 3, true);
  assert.equal(requests.length, 6);
  assert.equal(recentCalls, 0);
  assert.equal(
    await page.locator("#missingSummary").textContent(),
    "8 missing volumes across 4 series",
  );
  const card = (name) =>
    page.locator(".missing-series").filter({
      has: page.getByRole("heading", { name: series[name], exact: true }),
    });
  assert.equal(
    await card("Consecutive").locator(".missing-total").textContent(),
    "4 missing",
  );
  assert.equal(
    await card("Consecutive").locator(".missing-catalog-volume").count(),
    4,
  );
  assert.match(await card("Consecutive").textContent(), /Pre-order/);
  assert.equal(
    await card("Consecutive")
      .getByRole("button", { name: new RegExp("Add catalog volume 4 ") })
      .count(),
    1,
  );
  assert.equal(
    await card("Gap").locator(".missing-total").textContent(),
    "2 missing",
  );
  assert.equal(await card("Gap").locator(".missing-ranges").count(), 0);
  assert.equal(await card("Complete").count(), 0);
  assert.match(
    await page.locator("#missingCoverageList").textContent(),
    /Choose a catalog/,
  );
  assert.match(
    await page.locator("#missingCoverageList").textContent(),
    /Catalog check incomplete/,
  );
  assert.match(
    await page.locator("#missingCoverageList").textContent(),
    /Shelf gaps only/,
  );
  assert.match(
    await page.locator("#missingCoverageSummary").textContent(),
    /Checks need attention/,
  );
  await page.locator("#missingSearch").fill(series.Consecutive);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `outputs/missing-catalogs-${width}.png`,
      fullPage: true,
    });
  }
  await card("Consecutive")
    .getByRole("button", { name: new RegExp("Add catalog volume 5 ") })
    .click();
  assert.equal(await page.locator("#series").inputValue(), series.Consecutive);
  assert.equal(await page.locator("#volume").inputValue(), "5");
  assert.equal(await page.locator("#isbn").inputValue(), "9780140328721");
  assert.equal(await page.locator("#publisher").inputValue(), base.publisher);
  assert.equal(await page.locator("#price").inputValue(), "");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      document.getElementById("missingSummary").textContent ===
        "3 missing volumes across 1 series",
  );
  assert.equal(
    requests.length,
    6,
    "Purchasing a volume reuses the loaded catalog",
  );
  await rpc("saveBook", {
    requestId: crypto.randomUUID(),
    book: { ...base, series: series.Consecutive, volume: 4 },
  });
  await page.locator("#refreshButton").click();
  await page.waitForFunction(
    () =>
      document.getElementById("missingSummary").textContent ===
      "2 missing volumes across 1 series",
  );
  failingRefresh = true;
  await page.locator("#refreshMissingCatalogs").click();
  await page.waitForFunction(
    () => !document.getElementById("refreshMissingCatalogs").disabled,
  );
  assert.equal(requests.filter((request) => request.refresh).length, 6);
  assert.equal(
    await card("Consecutive").locator(".missing-total").textContent(),
    "2 missing",
  );
  assert.match(
    await page.locator("#missingCoverageList").textContent(),
    /Catalog check incomplete/,
  );
  failingRefresh = false;
  await page.reload();
  await page.waitForFunction(() =>
    document
      .getElementById("missingCatalogStatus")
      .textContent.startsWith("6 publisher catalogs checked"),
  );
  await page.locator("#missingSearch").fill(series.Consecutive);
  assert.equal(
    await card("Consecutive").locator(".missing-total").textContent(),
    "2 missing",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS unowned catalog volumes beyond the shelf, bounded requests, gap/edition deduplication, preorders, coverage, purchases, refresh failures and reload",
  );
} finally {
  releaseInitial();
  const cleanup = await browser.newPage();
  const response = await cleanup.request.post(testUrl + "/api/rpc", {
    data: { name: "getCollection" },
  });
  for (const book of (await response.json()).books.filter((book) =>
    book.series.startsWith(prefix),
  ))
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
