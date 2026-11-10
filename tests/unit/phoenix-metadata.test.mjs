import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phoenixBook } from "../../lib/domain/phoenix.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { createScraperRegistry } from "../../lib/server/scrapers/registry.ts";
import { phoenix } from "../../lib/server/scrapers/phoenix.ts";

const isbn = "9786164648357";
const url = "https://www.phoenixnext.com/mgm0098-01.html";
const cover =
  "https://www.phoenixnext.com/media/catalog/product/_/m/_mg_kyo_wa_kanojo_ga_inai_kara_vol1_jacket_1_.jpg";
const html = readFileSync(
  new URL(
    "../fixtures/publishers/phoenix-kyo-wa-product.html",
    import.meta.url,
  ),
  "utf8",
);
const thumbnail = cover.replace(
  "/product/",
  "/product/cache/6517c62f5899ad6aa0ba23ceb3eeff97/",
);
function memoryStore() {
  const values = new Map();
  return {
    cache: {
      get: (key) => values.get(key) ?? null,
      put: (key, value) => {
        values.set(key, value);
      },
    },
  };
}

test("Phoenix's Hyvä main-product old price supplies MSRP without borrowing recommendations", () => {
  const book = phoenixBook(html, isbn, url);
  assert.equal(book.msrp, 175);
  assert.equal(book.msrpCurrency, "THB");
  assert.equal(book.price, 166.25);
  assert.equal(book.coverUrl, cover);
  const noListPrice = html.replace(
    '<div class="old-price ml-2 md:ml-4 flex">',
    '<div class="not-a-list-price">',
  );
  assert.equal(phoenixBook(noListPrice, isbn, url).msrp, "");
  assert.equal(
    phoenixBook(html.replace("฿175.00", "฿1,750.50"), isbn, url).msrp,
    1750.5,
  );
});

test("permanent Phoenix source, product, search and aggregate snapshots are repaired offline", async () => {
  const store = memoryStore();
  const context = createScraperContext(
    store.cache,
    () => assert.fail("Reparse pinned HTML without fetching"),
    [phoenix],
  );
  const book = {
    ...phoenixBook(html, isbn, url),
    coverUrl: thumbnail,
    msrp: "",
    checkedAt: "2026-01-01T00:00:00.000Z",
  };
  await context.scrapeCache.remember("text:" + url, html, 1, true);
  for (const [source, value] of [
    ["source-book:v1:phoenix:" + isbn, book],
    ["source-product:v1:phoenix:" + url, book],
    ["source-search:v1:phoenix:" + isbn, { items: [book], warnings: [] }],
  ])
    await context.scrapeCache.remember(source, value, 1, true);
  const source = createScraperRegistry(context, [phoenix]).get("phoenix");
  const aggregate = {
    isbn,
    found: true,
    details: book,
    warnings: [],
    checkedAt: book.checkedAt,
  };
  await store.cache.put(
    "isbn:v15:" + isbn,
    JSON.stringify(aggregate),
    Infinity,
  );
  const lookup = await createCatalogService(
    store,
    () => assert.fail("No remote requests"),
    [phoenix],
  ).lookupIsbn(isbn);
  for (const repaired of [
    lookup.details,
    await source.lookupIsbn(isbn),
    await source.bookDetails(url),
    (await source.searchIsbn(isbn)).items[0],
  ]) {
    assert.equal(repaired.coverUrl, cover);
    assert.equal(repaired.msrp, 175);
    assert.equal(repaired.checkedAt, book.checkedAt);
  }
  assert.equal(lookup.checkedAt, book.checkedAt);
  assert.equal(
    JSON.parse(await store.cache.get("isbn:v15:" + isbn)).details.coverUrl,
    thumbnail,
    "Reading corrections does not overwrite cache history",
  );
});

test("Phoenix cache repair cannot borrow an ISBN's price and preserves an existing MSRP", async () => {
  const store = memoryStore();
  const context = createScraperContext(
    store.cache,
    () => assert.fail("No fetch"),
    [phoenix],
  );
  await context.scrapeCache.remember("text:" + url, html, 1, true);
  const source = createScraperRegistry(context, [phoenix]).get("phoenix");
  const book = {
    ...phoenixBook(html, isbn, url),
    coverUrl: thumbnail,
    msrp: "",
  };
  assert.equal(
    (await source.reparseBook({ ...book, isbn: "9786166247404" })).msrp,
    "",
  );
  assert.equal((await source.reparseBook({ ...book, msrp: 200 })).msrp, 200);
});
