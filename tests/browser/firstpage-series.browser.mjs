import { testUrl } from "../helpers/browser.mjs";
// Uses the Node catalog reader, public publisher fixtures and an isolated library.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/series-catalogs/" + name, import.meta.url),
    "utf8",
  );
const chishunki = "ชิชุนกิจัง สาวใสวัยลองรัก";
const parfait = "พาร์เฟ่ต์แลกรัก ของคุณซัคคิวบัสเกินต้าน";
const boss = "แล้วไหงบอสสาวจอมเฮี้ยบถึงได้ย้อนเวลามาหวานกับผมสมัยเรียนแบบนี้";
const store = openStore(":memory:");
const books = JSON.parse(
  readFileSync(new URL("../fixtures/collection.json", import.meta.url), "utf8"),
);
const firstpage = books.filter((book) => book.publisher === "First Page Pro");
const numbered = firstpage.find((book) =>
  book.series.startsWith("รักลงทัณฑ์"),
).series;
for (const book of firstpage.filter(
  (book) => book.series !== boss || book.volume < 3,
))
  // Legacy snapshots can contain invalid ISBNs; this check compares series/volumes.
  store.api.saveBook({
    book: { ...book, isbn: "" },
    requestId: crypto.randomUUID(),
  });
const categories = {
  56: "firstpage-category.html",
  134: "firstpage-parfait-category.html",
  135: "firstpage-numbered-category.html",
  86: "firstpage-boss-category.html",
};
const service = createCatalogService(store, async (url) => {
  const path = new URL(url).pathname;
  if (path === "/") return new Response(fixture("firstpage-directory.html"));
  const id = /^\/category\/(\d+)/.exec(path)?.[1];
  if (!categories[id]) throw new Error("Unexpected catalog URL: " + url);
  if (path === "/category/" + id)
    return new Response("", {
      status: 301,
      headers: {
        Location: Buffer.from(url + "/manga-books/ชื่อเรื่อง", "utf8").toString(
          "latin1",
        ),
      },
    });
  return new Response(fixture(categories[id]));
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    try {
      const result =
        name === "getBookCover"
          ? { row: arg.row, coverUrl: "" }
          : await (service[name] || store.api[name])(arg);
      await route.fulfill({ json: result });
    } catch (error) {
      await route.fulfill({ status: 400, json: { message: error.message } });
    }
  });
  await page.goto(process.env.BOOKS_TEST_URL || "http://localhost:3000");
  await page.waitForFunction(
    () =>
      typeof window.bookCollection?.state !== "undefined" &&
      !!window.bookCollection?.state.data,
  );
  const openSeries = async (series) => {
    if (await page.locator("#backSeries").isVisible())
      await page.locator("#backSeries").click();
    await page.locator("#search").fill(series);
    await page.locator(".series-row").click();
    await page.waitForFunction(
      () => !window.bookCollection?.state.catalogLoading.size,
    );
  };
  const missing = page.locator("#seriesReleaseList .release-card");

  await openSeries(chishunki);
  assert.equal(await missing.count(), 6);
  assert.equal(await missing.first().isVisible(), true);
  assert.match(await missing.first().textContent(), /Volume 6/);
  assert.match(await missing.last().textContent(), /Volume 11/);
  assert.match(
    await page.locator("#seriesMissingSummary").textContent(),
    /0 gaps.*6 catalog volumes/,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await missing.first().isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });

  await openSeries(parfait);
  assert.equal(await missing.count(), 1);
  assert.match(await missing.textContent(), /Volume 3/);
  assert.equal(await missing.isVisible(), true);
  console.log(
    "PASS First Page's unowned volumes appear on phone and desktop after Thai URL redirects",
  );

  await openSeries(numbered);
  assert.equal(await missing.count(), 0);
  assert.equal(await page.locator("#seriesCatalogToggle").isVisible(), true);
  await page.locator("#seriesCatalogToggle").click();
  await page.locator("#seriesCatalogDetails summary").click();
  assert.match(
    await page.locator("#seriesReleaseSources").textContent(),
    /1 listings.*All category pages checked/,
  );
  assert.equal(await page.locator(".catalog-editor").count(), 0);
  console.log(
    "PASS a category named with volume 01 automatically matches its series",
  );

  await openSeries(boss);
  const editor = page.locator(".catalog-editor");
  assert.equal(await editor.isVisible(), true);
  assert.match(
    await page.locator("#seriesReleaseStatus").textContent(),
    /Choose the publisher/,
  );
  await editor
    .getByLabel("Find the publisher’s series name")
    .fill("แล้วไหงบอสสาว");
  await editor
    .locator("select")
    .selectOption("https://www.firstpagepro.com/category/86");
  await editor.getByRole("button", { name: "Use this catalog" }).click();
  await page.waitForFunction(
    () =>
      !window.bookCollection?.state.catalogLoading.size &&
      document.querySelectorAll("#seriesReleaseList .release-card").length ===
        1,
  );
  assert.match(await missing.textContent(), /Volume 3/);
  assert.equal(await missing.isVisible(), true);
  await page.reload();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await openSeries(boss);
  assert.equal(await missing.count(), 1);
  assert.equal(await missing.isVisible(), true);
  assert.equal(await editor.count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS a differently named First Page series offers visible category choices and retains its link after reload",
  );
} finally {
  await browser.close();
  store.close();
}
