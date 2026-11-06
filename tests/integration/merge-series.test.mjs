import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore as openStore } from "../helpers/database.mjs";

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
async function add(store, book) {
  await store.api.saveBook({
    requestId: randomUUID(),
    allowDuplicate: true,
    book: { ...base, ...book },
  });
}
async function seed(store) {
  await add(store, {});
  await add(store, { series: source, volume: 2, status: "Sealed", price: "" });
  await add(store, { series: source, volume: 1, type: "LN (TH)", price: 0 });
  await add(store, { series: "Unrelated" });
}
async function request(store, names = [target, source]) {
  return {
    requestId: randomUUID(),
    series: target,
    titles: (await store.api.getCollection()).titles.filter((title) =>
      names.includes(title.series),
    ),
  };
}
async function catalog(store, series, type, suffix) {
  return await store.api.setSeriesCatalog({
    series,
    publisherId: "phoenix",
    type,
    url: `https://www.phoenixnext.com/book-series/${suffix}.html`,
  });
}

test("merging keeps every copy and its details, destination catalog choices and other editions; retries are idempotent", async () => {
  const store = await openStore();
  try {
    await seed(store);
    const image = await store.covers.put({
      contentType: "image/png",
      body: Buffer.from("cover"),
    });
    const first = (await store.api.getCollection()).books[1];
    await store.covers.assign(first.row, image.id, first.token);
    const kept = await catalog(store, target, "Manga (TH)", "kept");
    await catalog(store, source, "Manga (TH)", "other");
    const novel = await catalog(store, source, "LN (TH)", "novel");
    const before = await store.api.getCollection();
    const merge = await request(store);
    const result = { series: target, volumes: 3, merged: 2 };
    assert.deepEqual(await store.api.mergeSeries(merge), result);
    assert.deepEqual(await store.api.mergeSeries(merge), result);
    const after = await store.api.getCollection();
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
    assert.deepEqual(
      [...after.seriesCatalogs].sort((a, b) => a.type.localeCompare(b.type)),
      [kept, { ...novel, series: target }].sort((a, b) =>
        a.type.localeCompare(b.type),
      ),
    );
    assert.ok(!after.options.series.includes(source));
    assert.deepEqual((await store.exportData()).books, after.books);
    await assert.rejects(
      async () => await store.api.mergeSeries({ ...merge, series: source }),
      /different change/,
    );
  } finally {
    await store.close();
  }
});

test("merges reject edits, additions and removals made since the preview, without partial updates", async () => {
  for (const change of ["edit", "add", "remove"]) {
    const store = await openStore();
    try {
      await seed(store);
      const merge = await request(store);
      const book = (await store.api.getCollection()).books[1];
      if (change === "edit")
        await store.api.saveBook({
          requestId: randomUUID(),
          allowDuplicate: true,
          row: book.row,
          token: book.token,
          book: { ...book, note: "Changed elsewhere" },
        });
      if (change === "add") await add(store, { series: source, volume: 3 });
      if (change === "remove")
        await store.api.removeBook({
          requestId: randomUUID(),
          row: book.row,
          token: book.token,
        });
      const before = await store.api.getCollection();
      await assert.rejects(
        async () => await store.api.mergeSeries(merge),
        /selected series changed/,
      );
      assert.deepEqual(await store.api.getCollection(), before);
    } finally {
      await store.close();
    }
  }
});

test("invalid merges and transaction failures preserve books, catalog links and series options", async () => {
  const store = await openStore();
  try {
    await seed(store);
    await catalog(store, source, "Manga (TH)", "other");
    const before = await store.api.getCollection();
    const merge = await request(store);
    for (const extra of [
      { titles: [] },
      { titles: merge.titles.slice(0, 1) },
      { titles: [merge.titles[0], merge.titles[0]] },
      { titles: [merge.titles[0], null] },
      { series: "Unrelated" },
      { series: "" },
      { series: null },
    ]) {
      await assert.rejects(
        async () => await store.api.mergeSeries({ ...merge, ...extra }),
      );
      assert.deepEqual(await store.api.getCollection(), before);
    }
    await store.db.exec(
      "CREATE FUNCTION fail_merge_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$; CREATE TRIGGER fail_merge_receipt BEFORE INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION fail_merge_receipt();",
    );
    await assert.rejects(
      async () => await store.api.mergeSeries(merge),
      /simulated failure/,
    );
    assert.deepEqual(await store.api.getCollection(), before);
  } finally {
    await store.close();
  }
});

test("punctuation variants share catalog keys safely; removed books and unselected variants stay separate", async () => {
  const store = await openStore();
  try {
    for (const series of ["Story!", "Story?", "Story.", "Other"])
      await add(store, { series });
    await add(store, { series: "Story?", volume: 2 });
    const removed = (await store.api.getCollection()).books.at(-1);
    await store.api.removeBook({ requestId: randomUUID(), ...removed });
    await catalog(store, "Story?", "Manga (TH)", "story");
    const beforeTrash = (await store.api.getCollection()).trash;
    const merge = await request(store, ["Story!", "Story?"]);
    merge.series = "Story!";
    await store.api.mergeSeries(merge);
    const after = await store.api.getCollection();
    assert.deepEqual(
      after.books.map((book) => book.series),
      ["Story!", "Story!", "Story.", "Other"],
    );
    assert.deepEqual(after.trash, beforeTrash);
    assert.equal(after.seriesCatalogs.length, 1);
    assert.equal(after.seriesCatalogs[0].series, "Story!");
    assert.ok(after.options.series.includes("Story?"));
  } finally {
    await store.close();
  }
});
