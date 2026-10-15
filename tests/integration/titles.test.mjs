import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../../lib/server/store.ts";

const base = {
  series: "A story",
  type: "Manga (TH)",
  publisher: "Phoenix Next",
  status: "Read",
  volume: 1,
  isbn: "",
  source: "Shop",
  price: 90,
  date: "2026-10-01",
  note: "Keep this note",
  coverUrl: "https://www.phoenixnext.com/media/catalog/product/cover.jpg",
  publisherUrl: "https://www.phoenixnext.com/story-01.html",
};
let sequence = 0;
const id = () => "title_test_request_" + ++sequence;
function seed(store) {
  for (const book of [
    base,
    { ...base, volume: 2, isbn: "9780140328721" },
    {
      ...base,
      volume: 1,
      type: "Manga (JP)",
      publisher: "Japanese press",
      publisherUrl: "",
    },
  ])
    store.api.saveBook({ requestId: id(), book });
  store.api.setSeriesCatalog({
    series: base.series,
    publisherId: "phoenix",
    type: base.type,
    url: "https://www.phoenixnext.com/book-series/story.html",
  });
}
function edit(store, series = "Renamed story") {
  const title = store.api.getCollection().titles[0];
  return {
    requestId: id(),
    series: title.series,
    token: title.token,
    title: {
      series,
      editions: [
        {
          originalType: base.type,
          originalPublisher: base.publisher,
          type: "LN (TH)",
          publisher: "PHOENIX Next",
        },
        {
          originalType: "Manga (JP)",
          originalPublisher: "Japanese press",
          type: "Manga (JP)",
          publisher: "Japanese press",
        },
      ],
    },
  };
}

test("title edits update all volumes, preserve separate editions and volume details, and move catalog links", () => {
  const store = openStore(":memory:");
  try {
    seed(store);
    const before = store.api.getCollection().books;
    const request = edit(store);
    const result = store.api.saveTitle(request);
    assert.deepEqual(result, {
      series: "Renamed story",
      volumes: 3,
      action: "title updated",
    });
    assert.deepEqual(store.api.saveTitle(request), result);
    const data = store.api.getCollection();
    data.books.forEach((book, index) => {
      assert.equal(book.series, "Renamed story");
      assert.equal(book.type, index < 2 ? "LN (TH)" : "Manga (JP)");
      assert.equal(
        book.publisher,
        index < 2 ? "PHOENIX Next" : "Japanese press",
      );
      for (const field of [
        "isbn",
        "status",
        "volume",
        "source",
        "price",
        "date",
        "note",
        "coverUrl",
        "publisherUrl",
      ])
        assert.equal(book[field], before[index][field]);
      assert.notEqual(book.token, before[index].token);
    });
    assert.equal(data.seriesCatalogs[0].series, "Renamed story");
    assert.equal(data.seriesCatalogs[0].type, "LN (TH)");
    assert.ok(data.options.series.includes("Renamed story"));
    assert.notEqual(data.titles[0].token, request.token);
    const backup = store.exportData();
    assert.deepEqual(backup.books, data.books);
  } finally {
    store.close();
  }
});

test("title saves reject stale volume edits, additions and incomplete editions without partial updates", () => {
  const store = openStore(":memory:");
  try {
    seed(store);
    let request = edit(store);
    const book = store.api.getCollection().books[0];
    store.api.saveBook({
      requestId: id(),
      row: book.row,
      token: book.token,
      book: { ...book, note: "Edited elsewhere" },
    });
    assert.throws(() => store.api.saveTitle(request), /title changed/);
    assert.ok(
      store.api
        .getCollection()
        .books.every((book) => book.series === base.series),
    );
    request = edit(store);
    store.api.saveBook({ requestId: id(), book: { ...base, volume: 3 } });
    assert.throws(() => store.api.saveTitle(request), /title changed/);
    request = edit(store);
    request.title.editions.pop();
    assert.throws(() => store.api.saveTitle(request), /editions changed/);
    store.db.exec(
      "CREATE TRIGGER fail_title_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'simulated failure'); END;",
    );
    assert.throws(() => store.api.saveTitle(edit(store)), /simulated failure/);
    assert.ok(
      store.api
        .getCollection()
        .books.every((book) => book.series === base.series),
    );
    assert.equal(
      store.api.getCollection().seriesCatalogs[0].series,
      base.series,
    );
  } finally {
    store.close();
  }
});

test("changing an edition publisher clears incompatible publisher links and prevents accidental title merging", () => {
  const store = openStore(":memory:");
  try {
    seed(store);
    store.api.saveBook({
      requestId: id(),
      book: { ...base, series: "Other title" },
    });
    assert.throws(
      () => store.api.saveTitle(edit(store, "OTHER TITLE")),
      /already exists/,
    );
    const request = edit(store);
    request.title.editions[0].publisher = "Luckpim";
    store.api.saveTitle(request);
    const data = store.api.getCollection();
    assert.equal(data.books[0].publisherUrl, "");
    assert.equal(data.books[1].publisherUrl, "");
    assert.equal(data.books[2].publisher, "Japanese press");
    assert.equal(data.seriesCatalogs.length, 0);
    assert.equal(data.books[3].series, "Other title");
  } finally {
    store.close();
  }
});
