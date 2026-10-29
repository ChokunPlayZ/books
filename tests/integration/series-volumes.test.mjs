import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../../lib/server/store.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { releaseItem } from "../../lib/domain.ts";

const base = {
  series: "เรื่องทดสอบ / Series & notes",
  type: "Manga (TH)",
  publisher: "Phoenix Next",
  status: "Reading",
  volume: 1,
  isbn: "9780140328721",
  source: "Original shop",
  price: 90,
  date: "2026-10-01",
  note: "Original note",
};
const coverUrl = "https://www.phoenixnext.com/media/catalog/product/cover.png";
const otherCoverUrl =
  "https://www.phoenixnext.com/media/catalog/product/other.png";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
function setup(t) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  for (const book of [
    base,
    { ...base, volume: 2 },
    { ...base, type: "LN (TH)" },
    { ...base, series: "Another series" },
  ])
    store.api.saveBook({ requestId: randomUUID(), book, allowDuplicate: true });
  return store;
}
function request(
  books,
  patches = [
    {
      volume: "1.5",
      status: "Read",
      isbn: "0140328726",
      type: "LN (EN)",
      publisher: "Yen Press",
      note: " =literal note ",
      date: "",
      price: "0",
      source: " New shop ",
      coverUrl: "https://images.yenpress.com/imgs/9798400903526.jpg",
      publisherUrl: "https://yenpress.com/titles/test",
    },
    { volume: "", price: "", note: "" },
  ],
) {
  return {
    requestId: randomUUID(),
    series: base.series,
    changes: patches.map((book, index) => ({
      row: books[index].row,
      token: books[index].token,
      book,
    })),
  };
}

test("volume saves update all details atomically, preserve intentional copies and untouched fields, and retry safely", (t) => {
  const store = setup(t);
  const before = store.api.getCollection().books;
  const edit = request(before);
  const result = store.api.saveSeriesVolumes(edit);
  assert.deepEqual(result, { volumes: 2, action: "volumes updated" });
  assert.deepEqual(store.api.saveSeriesVolumes(edit), result);
  const after = store.api.getCollection();
  assert.deepEqual(after.books.slice(2), before.slice(2));
  assert.equal(after.books[0].volume, 1.5);
  assert.equal(after.books[0].status, "Read");
  assert.equal(after.books[0].isbn, "0140328726");
  assert.equal(after.books[0].type, "LN (EN)");
  assert.equal(after.books[0].publisher, "Yen Press");
  assert.equal(after.books[0].note, "=literal note");
  assert.equal(after.books[0].date, "");
  assert.equal(after.books[0].price, 0);
  assert.equal(after.books[0].source, "New shop");
  assert.equal(after.books[0].coverUrl, edit.changes[0].book.coverUrl);
  assert.equal(after.books[0].publisherUrl, edit.changes[0].book.publisherUrl);
  assert.equal(after.books[1].volume, "");
  assert.equal(after.books[1].price, "");
  assert.equal(after.books[1].note, "");
  assert.equal(after.books[1].isbn, before[1].isbn);
  assert.ok(after.options.publisher.includes("Yen Press"));
  assert.ok(after.options.source.includes("New shop"));
  assert.notEqual(after.books[0].token, before[0].token);
});

test("invalid details and duplicate, stale, missing or cross-series rows roll back every volume and its options", (t) => {
  const store = setup(t);
  const before = store.api.getCollection().books;
  for (const [patch, message] of [
    [{ volume: "-1" }, /non-negative/],
    [{ isbn: "invalid" }, /ISBN/],
    [{ status: "" }, /reading status/],
    [{ type: "" }, /book type/],
    [{ note: "x".repeat(2001) }, /too long/],
    [{ date: "2026-02-30" }, /valid date/],
    [{ price: "Infinity" }, /non-negative/],
    [{ coverUrl: "https://example.com/cover.png" }, /cover URL/],
    [{ publisherUrl: "https://example.com/book" }, /publisher/],
  ]) {
    const edit = request(before, [{ source: "Should roll back" }, patch]);
    assert.throws(() => store.api.saveSeriesVolumes(edit), message);
    assert.deepEqual(store.api.getCollection().books, before);
    assert.equal(
      store.api.getCollection().options.source.includes("Should roll back"),
      false,
    );
  }
  for (const [change, message] of [
    [{ row: before[0].row, token: before[0].token }, /only once/],
    [{ row: before[3].row, token: before[3].token }, /same series/],
    [{ token: "stale" }, /book changed/],
    [{ row: 9999 }, /book changed/],
  ]) {
    const edit = request(before, [
      { source: "Should roll back" },
      { note: "Change" },
    ]);
    Object.assign(edit.changes[1], change);
    assert.throws(() => store.api.saveSeriesVolumes(edit), message);
    assert.deepEqual(store.api.getCollection().books, before);
  }
});

test("batch edits cannot rename series or replace stored cover IDs, and invalidate automatic artwork when identity changes", (t) => {
  const store = setup(t);
  let first = store.api.getCollection().books[0];
  const cover = store.covers.put(
    { contentType: "image/png", body: png },
    coverUrl,
  );
  store.covers.assign(first.row, cover.id, first.token);
  first = store.api.getCollection().books[0];
  store.api.saveSeriesVolumes(
    request(
      [first],
      [
        {
          note: "Keep automatic artwork",
          series: "Injected",
          coverId: "0".repeat(64),
        },
      ],
    ),
  );
  first = store.api.getCollection().books[0];
  assert.equal(first.series, base.series);
  assert.equal(first.coverId, cover.id);
  store.api.saveSeriesVolumes(request([first], [{ volume: 12 }]));
  assert.equal(store.api.getCollection().books[0].coverId, "");
  first = store.api.getCollection().books[0];
  store.api.saveSeriesVolumes(request([first], [{ coverUrl }]));
  first = store.api.getCollection().books[0];
  assert.equal(first.coverId, cover.id);
  const alternate = store.covers.put(
    { contentType: "image/png", body: Buffer.from("alternate") },
    otherCoverUrl,
  );
  store.api.saveSeriesVolumes(request([first], [{ coverUrl: otherCoverUrl }]));
  assert.equal(store.api.getCollection().books[0].coverId, alternate.id);
  first = store.api.getCollection().books[0];
  store.api.saveSeriesVolumes(request([first], [{ coverUrl: "" }]));
  assert.equal(store.api.getCollection().books[0].coverId, "");
});

test("series export isolates books, covers, settings and releases and restores the same copies to a fresh library", (t) => {
  const store = setup(t);
  const first = store.api.getCollection().books[0];
  const cover = store.covers.put(
    { contentType: "image/png", body: png },
    coverUrl,
  );
  store.covers.assign(first.row, cover.id, first.token);
  store.covers.put(
    { contentType: "image/png", body: Buffer.from("unrelated") },
    otherCoverUrl,
  );
  for (const series of [base.series, "Another series"]) {
    store.api.setSeriesCatalog({
      series,
      publisherId: "phoenix",
      type: base.type,
      url: "https://www.phoenixnext.com/book-series/test.html",
    });
    const release = releaseItem(
      "phoenix",
      series + " เล่ม 4",
      "https://www.phoenixnext.com/" +
        (series === base.series ? "series" : "other") +
        ".html",
      100,
      "",
      base.type,
    );
    store.api.setSavedRelease({ saved: true, release: { ...release, series } });
  }
  const exportData = store.exportData(base.series);
  assert.equal(exportData.format, "book-collection");
  assert.equal(exportData.books.length, 3);
  assert.equal(
    exportData.books.every((book) => book.series === base.series),
    true,
  );
  assert.equal(exportData.covers.length, 1);
  assert.equal(exportData.covers[0].id, cover.id);
  assert.equal(exportData.trash.length, 0);
  assert.equal(exportData.savedReleases.length, 1);
  assert.equal(exportData.seriesCatalogs.length, 1);
  assert.deepEqual(exportData.options.series, [base.series]);
  assert.throws(() => store.exportData("Missing series"), { status: 404 });
  const restored = openStore(":memory:");
  t.after(() => restored.close());
  const plan = parseImport(
    Buffer.from(JSON.stringify(exportData)),
    "series.json",
  );
  restored.importData(plan, plan.fingerprint);
  const withoutIdentity = ({ row, token, ...book }) => book;
  assert.deepEqual(
    restored.api.getCollection().books.map(withoutIdentity),
    exportData.books.map(withoutIdentity),
  );
  assert.deepEqual(restored.covers.get(cover.id).body, png);
  assert.equal(restored.api.getCollection().savedReleases.length, 1);
  assert.equal(restored.api.getCollection().seriesCatalogs.length, 1);
  assert.equal(store.exportData().books.length, 4);
  assert.equal(store.exportData().covers.length, 2);
});
