import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testUrl } from "../helpers/browser.mjs";
import { yenPressBook } from "../../lib/domain/yenpress.ts";

const { chromium } = await import(
  process.env.BOOKS_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const books = [
  {
    isbn: "9781975319434",
    fixture: "yenpress-comic.html",
    type: "Manga (EN)",
    series: "Solo Leveling (comic)",
  },
  {
    isbn: "9798400903526",
    fixture: "yenpress-novel.html",
    type: "LN (EN)",
    series: "Omniscient Reader's Viewpoint (novel)",
  },
];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/api/rpc", async (route) => {
    const request = route.request().postDataJSON();
    if (request?.name === "getBookCover")
      return route.fulfill({ json: { row: request.arg.row, coverUrl: "" } });
    if (request?.name !== "lookupIsbn") return route.continue();
    const book = books.find((book) => book.isbn === request.arg);
    assert.ok(book, "Only fixture ISBNs may be looked up");
    const html = readFileSync(
      new URL("../fixtures/publishers/" + book.fixture, import.meta.url),
      "utf8",
    );
    return route.fulfill({
      json: {
        isbn: book.isbn,
        found: true,
        details: yenPressBook(
          html,
          book.isbn,
          "https://yenpress.com/titles/" + book.isbn + "-book",
        ),
        warnings: [],
      },
    });
  });
  await page.goto(testUrl);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  for (const book of books) {
    await page.locator("#addButton").click();
    await page.locator("#isbn").fill(book.isbn);
    await page.locator("#lookupButton").click();
    await page.waitForFunction(() =>
      document
        .getElementById("lookupResult")
        .textContent.includes("Suggested by Yen Press"),
    );
    assert.equal(await page.locator("#series").inputValue(), book.series);
    assert.equal(await page.locator("#type").inputValue(), book.type);
    assert.equal(await page.locator("#publisher").inputValue(), "Ize Press");
    assert.equal(await page.locator("#volume").inputValue(), "1");
    await page.locator("#saveButton").click();
    await page.waitForFunction(
      () =>
        !document.getElementById("bookDialog").open &&
        !window.bookCollection?.state.busy,
    );
  }
  await page.reload();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  const saved = await page.evaluate(
    () => window.bookCollection.state.data.books,
  );
  for (const book of books) {
    const volume = saved.find((entry) => entry.isbn === book.isbn);
    assert.equal(volume.series, book.series);
    assert.equal(volume.type, book.type);
    assert.equal(volume.publisher, "Ize Press");
    assert.equal(volume.volume, 1);
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS Yen Press comic and novel ISBN suggestions fill English editions and persist after saving and reload",
  );
} finally {
  await browser.close();
}
