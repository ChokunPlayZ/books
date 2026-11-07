import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const collectionGate = deferred();
const knownGate = deferred();
const sourceGates = [deferred(), deferred()];
const previewGate = deferred();
const importGate = deferred();
const sources = [
  { id: "first", name: "First source" },
  { id: "second", name: "Second source" },
];
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let failCollection = false;
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getCollection") {
      await collectionGate.promise;
      if (failCollection)
        return route.fulfill({
          status: 503,
          json: { message: "The request could not finish." },
        });
    }
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    if (name === "searchKnownEntities") {
      if (arg.query === "Fail search")
        return route.fulfill({
          status: 503,
          json: { message: "Search could not finish. Try again." },
        });
      await knownGate.promise;
      return route.fulfill({
        json: { query: arg.query, results: [], sources },
      });
    }
    if (name === "searchExternalTitles") {
      const index = sources.findIndex((source) => source.id === arg.sourceId);
      await sourceGates[index].promise;
      return route.fulfill({
        json: { source: sources[index], results: [], status: "complete" },
      });
    }
    return route.continue();
  });

  // Even when the initial request stalls, a prominent spinner remains visible.
  await page.goto(testUrl);
  const activity = page.locator(".site-activity");
  await activity.waitFor({ state: "visible" });
  assert.match(await activity.innerText(), /Loading your library/);
  assert.equal(await activity.locator(".loading-spinner").isVisible(), true);
  collectionGate.resolve();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await activity.waitFor({ state: "hidden" });

  // Refresh failures clear the busy state and leave an actionable error.
  failCollection = true;
  await page.locator("#refreshButton").click();
  await page.locator("#pageError").waitFor({ state: "visible" });
  await activity.waitFor({ state: "hidden" });
  assert.equal(await page.locator("#refreshButton").isEnabled(), true);
  assert.equal(
    await page.locator("#refreshButton").getAttribute("aria-busy"),
    "false",
  );
  failCollection = false;

  // A native page navigation shows feedback before the next document arrives.
  const navigationGate = deferred();
  await page.route("**/search", async (route) => {
    if (route.request().isNavigationRequest()) await navigationGate.promise;
    return route.continue();
  });
  await page.evaluate(() => {
    const activity = document.querySelector(".site-activity");
    const observer = new MutationObserver(() => {
      if (!activity.hidden) {
        console.info("navigation-activity:" + activity.textContent);
        observer.disconnect();
      }
    });
    observer.observe(activity, {
      attributes: true,
      subtree: true,
      childList: true,
    });
  });
  // Locators wait for pending navigations; observe the old document directly.
  const navigationActivity = page.waitForEvent("console", {
    predicate: (message) => message.text().startsWith("navigation-activity:"),
  });
  const navigating = page.locator("#searchTab").click({ noWaitAfter: true });
  assert.match((await navigationActivity).text(), /Loading page/);
  navigationGate.resolve();
  await navigating;
  await page.waitForURL(testUrl + "/search");
  await activity.waitFor({ state: "hidden" });

  await page.locator("#universalSearchQuery").fill("Loading test");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const searchStatus = page.locator(".universal-search-loading");
  await searchStatus.waitFor({ state: "visible" });
  assert.match(await searchStatus.innerText(), /Looking up known titles/);
  assert.equal(
    await searchStatus.locator("progress").getAttribute("value"),
    null,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Searching…", exact: true })
      .isDisabled(),
    true,
  );
  knownGate.resolve();
  await page.waitForFunction(() =>
    document
      .querySelector(".universal-search-loading")
      ?.textContent.includes("0/2"),
  );
  assert.equal(await searchStatus.locator("progress").getAttribute("max"), "2");
  sourceGates[0].resolve();
  await page.waitForFunction(
    () =>
      document.querySelector(".universal-search-loading progress")?.value === 1,
  );
  assert.match(await searchStatus.innerText(), /1\/2/);
  assert.equal(await activity.isVisible(), true);
  await page.screenshot({
    path: join(process.cwd(), "outputs", "loading-search-phone.png"),
  });
  // Editing the query cancels the outstanding search and removes its activity.
  await page.locator("#universalSearchQuery").fill("Replacement");
  await searchStatus.waitFor({ state: "hidden" });
  await activity.waitFor({ state: "hidden" });
  sourceGates[1].resolve();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".universal-search-status")
      ?.textContent.includes("Search complete"),
  );
  await activity.waitFor({ state: "hidden" });
  await page.locator("#universalSearchQuery").fill("Fail search");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator("#universalSearchError").waitFor({ state: "visible" });
  await activity.waitFor({ state: "hidden" });
  assert.equal(
    await page.getByRole("button", { name: "Search", exact: true }).isEnabled(),
    true,
  );

  // Preview and saving are distinct stages, without invented percentages.
  let importAttempt = 0;
  await page.route("**/api/import", async (route) => {
    if (importAttempt++ === 0) {
      await previewGate.promise;
      return route.fulfill({
        json: {
          fingerprint: "loading-preview",
          books: 2,
          trash: 0,
          savedReleases: 0,
          seriesCatalogs: 0,
          sample: [],
          warnings: [],
        },
      });
    }
    await importGate.promise;
    if (importAttempt === 2)
      return route.fulfill({
        status: 503,
        json: { message: "Import failed. Try again." },
      });
    return route.fulfill({ json: { books: 2 } });
  });
  await page.goto(testUrl + "/data");
  await page.locator("#importFile").setInputFiles({
    name: "collection.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await page
    .getByRole("button", { name: "Review import", exact: true })
    .click();
  const importStatus = page.locator(".import-loading");
  await importStatus.waitFor({ state: "visible" });
  assert.match(await importStatus.innerText(), /Reading and checking/);
  assert.match(await importStatus.innerText(), /has not changed yet/);
  assert.equal(
    await importStatus.locator("progress").getAttribute("value"),
    null,
  );
  assert.equal(await page.locator("#importFile").isDisabled(), true);
  previewGate.resolve();
  await page.locator(".import-review").waitFor();
  await importStatus.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Import this collection", exact: true })
    .click();
  await importStatus.waitFor({ state: "visible" });
  assert.match(await importStatus.innerText(), /Importing your collection/);
  assert.match(await importStatus.innerText(), /Keep this page open/);
  assert.equal(
    await page
      .getByRole("button", { name: "Importing…", exact: true })
      .isDisabled(),
    true,
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: join(process.cwd(), "outputs", `loading-import-${width}.png`),
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  assert.equal(
    await importStatus
      .locator(".loading-spinner")
      .evaluate((node) => getComputedStyle(node).animationName),
    "none",
  );
  importGate.resolve();
  await page.locator(".data-card .form-error").waitFor({ state: "visible" });
  await importStatus.waitFor({ state: "hidden" });
  await activity.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Import this collection", exact: true })
    .click();
  await page.locator(".import-success").waitFor();
  await activity.waitFor({ state: "hidden" });
  assert.match(
    await page.locator(".import-success").innerText(),
    /Imported 2 books/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS clear loading, navigation, progressive search, cancellation, import stages and error cleanup",
  );
} finally {
  collectionGate.resolve();
  knownGate.resolve();
  sourceGates.forEach((gate) => gate.resolve());
  previewGate.resolve();
  importGate.resolve();
  await browser.close();
}
