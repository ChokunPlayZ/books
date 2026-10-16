import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../../lib/server/store.ts";

const base = {
  series: "Purchase table story",
  type: "Manga (TH)",
  publisher: "Phoenix Next",
  status: "Reading",
  volume: 1,
  isbn: "9780140328721",
  source: "Original shop",
  price: 90,
  date: "2026-10-01",
  note: "Keep this note",
  coverUrl: "https://www.phoenixnext.com/media/catalog/product/cover.jpg",
  publisherUrl: "https://www.phoenixnext.com/story-01.html",
};
let sequence = 0;
const id = () => "purchase_table_request_" + ++sequence;

function seed(store) {
  for (const book of [
    base,
    { ...base, volume: 2 },
    { ...base, type: "Manga (JP)", price: 0, date: "", source: "" },
    { ...base, series: "Another story" },
  ])
    store.api.saveBook({ requestId: id(), book, allowDuplicate: true });
  return store.api.getCollection().books;
}

function edit(books) {
  return {
    requestId: id(),
    series: base.series,
    changes: books.slice(0, 2).map((book, index) => ({
      row: book.row,
      token: book.token,
      date: index ? "" : "2026-10-15",
      price: index ? "" : "0",
      source: index ? "" : " New shop ",
    })),
  };
}

test("series purchase saves preserve other fields and copies, distinguish zero from blank, and retry once", () => {
  const store = openStore(":memory:");
  try {
    const before = seed(store);
    const request = edit(before);
    const result = store.api.saveSeriesPurchases(request);
    assert.deepEqual(result, { volumes: 2, action: "purchases updated" });
    assert.deepEqual(store.api.saveSeriesPurchases(request), result);
    const data = store.api.getCollection();
    assert.deepEqual(
      data.books
        .slice(0, 2)
        .map(({ date, price, source }) => ({ date, price, source })),
      [
        { date: "2026-10-15", price: 0, source: "New shop" },
        { date: "", price: "", source: "" },
      ],
    );
    for (let index = 0; index < 2; index++) {
      const { date, price, source, token, ...original } = before[index];
      const {
        date: d,
        price: p,
        source: s,
        token: t,
        ...saved
      } = data.books[index];
      assert.deepEqual(saved, original);
      assert.notEqual(t, token);
    }
    assert.deepEqual(data.books.slice(2), before.slice(2));
    assert.ok(data.options.source.includes("New shop"));
    assert.deepEqual(store.exportData().books, data.books);
  } finally {
    store.close();
  }
});

test("invalid, repeated or cross-series changes roll back the entire purchase save", () => {
  const store = openStore(":memory:");
  try {
    const before = seed(store);
    for (const [patch, message] of [
      [{ price: "-1" }, /non-negative/],
      [{ price: "Infinity" }, /non-negative/],
      [{ date: "2026-02-30" }, /valid date/],
      [{ source: "x".repeat(501) }, /too long/],
      [{ row: before[0].row, token: before[0].token }, /only once/],
      [{ row: before[3].row, token: before[3].token }, /same series/],
    ]) {
      const request = edit(before);
      Object.assign(request.changes[1], patch);
      assert.throws(() => store.api.saveSeriesPurchases(request), message);
      assert.deepEqual(store.api.getCollection().books, before);
      assert.equal(
        store.api.getCollection().options.source.includes("New shop"),
        false,
      );
    }
  } finally {
    store.close();
  }
});

test("stale and removed volumes cannot overwrite newer changes or partially save other rows", () => {
  const store = openStore(":memory:");
  try {
    const before = seed(store);
    const request = edit(before);
    store.api.saveBook({
      requestId: id(),
      row: before[1].row,
      token: before[1].token,
      book: { ...before[1], note: "Edited elsewhere" },
      allowDuplicate: true,
    });
    assert.throws(() => store.api.saveSeriesPurchases(request), /book changed/);
    const current = store.api.getCollection().books;
    assert.deepEqual(current[0], before[0]);
    assert.equal(current[1].note, "Edited elsewhere");
    const removal = edit(current);
    store.api.removeBook({
      requestId: id(),
      row: current[1].row,
      token: current[1].token,
    });
    assert.throws(() => store.api.saveSeriesPurchases(removal), /book changed/);
    assert.deepEqual(store.api.getCollection().books[0], before[0]);
  } finally {
    store.close();
  }
});
