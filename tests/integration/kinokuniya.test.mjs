import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kinokuniyaBook } from "../../lib/domain/kinokuniya.ts";
import { kinokuniyaSearchUrl, safeCoverUrl } from "../../lib/domain/urls.ts";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createCoverService } from "../../lib/server/covers.ts";
import { createApplicationApi } from "../../lib/server/api.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const book = fixture("kinokuniya-book.html");
const comic = fixture("kinokuniya-comic.html");
const isbn = "9780385496490";
const productUrl = "https://kinokuniya.co.th/products/" + isbn;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
function database(t) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  return store;
}
function remote(calls, overrides = {}) {
  return async (url) => {
    calls.push(url);
    if (url.includes("naiin.com"))
      return new Response('<product-list :items="[]">');
    if (url.includes("yaakz.com")) return new Response('{"data":[],"total":0}');
    if (url.includes("firstpagepro.com/search"))
      return new Response('<span class="tsk-all">0</span>');
    if (url.includes("phoenixnext.com/catalogsearch"))
      return new Response('<div class="message info empty">Empty</div>');
    if (url === "https://yenpress.com/search")
      return new Response(fixture("yenpress-search.html"));
    if (url.includes("enterprise-search.yenpress.com"))
      return new Response('{"results":[]}');
    if (url.startsWith("https://kinokuniya.co.th/products/"))
      return new Response(overrides.product ?? book, {
        status: overrides.status ?? 200,
        headers: overrides.headers,
      });
    if (url.startsWith("https://kinokuniya.co.th/cdn/shop/"))
      return new Response(png);
    if (url.includes("googleapis.com"))
      return new Response(JSON.stringify(overrides.google ?? {}));
    if (url.includes("openlibrary.org")) return new Response("{}");
    assert.fail("Unexpected source: " + url);
  };
}

test("Kinokuniya reads the verified book, publisher, authors and cover from current storefront fixtures", () => {
  const details = kinokuniyaBook(book, isbn);
  assert.equal(details.title, "Tuesdays with Morrie");
  assert.equal(details.publisher, "Bantam Doubleday Dell");
  assert.equal(details.authors, "Albom, Mitch");
  assert.equal(details.releaseDate, "Dec 1998");
  assert.equal(details.source, "Kinokuniya");
  assert.equal(details.url, productUrl);
  assert.equal(details.volume, "");
  assert.equal(
    details.type,
    "",
    "A general book must not be guessed to be manga or a light novel",
  );
  assert.match(
    details.coverUrl,
    /^https:\/\/kinokuniya.co.th\/cdn\/shop\/files\/9780385496490-/,
  );
  const manga = kinokuniyaBook(comic, "9781975319434");
  assert.equal(manga.series, "Solo Leveling");
  assert.equal(manga.volume, 1);
  assert.equal(
    kinokuniyaBook(
      book.replace("Tuesdays with Morrie", "Story Light Novel Vol. 1"),
      isbn,
    ).type,
    "",
    "English title labels must not imply a Thai edition",
  );
  assert.equal(
    manga.publisher,
    "Yen Press",
    "The bookstore is not the book's publisher",
  );
  assert.match(manga.authors, /Chugong/);
  assert.equal(kinokuniyaBook(book, "9780140328721"), null);
  assert.equal(
    kinokuniyaBook(book.replace("9780385496490\n", "9780140328721\n"), isbn),
    null,
  );
  assert.throws(
    () => kinokuniyaBook("<h1>Maintenance</h1>", isbn),
    /ISBN unavailable/,
  );
  assert.throws(
    () => kinokuniyaBook(book.replace('"gtin"', '"otherCode"'), isbn),
    /markup changed/,
  );
  // A recommendation with a different product URL cannot fill in missing metadata.
  const recommendation = book.replaceAll(
    "products\\/9780385496490",
    "products\\/9780140328721",
  );
  assert.throws(() => kinokuniyaBook(recommendation, isbn), /markup changed/);
});

test("Kinokuniya cover hosts and search links stay bounded to the public Thailand storefront", () => {
  assert.equal(
    kinokuniyaSearchUrl("9780385496490 & manga"),
    "https://kinokuniya.co.th/search?type=product&q=9780385496490%20%26%20manga",
  );
  for (const url of [
    "https://kinokuniya.co.th.evil.test/cdn/shop/files/cover.jpg",
    "https://user:pass@kinokuniya.co.th/cdn/shop/files/cover.jpg",
    "https://kinokuniya.co.th:8080/cdn/shop/files/cover.jpg",
    "https://kinokuniya.co.th/account",
    "https://cdn.shopify.com/unverified-store.jpg",
  ])
    assert.equal(safeCoverUrl(url), "");
  assert.equal(
    safeCoverUrl("http://kinokuniya.co.th/cdn/shop/files/cover.jpg"),
    "https://kinokuniya.co.th/cdn/shop/files/cover.jpg",
  );
});

test("ISBN lookup and automatic covers use Kinokuniya before generic providers and bypass old cached misses", async (t) => {
  const store = database(t),
    calls = [];
  store.cache.put("isbn:v4:" + isbn, JSON.stringify({ found: false }), 86400);
  store.cache.put("cover:miss:v2:" + isbn, "1", 86400);
  store.api.saveBook({
    requestId: "kinokuniya_auto_cover_1",
    book: {
      series: "Tuesdays with Morrie",
      isbn,
      type: "Other",
      publisher: "Bantam Doubleday Dell",
      status: "Read",
    },
  });
  const service = createCatalogService(store, remote(calls));
  const results = await Promise.all([
    service.lookupIsbn(isbn),
    service.lookupIsbn("0385496494"),
  ]);
  assert.ok(results.every((result) => result.details?.source === "Kinokuniya"));
  assert.deepEqual(results[0].warnings, []);
  assert.equal(calls.filter((url) => url === productUrl).length, 1);
  for (const source of ["googleapis", "openlibrary"])
    assert.equal(calls.filter((url) => url.includes(source)).length, 1);
  assert.equal(
    (await service.getBookCover({ row: 1 })).coverUrl,
    results[0].details.coverUrl,
  );
  const restarted = createCatalogService(store, () =>
    assert.fail("Use durable cached metadata"),
  );
  assert.equal(
    (await restarted.lookupIsbn(isbn)).details.title,
    "Tuesdays with Morrie",
  );
});

test("wrong editions, missing books, malformed markup and redirects allow verified fallback providers", async (t) => {
  for (const [overrides, warning] of [
    [{ status: 404 }, false],
    [{ product: book.replaceAll(isbn, "9780140328721") }, false],
    [{ status: 503 }, true],
    [{ product: "<h1>Maintenance</h1>" }, true],
    [{ status: 302, headers: { location: "https://evil.test/" } }, true],
  ]) {
    const store = database(t),
      calls = [];
    const service = createCatalogService(
      store,
      remote(calls, {
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
      warning ? ["Kinokuniya is unavailable right now."] : [],
    );
    assert.ok(!calls.some((url) => url.includes("evil.test")));
  }
});

test("Kinokuniya outages retain the retry cooldown across refreshes and service restarts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = database(t),
    calls = [],
    overrides = { status: 503 };
  store.api.saveBook({
    requestId: "kinokuniya_outage_cover_1",
    book: {
      series: "Tuesdays with Morrie",
      isbn,
      type: "Other",
      publisher: "Bantam Doubleday Dell",
      status: "Read",
    },
  });
  const fetchImpl = remote(calls, overrides);
  let service = createCatalogService(store, fetchImpl);
  assert.equal((await service.lookupIsbn(isbn)).found, false);
  service = createCatalogService(store, fetchImpl);
  await service.getBookCoverOptions({ row: 1, refresh: true });
  assert.equal(calls.filter((url) => url === productUrl).length, 1);
  overrides.status = 200;
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal((await service.lookupIsbn(isbn)).details.source, "Kinokuniya");
  assert.equal(calls.filter((url) => url === productUrl).length, 2);
});

test("Kinokuniya cover choices are stored, preserve the publisher link and can be reused offline", async (t) => {
  const store = database(t),
    calls = [],
    fetchImpl = remote(calls);
  const covers = createCoverService(store, { fetchImpl });
  const api = createApplicationApi(store, covers, fetchImpl);
  const publisherUrl = "https://publisher.example/book";
  store.api.saveBook({
    requestId: "kinokuniya_stored_cover_1",
    book: {
      series: "Tuesdays with Morrie",
      isbn,
      type: "Other",
      publisher: "Bantam Doubleday Dell",
      publisherUrl,
      status: "Read",
    },
  });
  const choices = await api.getBookCoverOptions({ row: 1 });
  const choice = choices.covers.find((cover) => cover.source === "Kinokuniya");
  assert.ok(choice);
  assert.equal(choice.sourceUrl, productUrl);
  assert.equal(choice.publisherUrl, publisherUrl);
  assert.deepEqual(covers.get(choice.coverId).body, png);
  assert.deepEqual(choices.warnings, []);
  const offline = createApplicationApi(store, covers, () =>
    assert.fail("Use cached choices and stored images"),
  );
  assert.equal(
    (await offline.getBookCoverOptions({ row: 1 })).covers[0].coverId,
    choice.coverId,
  );
});

test("a Kinokuniya 404 is a confirmed miss reused for one day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = database(t),
    calls = [],
    fetchImpl = remote(calls, { status: 404 });
  let service = createCatalogService(store, fetchImpl);
  assert.deepEqual((await service.lookupIsbn(isbn)).warnings, []);
  service = createCatalogService(store, fetchImpl);
  t.mock.timers.tick(86400 * 1000 - 1);
  assert.equal((await service.lookupIsbn(isbn)).found, false);
  assert.equal(calls.filter((url) => url === productUrl).length, 1);
  t.mock.timers.tick(1);
  await service.lookupIsbn(isbn);
  assert.equal(calls.filter((url) => url === productUrl).length, 2);
});
