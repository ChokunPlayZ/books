import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const url = process.env.BOOKS_TEST_URL || "http://localhost:3000";
const marker = "Title details check " + Date.now();
const original = marker + " original",
  renamed = marker + " renamed";
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto(url);
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  for (const book of [
    {
      volume: 1,
      type: "Manga (TH)",
      publisher: "Thai press",
      source: "First shop",
    },
    {
      volume: 2,
      type: "Manga (TH)",
      publisher: "Thai press",
      source: "Second shop",
    },
    {
      volume: 1,
      type: "Manga (JP)",
      publisher: "Japanese press",
      source: "Japanese shop",
    },
  ])
    await page.evaluate(
      (book) =>
        window.bookCollection?.rpc("saveBook", {
          requestId: crypto.randomUUID(),
          book,
        }),
      {
        series: original,
        isbn: "",
        status: "Read",
        price: 90,
        date: "2026-10-01",
        note: "Keep my note",
        ...book,
      },
    );
  await page.locator("#refreshButton").click();
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  await page.locator("#search").fill(original);
  await page.locator(".series-row").click();
  await page.locator("#editTitleButton").click();
  assert.equal(await page.locator("#titleEditions fieldset").count(), 2);
  assert.match(
    await page.locator("#titleSaveHint").textContent(),
    /all 3 owned volumes/,
  );
  await page.locator("#titleSeries").fill("Canceled name");
  await page.locator("#cancelTitle").click();
  assert.equal(await page.locator("#seriesTitle").textContent(), original);

  await page.locator("#editTitleButton").click();
  assert.equal(await page.locator("#titleSeries").inputValue(), original);
  await page.locator("#titleSeries").fill(renamed);
  await page.locator("#titleEditionType0").selectOption("LN (TH)");
  await page.locator("#titleEditionPublisher0").fill("Updated Thai press");
  assert.equal(
    await page
      .locator("#titleDialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../outputs/browser-title-details-phone.png", import.meta.url),
    ),
  });
  await page.locator("#saveTitleButton").click();
  await page.waitForFunction(
    (name) =>
      !document.getElementById("titleDialog").open &&
      !window.bookCollection?.state.busy &&
      document.getElementById("seriesTitle").textContent === name,
    renamed,
  );
  let books = await page.evaluate(
    (name) =>
      window.bookCollection?.state.data.books.filter(
        (book) => book.series === name,
      ),
    renamed,
  );
  assert.equal(books.length, 3);
  assert.deepEqual(
    books.map((book) => [book.type, book.publisher]),
    [
      ["LN (TH)", "Updated Thai press"],
      ["LN (TH)", "Updated Thai press"],
      ["Manga (JP)", "Japanese press"],
    ],
  );
  assert.deepEqual(
    books.map((book) => book.source),
    ["First shop", "Second shop", "Japanese shop"],
  );
  assert.ok(
    books.every((book) => book.note === "Keep my note" && book.price === 90),
  );

  await page.locator("#addButton").click();
  for (const id of ["series", "type", "publisher"])
    assert.equal(await page.locator("#" + id).isVisible(), false);
  await page.locator("#source").fill("My new shop");
  await page
    .locator("#bookEdition")
    .selectOption(JSON.stringify(["LN (TH)", "Updated Thai press"]));
  assert.equal(await page.locator("#source").inputValue(), "My new shop");
  await page.locator("#volume").fill("3");
  await page.locator("#toggleBookDetails").click();
  for (const id of ["series", "type", "publisher"])
    assert.equal(await page.locator("#" + id).isVisible(), false);
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection?.state.busy,
  );
  await page.waitForFunction(
    (name) =>
      window.bookCollection?.state.data.books.some(
        (book) => book.series === name && book.volume === 3,
      ),
    renamed,
  );
  books = await page.evaluate(
    (name) =>
      window.bookCollection?.state.data.books.filter(
        (book) => book.series === name,
      ),
    renamed,
  );
  const added = books.find((book) => book.volume === 3);
  assert.equal(added.type, "LN (TH)");
  assert.equal(added.publisher, "Updated Thai press");
  assert.equal(added.source, "My new shop");
  await page
    .getByRole("button", {
      name: "Volume options for " + renamed + ", volume 3",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Edit " + renamed + ", volume 3",
      exact: true,
    })
    .click();
  for (const id of ["series", "type", "publisher"])
    assert.equal(await page.locator("#" + id).isVisible(), false);
  assert.equal(await page.locator("#isbn").isVisible(), true);
  await page.locator("#cancelBook").click();

  await page.locator("#addButton").click();
  await page.locator("#bookEdition").selectOption("new");
  assert.equal(await page.locator("#series").isVisible(), false);
  await page.locator("#type").selectOption("LN (EN)");
  await page.locator("#publisher").fill("English press");
  await page.locator("#volume").fill("1");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection?.state.busy,
  );
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  await page.locator("#search").fill(renamed);
  await page.locator(".series-row").click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#editTitleButton").click();
  assert.equal(await page.locator("#titleEditions fieldset").count(), 3);
  assert.equal(
    await page.locator("#titleEditionType2").inputValue(),
    "LN (EN)",
  );
  assert.equal(
    await page.locator("#titleEditionPublisher2").inputValue(),
    "English press",
  );
  assert.equal(
    await page
      .locator("#titleDialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../outputs/browser-title-details-desktop.png",
        import.meta.url,
      ),
    ),
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS title-level series, type and publisher edits, separate editions, inheritance, cancellation, reload and phone/desktop layouts",
  );
} finally {
  const cleanup = await browser.newPage();
  await cleanup.goto(url);
  await cleanup.waitForFunction(
    () => typeof window.bookCollection?.rpc === "function",
  );
  await cleanup.evaluate(async (marker) => {
    const data = await window.bookCollection?.rpc("getCollection");
    for (const book of data.books.filter((book) =>
      book.series.startsWith(marker),
    ))
      await window.bookCollection?.rpc("removeBook", {
        requestId: crypto.randomUUID(),
        row: book.row,
        token: book.token,
      });
  }, marker);
  await browser.close();
}
