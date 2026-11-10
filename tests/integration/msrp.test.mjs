import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openTestStore as openStore } from "../helpers/database.mjs";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { SCRAPER_SOURCES } from "../../lib/server/scrapers/registry.ts";
import { kodanshaBook } from "../../lib/domain/kodansha.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { createScrapeCache } from "../../lib/server/scrape-cache.ts";
import { createAccount } from "../../lib/server/auth.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
for (const [source, isbn, search, product, msrp, price] of [
  [
    "phoenix",
    "9786164648357",
    "phoenix-kyo-wa-search.html",
    "phoenix-kyo-wa-product.html",
    175,
    166.25,
  ],
  [
    "naiin",
    "9786166247275",
    "naiin-search.html",
    "naiin-detail.html",
    175,
    166.25,
  ],
  [
    "dexpress",
    "9786163634627",
    "dexpress-search.html",
    "dexpress-product.html",
    279,
    264,
  ],
  [
    "animag",
    "9786163377302",
    "animag-search.html",
    "animag-product.html",
    340,
    320,
  ],
]) {
  test(
    source + " scrapes MSRP separately from its discounted shop price",
    async (t) => {
      const store = await openStore();
      t.after(async () => await store.close());
      const catalogs = createCatalogService(
        store,
        async (url) =>
          new Response(fixture(/search/.test(url) ? search : product)),
        SCRAPER_SOURCES.filter((item) => item.id === source),
      );
      const result = await catalogs.lookupIsbn(isbn);
      assert.equal(result.details.msrp, msrp);
      assert.equal(result.details.msrpCurrency, "THB");
      assert.equal(result.details.price, price);
    },
  );
}

test("Japanese publisher MSRP uses the tax-inclusive list price rather than the base price", () => {
  const html = fixture("kodansha-product.html");
  const isbn =
    /name=["']books:isbn["'][^>]*content=["']([^"']+)/i.exec(html)?.[1] ||
    /content=["']([^"']+)["'][^>]*name=["']books:isbn/i.exec(html)?.[1];
  const url = /property=["']og:url["'][^>]*content=["']([^"']+)/i.exec(
    html,
  )?.[1];
  const book = kodanshaBook(html, isbn, url);
  assert.equal(book.msrp, 627);
  assert.equal(book.msrpCurrency, "JPY");
});

const savedBook = {
  isbn: "9786164648357",
  series: "My own title",
  publisher: "Phoenix",
  type: "Manga",
  volume: 1,
  status: "Read",
  source: "Personal shop",
  price: 123,
  date: "2026-11-01",
  note: "Private note",
};
const save = (store, data = {}) =>
  store.api.saveBook({
    requestId: crypto.randomUUID(),
    book: { ...savedBook, ...data },
    allowDuplicate: true,
  });

test("library reload fills blank MSRP from pinned source data without scraping or changing personal fields", async (t) => {
  const store = await openStore();
  t.after(() => store.close());
  await save(store);
  await save(store);
  await save(store, { msrp: 0, msrpCurrency: "THB" });
  await save(store, { msrp: 250, msrpCurrency: "USD" });
  const removed = await save(store);
  const snapshot = (await store.api.getCollection()).books.find(
    (book) => book.row === removed.row,
  );
  await store.api.removeBook({ ...snapshot, requestId: crypto.randomUUID() });
  await save(store, { isbn: "9786166247275" });
  await save(store, { isbn: "" });
  const user = await createAccount(store, "reader", "reader@gmail.com");
  await store.forUser(user, () => save(store));

  const cache = createScrapeCache(store.cache);
  const url = "https://www.phoenixnext.com/mgm0098-01.html";
  await cache.remember(
    "text:" + url,
    fixture("phoenix-kyo-wa-product.html"),
    1,
    true,
  );
  await cache.remember(
    "source-book:v1:phoenix:" + savedBook.isbn,
    { isbn: savedBook.isbn, title: "Public title", url, msrp: "" },
    86400,
    true,
  );
  // A preferred bookstore snapshot existed before the publisher MSRP was found.
  await store.cache.put(
    "isbn:v15:" + savedBook.isbn,
    JSON.stringify({
      isbn: savedBook.isbn,
      found: true,
      details: { isbn: savedBook.isbn, title: "Bookstore title", msrp: "" },
      warnings: [],
    }),
    Infinity,
  );
  await store.db.prepare("UPDATE scrape_queue_settings SET paused=true").run();
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("No cover download needed") },
    () => assert.fail("Library MSRP backfill must not scrape"),
  );
  const before = (await store.api.getCollection()).books;
  const collection = await api.getCollection();
  for (const index of [0, 1]) {
    const book = collection.books[index];
    assert.equal(book.msrp, 175);
    assert.equal(book.msrpCurrency, "THB");
    assert.notEqual(book.token, before[index].token);
    for (const field of Object.keys(savedBook))
      assert.equal(book[field], before[index][field], field);
  }
  assert.equal(collection.books[2].msrp, 0);
  assert.equal(collection.books[3].msrp, 250);
  assert.equal(collection.books[3].msrpCurrency, "USD");
  assert.equal(collection.books[4].msrp, "");
  assert.equal(collection.books[5].msrp, "");
  assert.equal(collection.trash[0].book.msrp, "");
  assert.deepEqual((await api.getCollection()).books, collection.books);
  assert.equal(
    (await store.api.getCollection()).books[0].msrp,
    175,
    "Persisted to the copy",
  );
  await store.forUser(user, async () => {
    assert.equal((await store.api.getCollection()).books[0].msrp, "");
    assert.equal((await api.getCollection()).books[0].msrp, 175);
  });
});

test("automatic MSRP filling skips copies edited or removed since their snapshot", async (t) => {
  const store = await openStore();
  t.after(() => store.close());
  await save(store);
  const before = (await store.api.getCollection()).books[0];
  const details = { msrp: 175, msrpCurrency: "THB" };
  await store.api.saveBook({
    row: before.row,
    token: before.token,
    requestId: crypto.randomUUID(),
    book: { ...before, note: "Changed during reload" },
  });
  assert.equal(await store.fillMissingMsrp(before, details), false);
  const edited = (await store.api.getCollection()).books[0];
  await store.api.removeBook({ ...edited, requestId: crypto.randomUUID() });
  assert.equal(await store.fillMissingMsrp(edited, details), false);
  assert.equal((await store.api.getCollection()).trash[0].book.msrp, "");
});
