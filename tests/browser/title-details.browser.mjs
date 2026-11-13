import { testUrl } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { seriesPath } from "../../lib/domain/navigation.ts";

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
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    if (name !== "getCollection") return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    data.options.publisher.push("Yen Press", "Phoenix Next", "Kodansha JP");
    return route.fulfill({ json: data });
  });
  await page.goto(url);
  await page.waitForFunction(
    () => document.getElementById("addButton")?.disabled === false,
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
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#editTitleButton").click();
  assert.equal(await page.locator("#titleEditions fieldset").count(), 2);
  assert.match(
    await page.locator("#titleSaveHint").textContent(),
    /all 3 owned volumes/,
  );
  const suggestions = () =>
    page
      .locator("#publisherOptions option")
      .evaluateAll((options) => options.map((option) => option.value));
  await page.locator("#titleEditionPublisher0").focus();
  assert.equal((await suggestions()).includes("Yen Press"), true);
  assert.equal((await suggestions()).includes("Phoenix Next"), true);
  assert.equal((await suggestions()).includes("Kodansha JP"), true);
  await page.locator("#titleEditionPublisher1").focus();
  assert.equal((await suggestions()).includes("Yen Press"), true);
  assert.equal((await suggestions()).includes("Kodansha JP"), true);
  assert.equal((await suggestions()).includes("Phoenix Next"), true);
  await page.locator("#titleEditionType1").selectOption("Light novel");
  await page.locator("#titleEditionPublisher1").focus();
  assert.equal((await suggestions()).includes("Yen Press"), true);
  assert.equal((await suggestions()).includes("Phoenix Next"), true);
  assert.equal((await suggestions()).includes("Kodansha JP"), true);
  await page.locator("#titleEditionType1").selectOption("Manga");
  await page.locator("#titleSeries").fill("Canceled name");
  await page.locator("#cancelTitle").click();
  assert.equal(await page.locator("#seriesTitle").textContent(), original);

  await page.locator("#editTitleButton").click();
  assert.equal(await page.locator("#titleSeries").inputValue(), original);
  await page.locator("#titleSeries").fill(renamed);
  await page.locator("#titleEditionType0").selectOption("Light novel");
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
      !!window.bookCollection?.state.data &&
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
      ["Light novel", "Updated Thai press"],
      ["Light novel", "Updated Thai press"],
      ["Manga", "Japanese press"],
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
    .selectOption(
      JSON.stringify(["Light novel", "Updated Thai press", "Light novel (TH)"]),
    );
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
  assert.equal(added.type, "Light novel");
  assert.match(
    added.edition,
    /\(TH\)/,
    "The chosen edition must retain its language",
  );
  assert.equal(added.publisher, "Updated Thai press");
  assert.equal(added.source, "My new shop");
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
  await page.locator("#type").selectOption("Light novel");
  await page.locator("#publisher").fill("English press");
  await page.locator("#toggleBookDetails").click();
  if (!(await page.locator("#bookExtras").evaluate((details) => details.open)))
    await page.locator("#bookExtras > summary").click();
  await page.locator("#edition").fill("LN (EN)");
  await page.locator("#volume").fill("1");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection?.state.busy,
  );
  await page.reload();
  await page.locator("#backSeries").click();
  await page.waitForFunction(
    () => document.getElementById("addButton")?.disabled === false,
  );
  await page.locator("#search").fill(renamed);
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#editTitleButton").click();
  assert.equal(await page.locator("#titleEditions fieldset").count(), 3);
  assert.equal(
    await page.locator("#titleEditionType2").inputValue(),
    "Light novel",
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
  await page.locator("#cancelTitle").click();

  // One publisher may sell the same type in multiple languages. Keep language
  // choices separate without copying a volume's colour/format or purchase data.
  const bilingual = marker + " bilingual";
  for (const book of [
    { volume: 1, edition: "Manga (JP)", date: "2026-10-01" },
    { volume: 1, edition: "Manga (TH) (Color)", date: "2026-10-02" },
    { volume: 3, edition: "Manga (TH) (Color)", date: "2026-10-03" },
  ])
    await page.evaluate(
      (book) =>
        window.bookCollection.rpc("saveBook", {
          requestId: crypto.randomUUID(),
          book,
        }),
      {
        series: bilingual,
        type: "Manga",
        publisher: "Bilingual press",
        status: "Read",
        source: "Original shop",
        note: "Original note",
        price: 90,
        ...book,
      },
    );
  await page.goto(url + seriesPath(bilingual));
  const ready = () =>
    page.waitForFunction(
      () =>
        !!window.bookCollection?.state.data &&
        !window.bookCollection.state.busy,
    );
  await ready();
  await page.locator("#bookList .missing-book-card").click();
  assert.equal(await page.locator("#edition").inputValue(), "Manga (TH)");
  await page.locator("#cancelBook").click();
  await page.locator("#addButton").click();
  assert.equal(await page.locator("#edition").inputValue(), "Manga (TH)");
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator("#note").inputValue(), "");
  assert.equal(await page.locator("#price").inputValue(), "");
  assert.equal(await page.locator("#bookEdition option").count(), 3);
  assert.match(
    await page.locator("#bookEdition").textContent(),
    /Manga \(TH\)/,
  );
  assert.match(
    await page.locator("#bookEdition").textContent(),
    /Manga \(JP\)/,
  );
  await page
    .locator("#bookEdition")
    .selectOption(JSON.stringify(["Manga", "Bilingual press", "Manga (JP)"]));
  assert.equal(await page.locator("#edition").inputValue(), "Manga (JP)");
  await page.locator("#volume").fill("2");
  await page.locator("#keepAdding").check();
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      document.getElementById("bookDialog").open &&
      document.getElementById("volume").value === "" &&
      !window.bookCollection.state.busy,
  );
  assert.equal(await page.locator("#edition").inputValue(), "Manga (JP)");
  await page.locator("#bookEdition").selectOption("new");
  assert.equal(await page.locator("#edition").inputValue(), "");
  await page.locator("#cancelBook").click();
  await page.reload();
  await ready();
  const reloaded = await page.evaluate(
    () => window.bookCollection.state.data.books,
  );
  assert.equal(
    reloaded.find((book) => book.series === bilingual && book.volume === 2)
      .edition,
    "Manga (JP)",
  );
  assert.ok(
    reloaded
      .filter((book) => book.series === bilingual && book.volume !== 2)
      .every(
        (book) =>
          book.source === "Original shop" &&
          book.note === "Original note" &&
          book.price === 90,
      ),
  );
  assert.equal(await page.locator("#seriesGaps .missing-edition").count(), 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS title-level series, type and publisher edits, separate editions, inheritance, cancellation, reload and phone/desktop layouts",
  );
} finally {
  const cleanup = await browser.newPage();
  const response = await cleanup.request.post(url + "/api/rpc", {
    data: { name: "getCollection" },
  });
  assert.equal(response.status(), 200, await response.text());
  const data = await response.json();
  for (const book of data.books.filter((book) =>
    book.series.startsWith(marker),
  ))
    await cleanup.request.post(url + "/api/rpc", {
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
