import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const marker = "Mobile adding " + Date.now();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto(testUrl);
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  const ready = () =>
    page.waitForFunction(
      () =>
        !!window.bookCollection?.state.data &&
        !window.bookCollection.state.busy,
    );
  const visibleSave = async (height) => {
    await page.waitForFunction((height) => {
      const rect = document
        .getElementById("saveButton")
        .getBoundingClientRect();
      return rect.y >= 0 && rect.bottom <= height;
    }, height);
    const save = await page.locator("#saveButton").boundingBox();
    assert.ok(save.y >= 0 && save.y + save.height <= height);
    assert.ok(save.height >= 44);
  };
  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator("#addButton").click();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "bookDialogTitle",
    );
    assert.equal(await page.locator("#bookExtras").getAttribute("open"), null);
    assert.equal(
      await page.locator("#priceCalculator").getAttribute("open"),
      null,
    );
    for (const selector of [
      "#bookDialog",
      "#bookDialog .dialog-body",
      "#titleEntry",
      ".isbn-entry",
    ])
      assert.equal(
        await page
          .locator(selector)
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
        true,
      );
    for (const selector of ["#isbn", "#series", "#publisher", "#source"])
      assert.equal(
        await page
          .locator(selector)
          .evaluate((e) => getComputedStyle(e).fontSize),
        "16px",
      );
    await visibleSave(height);
    await page
      .locator("#bookDialog .dialog-body")
      .evaluate((e) => (e.scrollTop = e.scrollHeight));
    await visibleSave(height);
    await page.locator("#cancelBook").click();
  }
  console.log(
    "PASS 320/360/390px add layout, readable fields and reachable save controls",
  );

  await page.locator("#addButton").click();
  await page.locator("#scanButton").click();
  await page.locator("#scanDialog[open]").waitFor();
  assert.equal(await page.getByLabel("Take a barcode photo").isVisible(), true);
  await page.locator("#closeScan").click();
  assert.equal(await page.locator("#bookDialog").getAttribute("open"), "");
  await page.route("**/api/rpc", async (route) => {
    if (route.request().postDataJSON()?.name !== "lookupIsbn")
      return route.continue();
    await route.fulfill({
      json: {
        isbn: "9780140328721",
        found: true,
        details: {
          title: marker,
          series: marker,
          volume: "1",
          publisher: "Mobile press",
          source: "Test lookup",
        },
        warnings: [],
      },
    });
  });
  await page.locator("#isbn").fill("9780140328721");
  await page.locator("#isbn").press("Enter");
  await page.waitForFunction(
    (marker) => document.getElementById("series").value === marker,
    marker,
  );
  assert.equal(await page.locator("#volume").inputValue(), "1");
  assert.equal(await page.locator("#publisher").inputValue(), "Mobile press");
  await page.locator("#price").fill("120");
  await page.locator("#source").fill("Mobile shop");
  await page.locator("#bookExtras > summary").click();
  await page.locator("#note").fill("Added on a small screen");
  await page.locator("#publisherUrl").fill("invalid-url");
  await page.locator("#bookExtras > summary").click();
  await page.locator("#saveButton").click();
  assert.equal(await page.locator("#publisherUrl").isVisible(), true);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "publisherUrl",
  );
  await page.locator("#publisherUrl").fill("");
  await page.locator("#bookExtras > summary").click();
  await page.locator("#keepAdding").check();
  await page.setViewportSize({ width: 390, height: 430 });
  await visibleSave(430);
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      document.getElementById("bookDialog").open &&
      document.getElementById("series").value === "" &&
      !window.bookCollection?.state.busy,
  );
  assert.equal(await page.locator("#source").inputValue(), "Mobile shop");
  assert.equal(await page.locator("#publisher").inputValue(), "Mobile press");
  assert.equal(await page.locator("#isbn").inputValue(), "");
  assert.equal(await page.locator("#note").inputValue(), "");
  assert.equal(await page.locator("#price").inputValue(), "");
  assert.equal(await page.locator("#bookExtras").getAttribute("open"), null);
  await visibleSave(430);
  await page.locator("#cancelBook").click();
  const saved = await page.evaluate(
    async (marker) =>
      (await window.bookCollection.rpc("getCollection")).books.find(
        (book) => book.series === marker,
      ),
    marker,
  );
  assert.equal(saved.price, 120);
  assert.equal(saved.note, "Added on a small screen");
  assert.equal(saved.isbn, "9780140328721");
  console.log(
    "PASS scan return, ISBN lookup, hidden-field validation, saved details and repeated adding",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#search").fill(marker);
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  assert.equal(await page.locator("#series").inputValue(), marker);
  await page.locator("#volume").fill("2");
  await page.locator("#keepAdding").check();
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      document.getElementById("bookDialog").open &&
      document.getElementById("volume").value === "" &&
      !window.bookCollection?.state.busy,
  );
  assert.equal(await page.locator("#series").inputValue(), marker);
  await page
    .locator("#bookDialog")
    .evaluate((dialog) =>
      Promise.all(
        dialog.getAnimations().map((animation) => animation.finished),
      ),
    );
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../outputs/browser-mobile-adding-series.png",
        import.meta.url,
      ),
    ),
  });
  await page.locator("#cancelBook").click();
  await page
    .getByRole("button", { name: "Edit " + marker + ", volume 1", exact: true })
    .click();
  assert.equal(await page.locator("#note").isVisible(), true);
  assert.equal(await page.locator("#note").inputValue(), saved.note);
  await page.locator("#cancelBook").click();
  await ready();
  await page.goto(testUrl);
  await ready();
  await page.locator("#addButton").click();
  await page
    .locator("#bookDialog")
    .evaluate((dialog) =>
      Promise.all(
        dialog.getAnimations().map((animation) => animation.finished),
      ),
    );
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-mobile-adding.png", import.meta.url),
    ),
  });
  await page.locator("#cancelBook").click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#addButton").click();
  assert.equal(await page.locator("#note").isVisible(), true);
  assert.equal(await page.locator("#regularPrice").isVisible(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS repeated series volumes, existing-book editing and desktop access to optional details",
  );
} finally {
  const cleanup = await browser.newPage();
  await cleanup.goto(testUrl);
  await cleanup.waitForFunction(
    () => typeof window.bookCollection?.rpc === "function",
  );
  await cleanup.evaluate(async (marker) => {
    const data = await window.bookCollection.rpc("getCollection");
    for (const book of data.books.filter((book) => book.series === marker))
      await window.bookCollection.rpc("removeBook", {
        requestId: crypto.randomUUID(),
        row: book.row,
        token: book.token,
      });
  }, marker);
  await browser.close();
}
