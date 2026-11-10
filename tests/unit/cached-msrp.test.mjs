import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_CRAWLER,
  CATALOG_MSRP,
  createCatalogService,
} from "../../lib/server/catalogs.ts";
import { createScrapeCache } from "../../lib/server/scrape-cache.ts";

const isbn = "9786164648357";
const otherIsbn = "9786166247275";
const url = "https://www.phoenixnext.com/mgm0098-01.html";
const book = {
  isbn,
  title: "Publisher title",
  url,
  msrp: 175,
  currency: "THB",
};
const aggregate = {
  isbn,
  found: true,
  details: { isbn, title: "Preferred title", price: 166.25, msrp: "" },
  warnings: [],
  checkedAt: "2026-01-01T00:00:00.000Z",
};
function setup() {
  const values = new Map();
  const store = {
    cache: {
      get: (key) => values.get(key) ?? null,
      put: (key, value) => values.set(key, value),
    },
  };
  const source = {
    id: "phoenix",
    hosts: ["www.phoenixnext.com"],
    create: () => ({
      lookupIsbn: () => assert.fail("Must reuse local metadata"),
      searchIsbn: () => assert.fail("Must reuse local search snapshots"),
      bookDetails: async () => ({ ...book, isbnVerified: true }),
    }),
  };
  const catalogs = createCatalogService(
    store,
    () => assert.fail("No remote requests"),
    [source],
  );
  return { store, catalogs, cache: createScrapeCache(store.cache) };
}

test("a permanent aggregate picks up MSRP discovered later without replacing preferred metadata", async () => {
  const { store, catalogs, cache } = setup();
  await store.cache.put("isbn:v15:" + isbn, JSON.stringify(aggregate));
  await cache.remember("source-book:v1:phoenix:" + isbn, book, 86400, true);
  const result = await catalogs.lookupIsbn(isbn);
  assert.equal(result.details.msrp, 175);
  assert.equal(result.details.msrpCurrency, "THB");
  assert.equal(result.details.title, aggregate.details.title);
  assert.equal(result.details.price, 166.25);
  assert.equal(result.checkedAt, aggregate.checkedAt);
  assert.equal(
    JSON.parse(await store.cache.get("isbn:v15:" + isbn)).details.msrp,
    "",
    "Cache history is not rewritten by a read",
  );
});

test("cached verified ISBN searches can supply MSRP, including zero", async () => {
  const { catalogs, cache } = setup();
  await cache.remember(
    "source-search:v1:phoenix:" + isbn,
    { items: [{ ...book, msrp: 0 }], warnings: [] },
    86400,
    true,
  );
  assert.deepEqual(await catalogs[CATALOG_MSRP](isbn), {
    msrp: 0,
    msrpCurrency: "THB",
  });
});

test("cached MSRP excludes mismatched ISBNs, sets, untrusted sources and sale-only prices", async () => {
  for (const change of [
    { isbn: otherIsbn },
    { special: true },
    { bundle: true },
    { url: "https://untrusted.example/book" },
    { url: "https://user@www.phoenixnext.com/book" },
    { msrp: "", price: 166.25, regularPrice: 175 },
    { msrp: -1 },
    { msrp: "NaN" },
    { msrpCurrency: "not a currency" },
  ]) {
    const { catalogs, cache } = setup();
    await cache.remember(
      "source-book:v1:phoenix:" + isbn,
      { ...book, ...change },
      86400,
      true,
    );
    assert.equal(
      await catalogs[CATALOG_MSRP](isbn),
      null,
      JSON.stringify(change),
    );
  }
});

test("an existing aggregate MSRP is preserved rather than replaced by another source", async () => {
  const { store, catalogs, cache } = setup();
  for (const msrp of [0, 200]) {
    await store.cache.put(
      "isbn:v15:" + isbn,
      JSON.stringify({ ...aggregate, details: { ...aggregate.details, msrp } }),
    );
    await cache.remember("source-book:v1:phoenix:" + isbn, book, 86400, true);
    assert.equal((await catalogs.lookupIsbn(isbn)).details.msrp, msrp);
    assert.equal((await catalogs[CATALOG_MSRP](isbn)).msrp, msrp);
  }
});

test("publisher warm-up retains richer aggregates but exposes a newly verified list price", async () => {
  const { store, catalogs } = setup();
  await store.cache.put("isbn:v15:" + isbn, JSON.stringify(aggregate));
  await catalogs[CATALOG_CRAWLER].warm("phoenix", { url, isbn });
  assert.equal((await catalogs.lookupIsbn(isbn)).details.msrp, 175);
  assert.equal(
    (await catalogs.lookupIsbn(isbn)).details.title,
    "Preferred title",
  );
});

test("publisher warm-up can use a verified product ISBN when its listing omits it", async () => {
  const { store, catalogs } = setup();
  await catalogs[CATALOG_CRAWLER].warm("phoenix", { url, isbn: "" });
  assert.equal(
    JSON.parse(await store.cache.get("isbn:v15:" + isbn)).found,
    true,
  );
  assert.equal((await catalogs.lookupIsbn(isbn)).details.msrp, 175);
  const mismatch = setup();
  await mismatch.catalogs[CATALOG_CRAWLER].warm("phoenix", {
    url,
    isbn: otherIsbn,
  });
  assert.equal(await mismatch.store.cache.get("isbn:v15:" + otherIsbn), null);
});
