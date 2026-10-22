import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const isbn = "9786164897397";
const series = "พาร์เฟ่ต์แลกรัก ของคุณซัคคิวบัสเกินต้าน";
const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const store = openStore(":memory:");
const service = createCatalogService(store, async (url) => {
  if (url.includes("naiin.com"))
    return new Response('<product-list :items="[]">');
  if (url.includes("yaakz.com")) return new Response('{"data":[],"total":0}');
  if (url.includes("firstpagepro.com/search"))
    return new Response(
      new URL(url).searchParams.get("q") === isbn
        ? fixture("firstpage-isbn-search.html")
        : '<span class="tsk-all">0</span>',
    );
  if (url.includes("firstpagepro.com/product"))
    return new Response(fixture("firstpage-isbn-product.html"));
  if (url.includes("phoenixnext.com/catalogsearch"))
    return new Response(fixture("phoenix.html"));
  if (url.includes("phoenixnext.com/"))
    return new Response(fixture("phoenix-isbn-product.html"));
  assert.fail("Unexpected lookup provider: " + url);
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
    lookups = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Barcode recognition is tested separately; exercise the actual scan acceptance
  // and lookup flow with the user's decoded barcode and captured publisher pages.
  await page.addInitScript((isbn) => {
    window.ZXingWASM = { readBarcodes: async () => [{ text: isbn }] };
  }, isbn);
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/api/rpc", async (route) => {
    const request = route.request().postDataJSON();
    if (request.name === "getBookCover")
      return route.fulfill({ json: { row: request.arg.row, coverUrl: "" } });
    if (request.name === "lookupIsbn") {
      lookups.push(request.arg);
      return route.fulfill({ json: await service.lookupIsbn(request.arg) });
    }
    return route.continue();
  });
  await page.goto(testUrl);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  await page.locator("#scanButton").click();
  await page
    .locator("#chooseBarcodePhoto")
    .setInputFiles(
      fileURLToPath(new URL("../isbn-photo.png", import.meta.url)),
    );
  await page.waitForFunction(() =>
    document
      .getElementById("lookupResult")
      .textContent.includes("Suggested by First Page Pro"),
  );
  assert.deepEqual(lookups, [isbn]);
  assert.equal(
    await page.locator("#scanDialog").evaluate((dialog) => dialog.open),
    false,
  );
  assert.equal(await page.locator("#isbn").inputValue(), isbn);
  assert.equal(await page.locator("#series").inputValue(), series);
  assert.equal(await page.locator("#volume").inputValue(), "3");
  assert.equal(await page.locator("#type").inputValue(), "Manga (TH)");
  assert.equal(await page.locator("#publisher").inputValue(), "First Page Pro");
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator("#isbn").isVisible(), false);
  assert.equal(await page.locator("#volume").isVisible(), false);
  assert.equal(await page.locator("#regularPrice").inputValue(), "180");
  await page.locator("#toggleLookupDetails").click();
  assert.equal(
    await page
      .getByRole("link", { name: "Search this ISBN at First Page Pro ↗" })
      .getAttribute("href"),
    "https://www.firstpagepro.com/search?q=" + isbn,
  );
  assert.equal(
    await page.locator("#price").inputValue(),
    "",
    "A listing price must not become the amount paid",
  );
  await page.locator("#toggleLookupDetails").click();
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection?.state.busy,
  );
  await page.reload();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  const saved = await page.evaluate(
    (isbn) =>
      window.bookCollection.state.data.books.find((book) => book.isbn === isbn),
    isbn,
  );
  assert.equal(saved.series, series);
  assert.equal(saved.volume, 3);
  assert.equal(saved.type, "Manga (TH)");
  assert.equal(saved.publisher, "First Page Pro");
  assert.equal(saved.source, "");
  assert.equal(saved.price, "");
  assert.deepEqual(errors, []);
  console.log(
    "PASS scanned ISBN 9786164897397 uses verified First Page Pro metadata, fills the correct edition and persists after saving",
  );
  const phoenixIsbn = "9786166247404";
  await page.evaluate((isbn) => {
    window.ZXingWASM = { readBarcodes: async () => [{ text: isbn }] };
  }, phoenixIsbn);
  await page.locator("#addButton").click();
  await page.locator("#scanButton").click();
  await page
    .locator("#chooseBarcodePhoto")
    .setInputFiles(
      fileURLToPath(new URL("../isbn-photo.png", import.meta.url)),
    );
  await page.waitForFunction(() =>
    document
      .getElementById("lookupResult")
      .textContent.includes("Suggested by Phoenix Next"),
  );
  assert.deepEqual(lookups, [isbn, phoenixIsbn]);
  assert.equal(await page.locator("#isbn").inputValue(), phoenixIsbn);
  assert.equal(
    await page.locator("#series").inputValue(),
    "เส้นทางจาริกอาถรรพ์",
  );
  assert.equal(await page.locator("#type").inputValue(), "LN (TH)");
  assert.equal(await page.locator("#publisher").inputValue(), "Phoenix Next");
  assert.equal(await page.locator("#volume").inputValue(), "");
  assert.equal(await page.locator("#price").inputValue(), "");
  assert.equal(await page.locator("#source").inputValue(), "");
  await page.locator("#toggleLookupDetails").click();
  assert.equal(
    await page
      .getByRole("link", { name: "Search this ISBN at Phoenix Next ↗" })
      .getAttribute("href"),
    "https://www.phoenixnext.com/catalogsearch/result/?q=" + phoenixIsbn,
  );
  await page.locator("#toggleLookupDetails").click();
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection?.state.busy,
  );
  await page.reload();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  const phoenix = await page.evaluate(
    (isbn) =>
      window.bookCollection.state.data.books.find((book) => book.isbn === isbn),
    phoenixIsbn,
  );
  assert.equal(phoenix.series, "เส้นทางจาริกอาถรรพ์");
  assert.equal(phoenix.publisher, "Phoenix Next");
  assert.equal(phoenix.type, "LN (TH)");
  assert.equal(phoenix.volume, "");
  assert.deepEqual(errors, []);
  console.log(
    "PASS scanned Phoenix ISBN uses the verified publisher edition, fills the form and persists after saving",
  );
} finally {
  await browser.close();
  store.close();
}
