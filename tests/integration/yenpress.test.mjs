import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createCoverService } from "../../lib/server/covers.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import {
  yenPressBook,
  yenPressCandidates,
  yenPressSearchKey,
} from "../../lib/domain/yenpress.ts";
import { BOOK_APP, safeCoverUrl, safeProductUrl } from "../../lib/domain.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const printIsbn = "9781975319434";
const digitalIsbn = "9781975319441";
const productUrl = `https://yenpress.com/titles/${printIsbn}-solo-leveling-vol-1-comic`;
const comic = fixture("yenpress-comic.html");
const search = JSON.parse(fixture("yenpress-search.json"));
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
  return async (url, options) => {
    calls.push({ url, options });
    if (url.includes("animagshop.com/search"))
      return new Response(fixture("animag-empty.html"));
    if (url.includes("naiin.com"))
      return new Response('<product-list :items="[]">');
    if (url.includes("yaakz.com")) return new Response('{"data":[],"total":0}');
    if (url.includes("firstpagepro.com/search"))
      return new Response('<span class="tsk-all">0</span>');
    if (url.includes("phoenixnext.com/catalogsearch"))
      return new Response('<div class="message info empty">Empty</div>');
    if (url.startsWith("https://kinokuniya.co.th/products/"))
      return new Response("Not found", { status: 404 });
    if (url === "https://yenpress.com/search")
      return new Response(
        overrides.bootstrap ?? fixture("yenpress-search.html"),
      );
    if (url.includes("enterprise-search.yenpress.com"))
      return new Response(JSON.stringify(overrides.search ?? search), {
        status: overrides.searchStatus ?? 200,
      });
    if (url.startsWith("https://yenpress.com/titles/"))
      return new Response(overrides.product ?? comic, {
        status: overrides.productStatus ?? 200,
      });
    if (url.startsWith("https://images.yenpress.com/"))
      return new Response(png);
    if (url.includes("googleapis.com"))
      return new Response(JSON.stringify(overrides.google ?? {}));
    if (url.includes("openlibrary.org")) return new Response("{}");
    assert.fail("Unexpected source: " + url);
  };
}

test("Yen Press reads exact print and digital details, English formats, authors and lazy cover images", () => {
  // Navigation links elsewhere on the page must not determine the book format.
  const print = yenPressBook(
    '<a href="/category/light-novels">Novels</a>' + comic,
    printIsbn,
    productUrl,
  );
  assert.equal(print.title, "Solo Leveling, Vol. 1 (comic)");
  assert.equal(print.series, "Solo Leveling (comic)");
  assert.equal(print.volume, 1);
  assert.equal(print.type, "Manga (EN)");
  assert.ok(BOOK_APP.types.includes(print.type));
  assert.equal(print.publisher, "Ize Press");
  assert.equal(print.authors, "Chugong");
  assert.equal(print.releaseDate, "Mar 02, 2021");
  assert.match(
    print.coverUrl,
    /^https:\/\/images\.yenpress\.com\/imgs\/9781975319434\.jpg\?/,
  );
  assert.equal(
    yenPressBook(comic, digitalIsbn, productUrl).publisher,
    "Yen Press",
  );
  const digital = yenPressBook(
    fixture("yenpress-digital.html"),
    printIsbn,
    productUrl,
  );
  assert.equal(
    digital.publisher,
    "Ize Press",
    "Select by ISBN, not the active tab",
  );
  assert.equal(digital.type, "Manga (EN)");
  const novel = yenPressBook(
    fixture("yenpress-novel.html"),
    "9798400903526",
    "https://yenpress.com/titles/9798400903526-omniscient-reader-s-viewpoint-novel-vol-1",
  );
  assert.equal(novel.type, "LN (EN)");
  assert.equal(novel.authors, "singNsong");
  assert.equal(novel.volume, 1);
  assert.equal(yenPressBook(comic, "9780140328721", productUrl), null);
  assert.throws(
    () => yenPressBook("<h1>Unavailable</h1>", printIsbn, productUrl),
    /markup changed/,
  );
  assert.throws(
    () =>
      yenPressBook(comic.replaceAll("ISBN", "Barcode"), printIsbn, productUrl),
    /ISBNs unavailable/,
  );
});

test("Yen Press search accepts only exact ISBN candidates on supported title URLs", () => {
  assert.equal(
    yenPressSearchKey(fixture("yenpress-search.html")),
    "search-publicfixture",
  );
  assert.deepEqual(yenPressCandidates(search, printIsbn), [productUrl]);
  const result = (url, isbn = printIsbn) => ({
    isbn: { raw: isbn },
    url: { raw: url },
  });
  assert.deepEqual(
    yenPressCandidates(
      {
        results: [
          result("https://yenpress.com.evil.test/titles/9781975319434-book"),
          result("https://user:pass@yenpress.com/titles/9781975319434-book"),
          result(
            "https://yenpress.com/titles/9781975319434-book?redirect=evil",
          ),
          result("https://yenpress.com:8080/titles/9781975319434-book"),
          result(productUrl, digitalIsbn),
          result(productUrl),
          result(productUrl),
        ],
      },
      printIsbn,
    ),
    [productUrl],
  );
  assert.throws(() => yenPressCandidates({}, printIsbn), /response changed/);
  assert.throws(
    () =>
      yenPressSearchKey(
        '<script>var _elastic = {"url":"https://evil.test/","engine":"yenpress","search_key":"search-test"};</script>',
      ),
    /configuration changed/,
  );
  assert.equal(safeProductUrl(productUrl, "yenpress"), productUrl);
  assert.equal(
    safeCoverUrl("https://images.yenpress.com/imgs/cover.jpg"),
    "https://images.yenpress.com/imgs/cover.jpg",
  );
  for (const url of [
    "https://images.yenpress.com.evil.test/a.jpg",
    "https://user:pass@images.yenpress.com/a.jpg",
    "https://images.yenpress.com:8080/a.jpg",
    "https://enterprise-search.yenpress.com/a.jpg",
  ])
    assert.equal(safeCoverUrl(url), "");
});

test("ISBN lookup uses Yen Press before generic providers and shares cached requests across service restarts", async (t) => {
  const store = database(t),
    calls = [],
    fetchImpl = remote(calls);
  // Previously cached misses must not hide a newly supported provider.
  store.cache.put(
    "isbn:v3:" + printIsbn,
    JSON.stringify({ found: false }),
    86400,
  );
  let service = createCatalogService(store, fetchImpl);
  const results = await Promise.all([
    service.lookupIsbn(printIsbn),
    service.lookupIsbn("1975319435"),
  ]);
  assert.ok(results.every((result) => result.details?.source === "Yen Press"));
  assert.deepEqual(results[0].warnings, []);
  assert.equal(results[0].details.publisher, "Ize Press");
  assert.equal(calls.length, 11);
  const apiRequest = calls.find((call) =>
    call.url.includes("enterprise-search"),
  );
  assert.equal(apiRequest.options.method, "POST");
  assert.equal(apiRequest.options.redirect, "manual");
  assert.equal(
    apiRequest.options.headers.Authorization,
    "Bearer search-publicfixture",
  );
  assert.equal(apiRequest.options.headers.Origin, "https://yenpress.com");
  assert.equal(JSON.parse(apiRequest.options.body).query, printIsbn);
  service = createCatalogService(store, fetchImpl);
  await service.lookupIsbn(printIsbn);
  assert.equal(calls.length, 11);
  assert.ok(
    !JSON.stringify(store.db.prepare("SELECT value FROM cache").all()).includes(
      "search-publicfixture",
    ),
  );
});

test("Yen Press misses, wrong editions and outages continue to verified fallback providers", async (t) => {
  for (const [overrides, warningCount] of [
    [{ search: { results: [] } }, 0],
    [{ product: comic.replaceAll(printIsbn, digitalIsbn) }, 0],
    [{ searchStatus: 503 }, 1],
    [{ productStatus: 503 }, 1],
    [{ search: {} }, 1],
    [{ bootstrap: "<h1>Site maintenance</h1>" }, 1],
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
                title: "Fallback",
                industryIdentifiers: [{ identifier: printIsbn }],
              },
            },
          ],
        },
      }),
    );
    const result = await service.lookupIsbn(printIsbn);
    assert.equal(result.details.source, "Google Books");
    assert.equal(result.details.title, "Fallback");
    assert.equal(result.warnings.length, warningCount);
    if (result.warnings.length) assert.match(result.warnings[0], /Yen Press/);
  }
});

test("Yen Press outages back off across service restarts and recover after the retry window", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = database(t),
    calls = [],
    overrides = { searchStatus: 503 };
  const fetchImpl = remote(calls, overrides);
  let service = createCatalogService(store, fetchImpl);
  const failed = await service.lookupIsbn(printIsbn);
  assert.equal(failed.found, false);
  assert.deepEqual(failed.warnings, ["Yen Press is unavailable right now."]);
  const count = calls.length;
  service = createCatalogService(store, fetchImpl);
  t.mock.timers.tick(15 * 60 * 1000 - 1);
  assert.equal((await service.lookupIsbn(printIsbn)).found, false);
  assert.equal(calls.length, count);
  overrides.searchStatus = 200;
  t.mock.timers.tick(1);
  const recovered = await service.lookupIsbn(printIsbn);
  assert.equal(recovered.details.source, "Yen Press");
  assert.deepEqual(recovered.warnings, []);
  assert.equal(
    calls.filter((call) => call.url === "https://yenpress.com/search").length,
    2,
  );
});

test("Yen Press covers are available automatically and through Pull covers, stored and reusable offline", async (t) => {
  const store = database(t),
    calls = [],
    fetchImpl = remote(calls);
  const covers = createCoverService(store, { fetchImpl });
  const api = createApplicationApi(store, covers, fetchImpl);
  store.api.saveBook({
    requestId: "yenpress_cover_save_1",
    book: {
      series: "Solo Leveling (comic)",
      isbn: printIsbn,
      volume: 1,
      type: "Manga (EN)",
      publisher: "Ize Press",
      status: "Read",
    },
  });
  store.cache.put("cover:miss:v1:" + printIsbn, "1", 86400);
  const automatic = await api.getBookCover({ row: 1 });
  assert.match(automatic.coverId, /^[a-f0-9]{64}$/);
  const choices = await api.getBookCoverOptions({ row: 1 });
  const choice = choices.covers.find((cover) => cover.source === "Yen Press");
  assert.equal(choice.coverId, automatic.coverId);
  assert.equal(choice.publisherUrl, productUrl);
  assert.equal(choice.sourceUrl, productUrl);
  assert.deepEqual(covers.get(choice.coverId).body, png);
  const count = calls.length;
  const offline = createApplicationApi(store, covers, () =>
    assert.fail("Cached choices must not use the network"),
  );
  assert.equal(
    (await offline.getBookCoverOptions({ row: 1 })).covers[0].coverId,
    choice.coverId,
  );
  assert.equal(calls.length, count);
});
