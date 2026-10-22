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
  let pendingLookup = null;
  await page.route("**/api/rpc", async (route) => {
    if (route.request().postDataJSON()?.name !== "lookupIsbn")
      return route.continue();
    const isbn = route.request().postDataJSON().arg;
    if (isbn === "9781975319434")
      return route.fulfill({ json: { isbn, found: false, warnings: [] } });
    if (isbn === "9780385496490")
      return route.fulfill({
        status: 503,
        json: { message: "Lookup unavailable" },
      });
    const next = isbn === "9786166247404";
    if (pendingLookup) await pendingLookup.promise;
    await route.fulfill({
      json: {
        isbn,
        found: true,
        details: {
          title: next ? marker + " next" : marker,
          series: next ? marker + " next" : marker,
          volume: "1",
          publisher: next ? "Next press" : "Mobile press",
          source: "Test lookup",
          price: 180,
        },
        warnings: [],
      },
    });
  });
  for (const [isbn, message] of [
    ["9781975319434", "No book details found"],
    ["9780385496490", "Lookup unavailable"],
  ]) {
    await page.locator("#isbn").fill(isbn);
    await page.locator("#lookupButton").click();
    await page.waitForFunction(
      (message) =>
        document.getElementById("lookupResult").textContent.includes(message),
      message,
    );
    assert.equal(await page.locator("#isbn").isVisible(), true);
    assert.equal(await page.locator("#series").isVisible(), true);
    assert.equal(await page.locator("#toggleLookupDetails").isVisible(), false);
    assert.equal(await page.locator("#isbnLookupStatus").isVisible(), false);
    assert.equal(
      await page.locator("#bookForm").getAttribute("aria-busy"),
      "false",
    );
  }
  pendingLookup = Promise.withResolvers();
  await page.locator("#isbn").fill("9780140328721");
  await page.locator("#isbn").press("Enter");
  await page.locator("#isbnLookupStatus").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#isbnLookupStatus").textContent(),
    /Looking up ISBN…/,
  );
  assert.match(
    await page.locator("#isbnLookupMessage").textContent(),
    /9780140328721/,
  );
  assert.equal(
    await page.locator("#bookForm").getAttribute("aria-busy"),
    "true",
  );
  assert.equal(await page.locator("#lookupButton").isEnabled(), false);
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page
      .locator("#bookDialog .dialog-body")
      .evaluate((body) => (body.scrollTop = body.scrollHeight));
    const banner = await page.locator("#isbnLookupStatus").boundingBox();
    assert.ok(banner.y >= 0 && banner.y + banner.height <= height);
    assert.equal(
      await page
        .locator("#isbnLookupStatus")
        .evaluate((status) => status.scrollWidth <= status.clientWidth),
      true,
    );
    await visibleSave(height);
    if (width !== 320)
      await page.screenshot({
        path: fileURLToPath(
          new URL(
            `../../outputs/browser-isbn-loading-${width}.png`,
            import.meta.url,
          ),
        ),
      });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(
    await page
      .locator(".isbn-lookup-spinner")
      .evaluate(
        (spinner) =>
          parseFloat(getComputedStyle(spinner).animationDuration) <= 0.01,
      ),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  pendingLookup.resolve();
  pendingLookup = null;
  await page.waitForFunction(
    (marker) => document.getElementById("series").value === marker,
    marker,
  );
  assert.equal(await page.locator("#isbnLookupStatus").isVisible(), false);
  assert.equal(
    await page.locator("#bookForm").getAttribute("aria-busy"),
    "false",
  );
  console.log(
    "PASS prominent ISBN loading banner stays visible while scrolling on phone/desktop, respects reduced motion and clears on completion or failure",
  );
  assert.equal(await page.locator("#volume").inputValue(), "1");
  assert.equal(await page.locator("#publisher").inputValue(), "Mobile press");
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator("#price").inputValue(), "");
  assert.equal(await page.locator("#regularPrice").inputValue(), "180");
  assert.match(
    await page.locator("#listedPriceHint").textContent(),
    /180.*Test lookup/,
  );
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    assert.deepEqual(
      await page
        .locator(
          "#bookForm input:not([type=checkbox]):visible, #bookForm select:visible, #bookForm textarea:visible",
        )
        .evaluateAll((fields) => fields.map((field) => field.id)),
      ["source", "price"],
    );
    await visibleSave(height);
    assert.equal(
      await page
        .locator("#bookDialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
      true,
    );
    if (width !== 320)
      await page.screenshot({
        path: fileURLToPath(
          new URL(
            `../../outputs/browser-isbn-adding-${width}.png`,
            import.meta.url,
          ),
        ),
      });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#price").fill("120");
  await page.locator("#source").fill("Mobile shop");
  await page.locator("#toggleLookupDetails").click();
  assert.equal(await page.locator("#isbn").isVisible(), true);
  assert.equal(await page.locator("#volume").isVisible(), true);
  await page.locator("#note").fill("Added on a small screen");
  await page.locator("#publisherUrl").fill("invalid-url");
  await page.locator("#toggleLookupDetails").click();
  await page.locator("#saveButton").click();
  assert.equal(await page.locator("#publisherUrl").isVisible(), true);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "publisherUrl",
  );
  await page.locator("#publisherUrl").fill("");
  await page.locator("#toggleLookupDetails").click();
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
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator("#publisher").inputValue(), "Mobile press");
  assert.equal(await page.locator("#isbn").inputValue(), "");
  assert.equal(await page.locator("#note").inputValue(), "");
  assert.equal(await page.locator("#price").inputValue(), "");
  assert.equal(await page.locator("#bookExtras").getAttribute("open"), null);
  assert.equal(await page.locator("#toggleLookupDetails").isVisible(), false);
  assert.equal(await page.locator("#isbn").isVisible(), true);
  await visibleSave(430);
  await page.locator("#isbn").fill("9786166247404");
  await page.locator("#isbn").press("Enter");
  await page.waitForFunction(
    (marker) => document.getElementById("series").value === marker + " next",
    marker,
  );
  assert.equal(await page.locator("#publisher").inputValue(), "Next press");
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator("#price").inputValue(), "");
  assert.equal(await page.locator("#isbn").isVisible(), false);
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
  assert.equal(saved.source, "Mobile shop");
  assert.equal(saved.volume, 1);
  console.log(
    "PASS scan return, ISBN lookup, hidden-field validation, saved details and repeated adding",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#search").fill(marker);
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  assert.equal(await page.locator("#series").inputValue(), marker);
  assert.equal(await page.locator("#source").inputValue(), "");
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
