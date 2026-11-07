import test from "node:test";
import assert from "node:assert/strict";
import { exportLibraryBook } from "../../lib/domain/library-export.ts";
import { parseImport } from "../../lib/server/importer.ts";

const book = {
  isbn: "9780316769488",
  series: "ชื่อเรื่องส่วนตัว",
  type: "Manga",
  volume: 4.5,
  edition: "Thai colour edition",
  status: "Reading",
  source: "Gift from a friend",
  price: 0,
  date: "2026-11-01",
  note: "=Keep this literal\nMy private note",
  publisher: "Phoenix Next",
  publisherUrl: "https://www.phoenixnext.com/example.html",
  coverUrl: "https://www.phoenixnext.com/media/catalog/product/example.jpg",
  coverId: "a".repeat(64),
  pageCount: 208,
  msrp: 175,
  msrpCurrency: "THB",
  row: 14,
  token: "internal-revision-token",
  futureMetadata: "never export new fields by default",
};

test("library exports allow only ISBN, title and personal collection fields", () => {
  assert.deepEqual(exportLibraryBook(book), {
    isbn: book.isbn,
    title: book.series,
    type: book.type,
    volume: 4.5,
    edition: book.edition,
    status: book.status,
    source: book.source,
    price: 0,
    date: book.date,
    note: book.note,
  });
});

test("personal library exports re-import titles, duplicates, gifts and unknown prices without metadata", () => {
  const exported = {
    format: "book-collection",
    version: 1,
    books: [book, { ...book, price: "", volume: "" }].map(exportLibraryBook),
  };
  const plan = parseImport(
    Buffer.from(JSON.stringify(exported)),
    "library.json",
  );
  assert.equal(plan.books.length, 2);
  assert.equal(plan.books[0].series, book.series);
  assert.equal(plan.books[0].note, book.note);
  assert.equal(plan.books[0].edition, book.edition);
  assert.equal(plan.books[0].price, 0);
  assert.equal(plan.books[0].volume, 4.5);
  assert.equal(plan.books[1].price, "");
  assert.equal(plan.books[1].volume, "");
  for (const entry of plan.books) {
    assert.equal(entry.publisher, "");
    assert.equal(entry.coverUrl, "");
    assert.equal(entry.publisherUrl, "");
    assert.equal(entry.pageCount, "");
    assert.equal(entry.msrp, "");
    assert.equal(entry.coverId, undefined);
  }
  assert.deepEqual(plan.covers, []);
  assert.deepEqual(plan.trash, []);
  assert.deepEqual(plan.savedReleases, []);
  assert.deepEqual(plan.seriesCatalogs, []);
});
