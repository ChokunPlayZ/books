import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { releaseItem } from "../../lib/domain.ts";

test("library and series downloads include only this owner's active books and personal fields", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const alice = await createAccount(
    store,
    "export-alice",
    "export-alice@gmail.com",
  );
  const bob = await createAccount(store, "export-bob", "export-bob@gmail.com");
  const restored = await createAccount(
    store,
    "export-restored",
    "export-restored@gmail.com",
  );
  const book = {
    isbn: "9780316769488",
    series: "My personal title",
    type: "Manga",
    edition: "TH",
    publisher: "Phoenix Next",
    status: "Reading",
    volume: 1.5,
    source: "My private shop",
    price: 0,
    date: "2026-11-01",
    note: "A personal gift",
    coverUrl: "https://www.phoenixnext.com/media/catalog/product/example.jpg",
    publisherUrl: "https://www.phoenixnext.com/example.html",
    pageCount: 208,
    msrp: 175,
    msrpCurrency: "THB",
  };
  let exported;
  await store.forUser(alice, async () => {
    const save = (value) =>
      store.api.saveBook({
        requestId: randomUUID(),
        book: value,
        allowDuplicate: true,
      });
    await save(book);
    await save({ ...book, price: "" });
    await save({ ...book, series: "Another title" });
    await save({ ...book, series: "Removed title" });
    const removed = (await store.api.getCollection()).books.at(-1);
    await store.api.removeBook({ ...removed, requestId: randomUUID() });
    await store.api.setSavedRelease({
      saved: true,
      release: releaseItem(
        "phoenix",
        "Saved title เล่ม 2",
        "https://www.phoenixnext.com/saved.html",
        175,
        "",
        "Manga",
      ),
    });
    await store.cache.put(
      "isbn:v15:9780316769488",
      "Shared scraped content",
      Infinity,
    );
    exported = await store.exportLibrary();
    assert.deepEqual(Object.keys(exported).sort(), [
      "books",
      "format",
      "version",
    ]);
    assert.equal(exported.books.length, 3);
    assert.equal(exported.books[0].title, book.series);
    assert.equal(exported.books[0].source, book.source);
    assert.equal(exported.books[0].price, 0);
    assert.equal(exported.books[1].price, "");
    const series = await store.exportLibrary(book.series);
    assert.equal(series.books.length, 2);
    assert.ok(series.books.every((entry) => entry.title === book.series));
    await assert.rejects(store.exportLibrary("Missing"), { status: 404 });
    const text = JSON.stringify(exported);
    for (const omitted of [
      "coverUrl",
      "coverId",
      "publisher",
      "pageCount",
      "msrp",
      "token",
      "row",
      "Shared scraped content",
      "Removed title",
      "Saved title",
    ])
      assert.ok(!text.includes(omitted), omitted);
    const backup = await store.exportData();
    assert.equal(backup.trash.length, 1);
    assert.equal(backup.savedReleases.length, 1);
    assert.equal(
      backup.books[0].pageCount,
      208,
      "full server backups remain intact",
    );
  });
  await store.forUser(bob, async () => {
    assert.deepEqual((await store.exportLibrary()).books, []);
    await assert.rejects(store.exportLibrary(book.series), { status: 404 });
  });
  await store.forUser(restored, async () => {
    const plan = parseImport(
      Buffer.from(JSON.stringify(exported)),
      "library.json",
    );
    await store.importData(plan, plan.fingerprint);
    assert.deepEqual(await store.exportLibrary(), exported);
  });
});
