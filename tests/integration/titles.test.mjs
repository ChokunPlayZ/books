import test from "node:test";
import assert from "node:assert/strict";
import { openTestStore as openStore } from "../helpers/database.mjs";

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
async function seed(store) {
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
    await store.api.saveBook({ requestId: id(), book });
  await store.api.setSeriesCatalog({
    series: base.series,
    publisherId: "phoenix",
    type: base.type,
    url: "https://www.phoenixnext.com/book-series/story.html",
  });
}
async function edit(store, series = "Renamed story") {
  const title = (await store.api.getCollection()).titles[0];
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

test("title edits update all volumes, preserve separate editions and volume details, and move catalog links", async () => {
  const store = await openStore();
  try {
    await seed(store);
    const before = (await store.api.getCollection()).books;
    const request = await edit(store);
    const result = await store.api.saveTitle(request);
    assert.deepEqual(result, {
      series: "Renamed story",
      volumes: 3,
      action: "title updated",
    });
    assert.deepEqual(await store.api.saveTitle(request), result);
    const data = await store.api.getCollection();
    data.books.forEach((book, index) => {
      assert.equal(book.series, "Renamed story");
      assert.equal(book.type, index < 2 ? "Light novel" : "Manga");
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
    assert.equal(data.seriesCatalogs[0].type, "Light novel");
    assert.ok(data.options.series.includes("Renamed story"));
    assert.notEqual(data.titles[0].token, request.token);
    const backup = await store.exportData();
    assert.deepEqual(backup.books, data.books);
  } finally {
    await store.close();
  }
});

test("title saves reject stale volume edits, additions and incomplete editions without partial updates", async () => {
  const store = await openStore();
  try {
    await seed(store);
    let request = await edit(store);
    const book = (await store.api.getCollection()).books[0];
    await store.api.saveBook({
      requestId: id(),
      row: book.row,
      token: book.token,
      book: { ...book, note: "Edited elsewhere" },
    });
    await assert.rejects(
      async () => await store.api.saveTitle(request),
      /title changed/,
    );
    assert.ok(
      (await store.api.getCollection()).books.every(
        (book) => book.series === base.series,
      ),
    );
    request = await edit(store);
    await store.api.saveBook({ requestId: id(), book: { ...base, volume: 3 } });
    await assert.rejects(
      async () => await store.api.saveTitle(request),
      /title changed/,
    );
    request = await edit(store);
    request.title.editions.pop();
    await assert.rejects(
      async () => await store.api.saveTitle(request),
      /editions changed/,
    );
    await store.db.exec(
      "CREATE FUNCTION fail_title_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$; CREATE TRIGGER fail_title_receipt BEFORE INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION fail_title_receipt();",
    );
    await assert.rejects(
      async () => await store.api.saveTitle(await edit(store)),
      /simulated failure/,
    );
    assert.ok(
      (await store.api.getCollection()).books.every(
        (book) => book.series === base.series,
      ),
    );
    assert.equal(
      (await store.api.getCollection()).seriesCatalogs[0].series,
      base.series,
    );
  } finally {
    await store.close();
  }
});

test("changing an edition publisher clears incompatible publisher links and prevents accidental title merging", async () => {
  const store = await openStore();
  try {
    await seed(store);
    await store.api.saveBook({
      requestId: id(),
      book: { ...base, series: "Other title" },
    });
    await assert.rejects(
      async () => await store.api.saveTitle(await edit(store, "OTHER TITLE")),
      /already exists/,
    );
    const request = await edit(store);
    request.title.editions[0].publisher = "Luckpim";
    await store.api.saveTitle(request);
    const data = await store.api.getCollection();
    assert.equal(data.books[0].publisherUrl, "");
    assert.equal(data.books[1].publisherUrl, "");
    assert.equal(data.books[2].publisher, "Japanese press");
    assert.equal(data.seriesCatalogs.length, 0);
    assert.equal(data.books[3].series, "Other title");
  } finally {
    await store.close();
  }
});
