import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstPageBook } from "../../lib/domain/firstpage.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { openStore } from "../../lib/server/store.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const isbn = "9786164897397";
const url = "https://www.firstpagepro.com/product/1085";
const product = fixture("firstpage-isbn-product.html");
const search = fixture("firstpage-isbn-search.html");
const empty = '<span class="tsk-all">0</span>';
function database(t) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  return store;
}
function remote(calls, overrides = {}) {
  return async (address) => {
    calls.push(address);
    if (address.includes("dexpress-shop.com/search"))
      return new Response(fixture("dexpress-empty.html"));
    if (address.includes("animagshop.com/search"))
      return new Response(fixture("animag-empty.html"));
    if (address.includes("naiin.com"))
      return new Response('<product-list :items="[]">');
    if (address.includes("yaakz.com"))
      return new Response('{"data":[],"total":0}');
    if (address.includes("firstpagepro.com/search"))
      return new Response(overrides.search ?? search, {
        status: overrides.searchStatus ?? 200,
      });
    if (address.includes("firstpagepro.com/product"))
      return new Response(overrides.product ?? product, {
        status: overrides.productStatus ?? 200,
      });
    if (address.includes("phoenixnext.com/catalogsearch"))
      return new Response('<div class="message info empty">Empty</div>');
    if (address === "https://yenpress.com/search")
      return new Response(fixture("yenpress-search.html"));
    if (address.includes("enterprise-search.yenpress.com"))
      return new Response('{"results":[]}');
    if (address.includes("kinokuniya.co.th"))
      return new Response("Not found", { status: 404 });
    if (address.includes("googleapis.com"))
      return new Response(JSON.stringify(overrides.google ?? {}));
    if (address.includes("openlibrary.org")) return new Response("{}");
    assert.fail("Unexpected source: " + address);
  };
}

test("First Page Pro reads the product SKU as an ISBN with the correct title, format, volume and cover", () => {
  const book = firstPageBook(product, isbn, url);
  assert.equal(book.isbn, isbn);
  assert.equal(book.publisher, "First Page Pro");
  assert.equal(book.source, "First Page Pro");
  assert.equal(book.volume, 3);
  assert.equal(book.type, "Manga (TH)");
  assert.equal(book.price, 180);
  assert.equal(book.url, url);
  assert.equal(book.coverUrl, "https://cj.lnwfile.com/_/cj/_raw/xi/w2/dm.jpg");
  assert.ok(!book.series.startsWith("การ์ตูน "));
  assert.equal(
    firstPageBook(product.replace("การ์ตูน ", "นิยาย "), isbn, url).type,
    "LN (TH)",
  );
  assert.equal(firstPageBook(product, "9780140328721", url), null);
  assert.equal(
    firstPageBook(product, isbn, "https://evil.test/product/1085"),
    null,
  );
  const recommendation = product.replace("/product/1085/", "/product/1084/");
  assert.throws(() => firstPageBook(recommendation, isbn, url), /ISBN details/);
  assert.equal(
    firstPageBook(
      product.replace(isbn, "9780140328721") + recommendation,
      isbn,
      url,
    ),
    null,
    "A recommendation's matching ISBN must not verify the main product",
  );
  assert.throws(
    () => firstPageBook(product.replace(isbn, "SHOP-1085"), isbn, url),
    /ISBN details/,
  );
});

test("scan lookup uses verified First Page Pro metadata, bypasses old misses and shares durable requests", async (t) => {
  const store = database(t),
    calls = [];
  store.cache.put("isbn:v5:" + isbn, JSON.stringify({ found: false }), 86400);
  store.cache.put("cover:miss:v3:" + isbn, "1", 86400);
  store.api.saveBook({
    requestId: "firstpage_auto_cover_1",
    book: {
      series: "First Page book",
      publisher: "First Page Pro",
      isbn,
      type: "Manga (TH)",
      status: "Read",
    },
  });
  const service = createCatalogService(store, remote(calls));
  const results = await Promise.all([
    service.lookupIsbn(isbn),
    service.lookupIsbn("ISBN: 978-616-489-739-7"),
  ]);
  assert.ok(
    results.every((result) => result.found && result.details?.isbn === isbn),
  );
  assert.deepEqual(results[0].warnings, []);
  assert.equal(results[0].details.source, "First Page Pro");
  assert.equal(calls.filter((address) => address === url).length, 1);
  assert.equal(
    calls.filter((address) => address.includes("firstpagepro.com/search"))
      .length,
    1,
  );
  for (const source of ["yenpress", "kinokuniya", "googleapis", "openlibrary"])
    assert.ok(calls.some((address) => address.includes(source)));
  assert.equal(
    (await service.getBookCover({ row: 1 })).coverUrl,
    results[0].details.coverUrl,
  );
  const offline = createCatalogService(store, () =>
    assert.fail("Use cached metadata"),
  );
  assert.deepEqual(await offline.lookupIsbn(isbn), results[0]);
  assert.equal(store.api.getCollection().books.length, 1);
});

test("First Page mismatches, empty results, outages and unreadable product metadata allow verified fallbacks", async (t) => {
  for (const [overrides, warning] of [
    [{ search: empty }, false],
    [{ product: product.replace(isbn, "9780140328721") }, false],
    [{ productStatus: 503 }, true],
    [{ searchStatus: 503 }, true],
    [{ product: "<h1>Maintenance</h1>" }, true],
    [{ search: "<h1>Changed search markup</h1>" }, true],
  ]) {
    const store = database(t);
    const service = createCatalogService(
      store,
      remote([], {
        ...overrides,
        google: {
          items: [
            {
              volumeInfo: {
                title: "Verified fallback",
                industryIdentifiers: [{ identifier: isbn }],
              },
            },
          ],
        },
      }),
    );
    const result = await service.lookupIsbn(isbn);
    assert.equal(result.details.source, "Google Books");
    assert.deepEqual(
      result.warnings,
      warning ? ["First Page Pro is unavailable right now."] : [],
    );
  }
});

test("one unreadable First Page candidate cannot hide a later verified book", async (t) => {
  const store = database(t);
  const service = createCatalogService(store, async (address) => {
    if (address === url) return new Response("Unavailable", { status: 503 });
    return remote([], {
      search: search + search.replaceAll("/product/1085", "/product/1084"),
      product: product.replaceAll("/product/1085", "/product/1084"),
    })(address);
  });
  const result = await service.lookupIsbn(isbn);
  assert.equal(result.details.url, "https://www.firstpagepro.com/product/1084");
  assert.equal(result.details.isbn, isbn);
});

test("First Page outages retry after the cooldown across service restarts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = database(t),
    calls = [],
    overrides = { productStatus: 503 };
  let service = createCatalogService(store, remote(calls, overrides));
  assert.equal((await service.lookupIsbn(isbn)).found, false);
  const count = calls.length;
  service = createCatalogService(store, remote(calls, overrides));
  t.mock.timers.tick(15 * 60 * 1000 - 1);
  assert.equal((await service.lookupIsbn(isbn)).found, false);
  assert.equal(calls.length, count);
  overrides.productStatus = 200;
  t.mock.timers.tick(1);
  const recovered = await service.lookupIsbn(isbn);
  assert.equal(recovered.details.source, "First Page Pro");
  assert.deepEqual(recovered.warnings, []);
  assert.equal(calls.filter((address) => address === url).length, 2);
});
