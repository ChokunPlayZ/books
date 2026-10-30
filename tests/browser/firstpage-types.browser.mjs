import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createTestLibrary } from "../helpers/library.mjs";

const fixture = readFileSync(
  new URL("../fixtures/publishers/firstpage-formats.html", import.meta.url),
  "utf8",
);
const cards = fixture.match(
  /<div class="productArea productItem">[^\n]+<\/div>/g,
);
const directory =
  '<a href="https://www.firstpagepro.com/category/1/light-novel-books">Light Novel</a><a href="https://www.firstpagepro.com/category/8/light-novel-books/shared">เรื่องสองรูปแบบ</a><a href="https://www.firstpagepro.com/category/2/manga-books">Manga</a><a href="https://www.firstpagepro.com/category/9/manga-books/shared">เรื่องสองรูปแบบ</a>';
const library = createTestLibrary();
library.setResponses([
  { match: "/category/8", text: '<span class="tsk-all">1</span>' + cards[1] },
  { match: "/category/9", text: '<span class="tsk-all">1</span>' + cards[0] },
  { match: "/search?", text: fixture },
  { match: "/showroom/new", text: fixture },
  { match: "https://www.firstpagepro.com/", text: directory },
]);
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
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { coverUrl: "" } });
    try {
      return await route.fulfill({ json: await library.api[name](arg) });
    } catch (error) {
      return route.fulfill({ status: 400, json: { message: error.message } });
    }
  });
  const ready = () =>
    page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.goto(testUrl + "/discover");
  await ready();
  await page
    .locator("#discoveryPreset")
    .selectOption("https://www.firstpagepro.com/");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#discoveryList .discovery-card").length === 2,
  );
  await page.locator("#discoveryType").selectOption("LN");
  assert.equal(await page.locator("#discoveryList .discovery-card").count(), 1);
  const addNovel = page
    .locator("#discoveryList")
    .getByRole("button", { name: "Add to shelf", exact: true });
  await addNovel.scrollIntoViewIfNeeded();
  await addNovel.click();
  assert.equal(await page.locator("#type").inputValue(), "LN (TH)");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection.state.busy &&
      window.bookCollection.state.data.books.some(
        (book) => book.type === "LN (TH)",
      ),
  );
  assert.equal(library.api.getCollection().books[0].type, "LN (TH)");
  await page.locator("#discoveryType").selectOption("Manga");
  assert.equal(await page.locator("#discoveryList .discovery-card").count(), 1);
  await page
    .locator("#discoveryList")
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#type").inputValue(), "Manga (TH)");
  await page.locator("#cancelBook").click();

  // Exercise the actual server parser through ISBN search, not hand-coded types.
  await page.locator("#discoveryType").selectOption("LN");
  await page.locator("#discoverySearch").fill("9786166247275");
  await page.locator("#discoveryList .release-card").waitFor();
  assert.equal(await page.locator("#discoveryList .release-card").count(), 1);
  assert.match(
    await page.locator("#discoveryList .release-card h2").textContent(),
    /^นิยาย /,
  );
  await page
    .locator("#discoveryList")
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#type").inputValue(), "LN (TH)");
  await page.locator("#cancelBook").click();
  await page.locator("#discoveryType").selectOption("Manga");
  assert.equal(await page.locator("#discoveryList .release-card").count(), 1);
  assert.match(
    await page.locator("#discoveryList .release-card h2").textContent(),
    /^การ์ตูน /,
  );
  await page
    .locator("#discoveryList")
    .getByRole("button", { name: "Add to shelf", exact: true })
    .click();
  assert.equal(await page.locator("#type").inputValue(), "Manga (TH)");
  await page.locator("#cancelBook").click();

  await page.goto(testUrl + "/releases");
  await ready();
  await page.waitForFunction(() => window.bookCollection.state.releasesLoaded);
  await page.locator("#releasePublisher").selectOption("firstpage");
  await page.locator("#releaseScope").selectOption("all");
  await page.locator("#releaseType").selectOption("LN");
  assert.equal(await page.locator("#releaseList .release-card").count(), 1);
  assert.match(
    await page.locator("#releaseList .release-card h2").textContent(),
    /^นิยาย /,
  );
  await page.locator("#releaseType").selectOption("Manga");
  assert.equal(await page.locator("#releaseList .release-card").count(), 1);
  assert.match(
    await page.locator("#releaseList .release-card h2").textContent(),
    /^การ์ตูน /,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS First Page real catalog types, same-name format separation, filters, ISBN lookup and add-form/save persistence",
  );
} finally {
  await browser.close();
  library.close();
}
