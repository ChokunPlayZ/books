import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { phoenixBook } from "../../lib/domain/phoenix.ts";
const fixture = (file) =>
  readFileSync(
    new URL("../fixtures/publishers/" + file, import.meta.url),
    "utf8",
  );
const isbn = "9786166247404";
const product = fixture("phoenix-isbn-product.html");
const url = "https://www.phoenixnext.com/ln0838-01.html";

function scanRemote(calls, overrides = {}) {
  return async (address) => {
    calls.push(address);
    if (address.includes("naiin.com"))
      return new Response('<product-list :items="[]">');
    if (address.includes("yaakz.com"))
      return new Response('{"data":[],"total":0}');
    if (address.includes("firstpagepro.com/search"))
      return new Response('<span class="tsk-all">0</span>');
    if (address.includes("phoenixnext.com/catalogsearch"))
      return new Response(overrides.search ?? fixture("phoenix.html"), {
        status: overrides.searchStatus ?? 200,
      });
    if (address.includes("phoenixnext.com/"))
      return new Response(overrides.product ?? product, {
        status: overrides.productStatus ?? 200,
      });
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

test("Phoenix verifies the main product barcode and ignores search-card and recommendation ISBNs", () => {
  const book = phoenixBook(product, isbn, url);
  assert.equal(book.isbn, isbn);
  assert.equal(book.price, 370);
  assert.equal(book.type, "LN (TH)");
  assert.equal(book.title, "(LN) เส้นทางจาริกอาถรรพ์");
  assert.equal(
    phoenixBook(
      product.replaceAll(isbn, "9780140328721") +
        `<a href="?isbnet=${isbn}">Recommendation</a>`,
      isbn,
      url,
    ),
    null,
  );
  assert.equal(phoenixBook(product, isbn, "https://evil.test/book.html"), null);
  assert.throws(
    () => phoenixBook("<h1>Changed product</h1>", isbn, url),
    /ISBN details are unavailable/,
  );
});

test("Phoenix ISBN search covers the full catalog, canonicalizes input, verifies details and caches across services", async () => {
  const store = openStore(":memory:");
  try {
    const calls = [];
    const fetchImpl = async (address) => {
      calls.push(address);
      if (address.includes("catalogsearch"))
        return new Response(fixture("phoenix.html"));
      return new Response(product);
    };
    const api = createCatalogService(store, fetchImpl);
    const result = await api.searchPublisherIsbn({
      publisherId: "phoenix",
      isbn: "ISBN: 978-616-624-740-4",
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].isbn, isbn);
    assert.deepEqual(calls, [
      "https://www.phoenixnext.com/catalogsearch/result/?q=" + isbn,
      url,
    ]);
    await createCatalogService(store, fetchImpl).searchPublisherIsbn({
      publisherId: "phoenix",
      isbn,
    });
    assert.equal(calls.length, 2);
    await assert.rejects(
      () => api.searchPublisherIsbn({ publisherId: "unknown", isbn }),
      /Choose Phoenix/,
    );
    await assert.rejects(
      () =>
        api.searchPublisherIsbn({
          publisherId: "phoenix",
          isbn: "9786166247400",
        }),
      /not valid/,
    );
    assert.equal(calls.length, 2);
    assert.equal(store.api.getCollection().books.length, 0);
  } finally {
    store.close();
  }
});

test("First Page Pro ISBN search returns candidates without manufacturing verified ISBNs", async () => {
  const store = openStore(":memory:");
  try {
    let address;
    const api = createCatalogService(store, async (url) => {
      address = url;
      return new Response(fixture("firstpage.html"));
    });
    const result = await api.searchPublisherIsbn({
      publisherId: "firstpage",
      isbn: "0140328726",
    });
    assert.equal(
      address,
      "https://www.firstpagepro.com/search?q=9780140328721",
    );
    assert.equal(result.items.length, 2);
    assert.ok(result.items.every((item) => item.isbn === ""));
    assert.match(result.warnings.join(" "), /not been checked/);
    assert.equal(store.api.getCollection().books.length, 0);
  } finally {
    store.close();
  }
});

test("empty searches are cached; failures and changed markup are not treated as confirmed misses", async () => {
  for (const publisherId of ["phoenix", "firstpage"]) {
    const store = openStore(":memory:");
    try {
      let calls = 0;
      const api = createCatalogService(store, async () => {
        calls++;
        return new Response(
          publisherId === "phoenix"
            ? '<div class="message info empty">Empty</div>'
            : '<span class="tsk-all">0</span>',
        );
      });
      assert.equal(
        (await api.searchPublisherIsbn({ publisherId, isbn })).items.length,
        0,
      );
      await api.searchPublisherIsbn({ publisherId, isbn });
      assert.equal(calls, 1);
    } finally {
      store.close();
    }
  }
  for (const response of [
    () => new Response("Source unavailable", { status: 503 }),
    () => new Response("Changed markup"),
  ]) {
    const store = openStore(":memory:");
    try {
      let calls = 0;
      const fetchImpl = async () => {
        calls++;
        return response();
      };
      const api = createCatalogService(store, fetchImpl);
      await assert.rejects(() =>
        api.searchPublisherIsbn({ publisherId: "firstpage", isbn }),
      );
      await assert.rejects(
        () =>
          createCatalogService(store, fetchImpl).searchPublisherIsbn({
            publisherId: "firstpage",
            isbn,
            refresh: true,
          }),
        /cooldown/,
      );
      assert.equal(calls, 1);
    } finally {
      store.close();
    }
  }
});

test("Phoenix search does not accept a fuzzy result whose product barcode differs", async () => {
  const store = openStore(":memory:");
  try {
    const api = createCatalogService(
      store,
      async (address) =>
        new Response(
          address.includes("catalogsearch")
            ? fixture("phoenix.html")
            : product.replaceAll(isbn, "9780140328721"),
        ),
    );
    assert.equal(
      (await api.searchPublisherIsbn({ publisherId: "phoenix", isbn })).items
        .length,
      0,
    );
  } finally {
    store.close();
  }
});

test("scan lookup uses verified Phoenix metadata and covers, bypasses old misses and reuses durable requests", async (t) => {
  const store = openStore(":memory:"),
    calls = [];
  t.after(() => store.close());
  store.cache.put("isbn:v6:" + isbn, JSON.stringify({ found: false }), 86400);
  store.cache.put("cover:miss:v4:" + isbn, "1", 86400);
  store.api.saveBook({
    requestId: "phoenix_auto_cover_1",
    book: {
      series: "เส้นทางจาริกอาถรรพ์",
      publisher: "Phoenix Next",
      isbn,
      type: "LN (TH)",
      status: "Read",
    },
  });
  const api = createCatalogService(store, scanRemote(calls));
  const results = await Promise.all([
    api.lookupIsbn(isbn),
    api.lookupIsbn("ISBN: 978-616-624-740-4"),
  ]);
  assert.ok(
    results.every((result) => result.found && result.details.isbn === isbn),
  );
  assert.equal(results[0].details.source, "Phoenix Next");
  assert.equal(results[0].details.series, "เส้นทางจาริกอาถรรพ์");
  assert.equal(results[0].details.type, "LN (TH)");
  assert.deepEqual(results[0].warnings, []);
  assert.equal(calls.filter((address) => address === url).length, 1);
  assert.equal(
    calls.filter((address) => address.includes("phoenixnext.com/catalogsearch"))
      .length,
    1,
  );
  for (const source of ["yenpress", "kinokuniya", "googleapis", "openlibrary"])
    assert.ok(calls.some((address) => address.includes(source)));
  const offline = createCatalogService(store, () =>
    assert.fail("Use durable cached metadata"),
  );
  assert.deepEqual(await offline.lookupIsbn(isbn), results[0]);
  assert.equal(
    (await offline.getBookCover({ row: 1 })).coverUrl,
    results[0].details.coverUrl,
  );
  assert.ok(results[0].details.coverUrl);
  assert.equal(store.api.getCollection().books.length, 1);
});

test("Phoenix misses, wrong barcodes and unavailable pages continue to verified ISBN fallback providers", async (t) => {
  for (const [overrides, warning] of [
    [{ search: '<div class="message info empty">Empty</div>' }, false],
    [{ product: product.replaceAll(isbn, "9780140328721") }, false],
    [{ searchStatus: 503 }, true],
    [{ productStatus: 503 }, true],
    [{ search: "<h1>Changed markup</h1>" }, true],
    [{ product: "<h1>Maintenance</h1>" }, true],
  ]) {
    const store = openStore(":memory:");
    t.after(() => store.close());
    const api = createCatalogService(
      store,
      scanRemote([], {
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
    const result = await api.lookupIsbn(isbn);
    assert.equal(result.details.source, "Google Books");
    assert.deepEqual(
      result.warnings,
      warning ? ["Phoenix Next is unavailable right now."] : [],
    );
  }
});

test("Phoenix scan lookup retries failed sources after the cooldown across service restarts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = openStore(":memory:"),
    calls = [],
    overrides = { productStatus: 503 };
  t.after(() => store.close());
  let api = createCatalogService(store, scanRemote(calls, overrides));
  assert.equal((await api.lookupIsbn(isbn)).found, false);
  const count = calls.length;
  api = createCatalogService(store, scanRemote(calls, overrides));
  t.mock.timers.tick(15 * 60 * 1000 - 1);
  assert.equal((await api.lookupIsbn(isbn)).found, false);
  assert.equal(calls.length, count);
  overrides.productStatus = 200;
  t.mock.timers.tick(1);
  const result = await api.lookupIsbn(isbn);
  assert.equal(result.details.source, "Phoenix Next");
  assert.deepEqual(result.warnings, []);
  assert.equal(calls.filter((address) => address === url).length, 2);
});
