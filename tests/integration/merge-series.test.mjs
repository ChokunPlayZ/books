import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../../lib/server/store.ts";

const target = "ต้องทำยังไงถึงจะได้เป็นหวานใจเพื่อนวัยเด็ก!?";
const source = "ต้องทำยังไงถึงได้เป็นหวานใจเพื่อนวัยเด็ก!?";
const base = {
  series: target,
  type: "Manga (TH)",
  publisher: "Phoenix Next",
  status: "Read",
  volume: 1,
  isbn: "9780140328721",
  source: "Shop",
  price: 90,
  date: "2026-10-01",
  note: "Keep this note",
  coverUrl: "https://www.phoenixnext.com/media/catalog/product/cover.jpg",
  publisherUrl: "https://www.phoenixnext.com/story-01.html",
};
function add(store, book) {
  store.api.saveBook({
    requestId: randomUUID(),
    allowDuplicate: true,
    book: { ...base, ...book },
  });
}
function seed(store) {
  add(store, {});
  add(store, { series: source, volume: 2, status: "Sealed", price: "" });
  add(store, { series: source, volume: 1, type: "LN (TH)", price: 0 });
  add(store, { series: "Unrelated" });
}
function request(store, names = [target, source]) {
  return {
    requestId: randomUUID(),
    series: target,
    titles: store.api
      .getCollection()
      .titles.filter((title) => names.includes(title.series)),
  };
}
function catalog(store, series, type, suffix) {
  return store.api.setSeriesCatalog({
    series,
    publisherId: "phoenix",
    type,
    url: `https://www.phoenixnext.com/book-series/${suffix}.html`,
  });
}

test("merging keeps every copy and its details, destination catalog choices and other editions; retries are idempotent", () => {
  const store = openStore(":memory:");
  try {
    seed(store);
    const image = store.covers.put({
      contentType: "image/png",
      body: Buffer.from("cover"),
    });
    const first = store.api.getCollection().books[1];
    store.covers.assign(first.row, image.id, first.token);
    const kept = catalog(store, target, "Manga (TH)", "kept");
    catalog(store, source, "Manga (TH)", "other");
    const novel = catalog(store, source, "LN (TH)", "novel");
    const before = store.api.getCollection();
    const merge = request(store);
    const result = { series: target, volumes: 3, merged: 2 };
    assert.deepEqual(store.api.mergeSeries(merge), result);
    assert.deepEqual(store.api.mergeSeries(merge), result);
    const after = store.api.getCollection();
    assert.equal(after.books.length, 4);
    assert.equal(after.titles.length, 2);
    for (let index = 0; index < before.books.length; index++) {
      const { series, token, ...details } = after.books[index];
      const {
        series: oldSeries,
        token: oldToken,
        ...oldDetails
      } = before.books[index];
      assert.deepEqual(details, oldDetails);
      assert.equal(series, index < 3 ? target : "Unrelated");
      if (oldSeries === source) assert.notEqual(token, oldToken);
    }
    assert.deepEqual(after.seriesCatalogs, [
      kept,
      { ...novel, series: target },
    ]);
    assert.ok(!after.options.series.includes(source));
    assert.deepEqual(store.exportData().books, after.books);
    assert.throws(
      () => store.api.mergeSeries({ ...merge, series: source }),
      /different change/,
    );
  } finally {
    store.close();
  }
});

test("merges reject edits, additions and removals made since the preview, without partial updates", () => {
  for (const change of ["edit", "add", "remove"]) {
    const store = openStore(":memory:");
    try {
      seed(store);
      const merge = request(store);
      const book = store.api.getCollection().books[1];
      if (change === "edit")
        store.api.saveBook({
          requestId: randomUUID(),
          allowDuplicate: true,
          row: book.row,
          token: book.token,
          book: { ...book, note: "Changed elsewhere" },
        });
      if (change === "add") add(store, { series: source, volume: 3 });
      if (change === "remove")
        store.api.removeBook({
          requestId: randomUUID(),
          row: book.row,
          token: book.token,
        });
      const before = store.api.getCollection();
      assert.throws(
        () => store.api.mergeSeries(merge),
        /selected series changed/,
      );
      assert.deepEqual(store.api.getCollection(), before);
    } finally {
      store.close();
    }
  }
});

test("invalid merges and transaction failures preserve books, catalog links and series options", () => {
  const store = openStore(":memory:");
  try {
    seed(store);
    catalog(store, source, "Manga (TH)", "other");
    const before = store.api.getCollection();
    const merge = request(store);
    for (const extra of [
      { titles: [] },
      { titles: merge.titles.slice(0, 1) },
      { titles: [merge.titles[0], merge.titles[0]] },
      { titles: [merge.titles[0], null] },
      { series: "Unrelated" },
      { series: "" },
      { series: null },
    ]) {
      assert.throws(() => store.api.mergeSeries({ ...merge, ...extra }));
      assert.deepEqual(store.api.getCollection(), before);
    }
    store.db.exec(
      "CREATE TRIGGER fail_merge_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'simulated failure'); END;",
    );
    assert.throws(() => store.api.mergeSeries(merge), /simulated failure/);
    assert.deepEqual(store.api.getCollection(), before);
  } finally {
    store.close();
  }
});

test("punctuation variants share catalog keys safely; removed books and unselected variants stay separate", () => {
  const store = openStore(":memory:");
  try {
    for (const series of ["Story!", "Story?", "Story.", "Other"])
      add(store, { series });
    add(store, { series: "Story?", volume: 2 });
    const removed = store.api.getCollection().books.at(-1);
    store.api.removeBook({ requestId: randomUUID(), ...removed });
    catalog(store, "Story?", "Manga (TH)", "story");
    const beforeTrash = store.api.getCollection().trash;
    const merge = request(store, ["Story!", "Story?"]);
    merge.series = "Story!";
    store.api.mergeSeries(merge);
    const after = store.api.getCollection();
    assert.deepEqual(
      after.books.map((book) => book.series),
      ["Story!", "Story!", "Story.", "Other"],
    );
    assert.deepEqual(after.trash, beforeTrash);
    assert.equal(after.seriesCatalogs.length, 1);
    assert.equal(after.seriesCatalogs[0].series, "Story!");
    assert.ok(after.options.series.includes("Story?"));
  } finally {
    store.close();
  }
});
