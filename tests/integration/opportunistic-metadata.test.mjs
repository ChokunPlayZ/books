import test from "node:test";
import assert from "node:assert/strict";
import { openTestStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import {
  CATALOG_CRAWLER,
  createCatalogService,
} from "../../lib/server/catalogs.ts";
import { createSearchService } from "../../lib/server/search.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { createScraperRegistry } from "../../lib/server/scrapers/registry.ts";

const isbn = "9786164648357";
const otherIsbn = "9786166247275";
const url = "https://www.phoenixnext.com/mgm0098-01.html";
const coverUrl = "https://www.phoenixnext.com/media/catalog/product/public.jpg";
const book = {
  isbn,
  series: "My shelf name",
  publisher: "Phoenix",
  volume: 1,
  type: "Manga",
  price: 123,
  source: "My shop",
  status: "Read",
  note: "Keep this private",
  date: "2026-11-01",
};
const details = {
  publisherId: "phoenix",
  isbn,
  isbnVerified: true,
  title: "Public title",
  series: "Public series",
  publisher: "Phoenix Next",
  volume: 1,
  type: "Manga",
  url,
  coverUrl,
  msrp: 175,
  msrpCurrency: "THB",
  pageCount: 192,
  price: 166.25,
};
const save = (store, overrides = {}) =>
  store.api.saveBook({
    requestId: crypto.randomUUID(),
    book: { ...book, ...overrides },
    allowDuplicate: true,
  });
const noNetwork = () => assert.fail("No extra network requests");
const definition = (methods) => ({
  id: "phoenix",
  hosts: ["www.phoenixnext.com"],
  titleLanguages: ["en", "th"],
  create: () => methods,
});

test("unrelated release checks immediately save missing metadata on every matching owned copy", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  await save(store);
  await save(store);
  await save(store, {
    msrp: 0,
    msrpCurrency: "THB",
    pageCount: 999,
    publisherUrl: "https://www.phoenixnext.com/manual.html",
  });
  await save(store, { isbn: otherIsbn });
  await save(store, { isbn: "" });
  const removed = await save(store);
  const snapshot = (await store.api.getCollection()).books.find(
    (b) => b.row === removed.row,
  );
  await store.api.removeBook({ ...snapshot, requestId: crypto.randomUUID() });
  const user = await createAccount(store, "reader", "reader@gmail.com");
  await store.forUser(user, () => save(store));

  const catalogs = createCatalogService(store, noNetwork, [
    definition({ releases: async () => [details] }),
  ]);
  await catalogs.getPublisherReleases({ publisherId: "phoenix" });
  const books = (await store.api.getCollection()).books;
  for (const copy of books.slice(0, 2)) {
    assert.equal(copy.msrp, 175);
    assert.equal(copy.msrpCurrency, "THB");
    assert.equal(copy.pageCount, 192);
    assert.equal(copy.publisherUrl, url);
    for (const key of Object.keys(book))
      assert.equal(copy[key], book[key], key);
    assert.equal(
      copy.coverUrl,
      "",
      "Scraped covers stay automatic rather than becoming manual choices",
    );
  }
  assert.equal(books[2].msrp, 0);
  assert.equal(books[2].pageCount, 999);
  assert.equal(
    books[2].publisherUrl,
    "https://www.phoenixnext.com/manual.html",
  );
  assert.equal(books[3].msrp, "");
  assert.equal(books[4].msrp, "");
  assert.equal((await store.api.getCollection()).trash[0].book.msrp, "");
  await store.forUser(user, async () =>
    assert.equal((await store.api.getCollection()).books[0].msrp, ""),
  );

  const learned = JSON.parse(await store.cache.get("book-metadata:v1:" + isbn));
  assert.equal(learned.msrp, 175);
  for (const field of [
    "note",
    "status",
    "price",
    "date",
    "catalogSeries",
    "coverId",
  ])
    assert.equal(Object.hasOwn(learned, field), false, field);
  assert.equal(await store.cache.get("cover:isbn:v1:" + isbn), coverUrl);
  const before = books.map((b) => b.token);
  // A cached feed still triggers ingestion for copies added since it was fetched.
  await save(store);
  await catalogs.getPublisherReleases({ publisherId: "phoenix" });
  const after = (await store.api.getCollection()).books;
  assert.deepEqual(
    after.slice(0, before.length).map((b) => b.token),
    before,
  );
  assert.equal(after.at(-1).msrp, 175);
});

test("title searches reuse a verified product association to save a newly encountered list price", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  await save(store);
  await store.cache.put("known-product:v1:" + url, isbn, Infinity);
  const source = definition({
    searchTitles: async () => ({
      items: [{ title: "Public title", url, msrp: 175, msrpCurrency: "THB" }],
      complete: true,
    }),
  });
  const search = createSearchService(store, {}, noNetwork, [source]);
  await search.searchExternalTitles({
    query: "Unrelated browsing",
    sourceId: "phoenix",
  });
  assert.equal((await store.api.getCollection()).books[0].msrp, 175);
});

test("unverified candidates, conflicting ISBNs, bundles and sale-only prices never supply MSRP", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  await save(store);
  const source = definition({
    releases: async () => [
      { ...details, isbnVerified: false },
      { ...details, isbn: otherIsbn },
      { ...details, bundle: true },
      { ...details, special: true },
      { ...details, variantGroup: true },
      { ...details, url: "https://untrusted.example/book" },
      { ...details, msrp: "", regularPrice: 175, price: 166.25 },
    ],
  });
  await createCatalogService(store, noNetwork, [source]).getPublisherReleases({
    publisherId: "phoenix",
  });
  assert.equal((await store.api.getCollection()).books[0].msrp, "");
});

test("publisher warm-up and cached galleries ingest independently of the task result fields", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  await save(store);
  const source = definition({
    bookDetails: async () => details,
    gallery: async () => [{ ...details, msrp: 0 }],
  });
  const catalogs = createCatalogService(store, noNetwork, [source]);
  await catalogs[CATALOG_CRAWLER].warm("phoenix", { url, isbn: "" });
  assert.equal((await store.api.getCollection()).books[0].msrp, 175);
  const registry = createScraperRegistry(
    createScraperContext(store.cache, noNetwork, [source]),
    [source],
    store.ingestScrapedMetadata,
  );
  await save(store, { msrp: "" });
  await registry.get("phoenix").gallery({ title: "Public title", url }, book);
  assert.equal((await store.api.getCollection()).books.at(-1).msrp, 0);
});

test("concurrent source encounters merge missing public fields durably without clobbering copy edits", async (t) => {
  const key = crypto.randomUUID();
  const first = await openTestStore(key);
  const second = await openTestStore(key);
  t.after(async () => {
    await first.close();
    await second.close();
  });
  await save(first, { msrp: 200, msrpCurrency: "THB" });
  await Promise.all([
    first.ingestScrapedMetadata([{ ...details, pageCount: "" }]),
    second.ingestScrapedMetadata([
      {
        ...details,
        msrp: "",
        note: "Untrusted extra",
        catalogSeries: "Private alias",
      },
    ]),
  ]);
  const learned = JSON.parse(await first.cache.get("book-metadata:v1:" + isbn));
  assert.equal(learned.msrp, 175);
  assert.equal(learned.pageCount, 192);
  assert.equal(learned.note, undefined);
  const copy = (await first.api.getCollection()).books[0];
  assert.equal(copy.msrp, 200);
  assert.equal(copy.pageCount, 192);
  assert.equal(copy.note, book.note);
  // Existing preferred lookup history remains intact; the read is enriched.
  await first.cache.put(
    "isbn:v15:" + isbn,
    JSON.stringify({
      isbn,
      found: true,
      details: { isbn, title: "Preferred title", msrp: "" },
      warnings: [],
    }),
    Infinity,
  );
  const lookup = await createCatalogService(second, noNetwork, []).lookupIsbn(
    isbn,
  );
  assert.equal(lookup.details.title, "Preferred title");
  assert.equal(lookup.details.msrp, 175);
  assert.equal(lookup.details.pageCount, 192);
});

test("metadata encountered before an unrelated task fails is still saved", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  await save(store);
  const source = definition({ bookDetails: async () => details });
  const registry = createScraperRegistry(
    createScraperContext(store.cache, noNetwork, [source]),
    [source],
    store.ingestScrapedMetadata,
  );
  await assert.rejects(
    store.deferMetadataFill(async () => {
      await registry.get("phoenix").bookDetails(url);
      throw new Error("A different part of the task failed");
    }),
    /different part/,
  );
  assert.equal((await store.api.getCollection()).books[0].msrp, 175);
  assert.equal(
    JSON.parse(await store.cache.get("book-metadata:v1:" + isbn)).pageCount,
    192,
  );
});
