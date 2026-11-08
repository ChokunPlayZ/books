import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { createScraperRegistry } from "../../lib/server/scrapers/registry.ts";
import { yaakz } from "../../lib/server/scrapers/yaakz.ts";
import { yaakzProducts } from "../../lib/server/yaakz.ts";
import { createPublisherIsbnSearch } from "../../lib/client/publisher-isbn-search.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const isbn = "9786165898843";
const url = "https://www.yaakz.com/product/11000408800037516";
const listing = JSON.parse(fixture("yaakz-isbn-search.json"));
const productPage = fixture("yaakz-isbn-product.html");
const product = yaakzProducts(productPage)[0];

function memoryStore() {
  const values = new Map();
  return {
    cache: {
      get(key) {
        const entry = values.get(key);
        return entry && entry.expiresAt > Date.now() ? entry.value : null;
      },
      put(key, value, seconds) {
        values.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      },
    },
  };
}

// Encode representative public records as Nuxt references, without scripts.
function nuxtPage(products) {
  const values = [];
  function write(value) {
    const index = values.length;
    values.push(null);
    values[index] =
      value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, write(child)]),
          )
        : value;
    if (Array.isArray(value)) values[index] = Object.values(values[index]);
    return index;
  }
  write({
    pinia: {
      products: {
        products: Object.fromEntries(products.map((item) => [item.uuid, item])),
      },
    },
  });
  return `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(values)}</script>`;
}

function remote(calls, { search = listing, page = productPage } = {}) {
  return async (address) => {
    calls.push(address);
    return address.includes("/api/products")
      ? Response.json(search)
      : new Response(page);
  };
}

test("Yaakz verifies the user's standalone ISBN example and shares canonical search, lookup and durable cover metadata", async () => {
  assert.equal(Object.hasOwn(listing.data[0], "barcode"), false);
  const store = memoryStore();
  const calls = [];
  const api = createCatalogService(store, remote(calls), [yaakz]);
  const [result, duplicate] = await Promise.all([
    api.searchPublisherIsbn({
      publisherId: "yaakz",
      isbn: "ISBN: 978-616-589-884-3",
    }),
    api.searchPublisherIsbn({ publisherId: "yaakz", isbn }),
  ]);
  assert.deepEqual(duplicate, result);
  assert.equal(result.url, "https://www.yaakz.com/search?q=" + isbn);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].isbn, isbn);
  assert.equal(result.items[0].isbnVerified, true);
  assert.equal(result.items[0].url, url);
  assert.equal(result.items[0].volume, 1);
  assert.equal(result.items[0].coverUrl, "https://du.lnwfile.com/hgli6z.jpg");
  assert.equal(result.items[0].price, 132);
  assert.equal(result.items[0].availability, "In stock");
  assert.deepEqual(result.warnings, []);
  assert.equal(calls.length, 2);
  const search = new URL(calls[0]);
  assert.equal(search.pathname, "/api/products");
  assert.equal(search.searchParams.get("filter[q]"), isbn);
  assert.equal(search.searchParams.get("page"), "1");
  assert.equal(search.searchParams.get("per_page"), "20");
  assert.equal(calls[1], url);

  const offline = () => assert.fail("Reuse verified durable metadata");
  const restarted = createCatalogService(store, offline, [yaakz]);
  assert.deepEqual(
    await restarted.searchPublisherIsbn({ publisherId: "yaakz", isbn }),
    result,
  );
  const lookup = await restarted.lookupIsbn(isbn);
  assert.equal(lookup.found, true);
  assert.equal(lookup.details.source, "Yaakz");
  assert.equal(lookup.details.url, url);
  assert.equal(lookup.details.coverUrl, result.items[0].coverUrl);
  const source = createScraperRegistry(
    createScraperContext(store.cache, offline, [yaakz]),
    [yaakz],
  ).get("yaakz");
  const covers = await source.coverOptions({
    isbn,
    publisher: "Other publisher",
  });
  assert.equal(covers[0].coverUrl, result.items[0].coverUrl);
  assert.equal(covers[0].sourceUrl, url);
});

test("Yaakz automatic ISBN lookup fetches standalone product details when the listing has no barcode", async () => {
  const calls = [];
  const api = createCatalogService(memoryStore(), remote(calls), [yaakz]);
  const result = await api.lookupIsbn(isbn);
  assert.equal(result.found, true);
  assert.equal(result.details.isbn, isbn);
  assert.equal(result.details.source, "Yaakz");
  assert.equal(result.details.price, 132);
  assert.deepEqual(result.warnings, []);
  assert.equal(calls.length, 2);
});

test("Yaakz verifies individual child volumes, not parent range barcodes or special sets", async () => {
  const parent = yaakzProducts(fixture("yaakz-product.html"))[0];
  const api = createCatalogService(
    memoryStore(),
    remote([], {
      search: JSON.parse(fixture("yaakz-list.json")),
      page: nuxtPage([{ ...parent, barcode: isbn }]),
    }),
    [yaakz],
  );
  const result = await api.searchPublisherIsbn({
    publisherId: "yaakz",
    isbn: "9786165890830",
  });
  assert.equal(result.items[0].volume, 1);
  assert.equal(
    result.items[0].url,
    "https://www.yaakz.com/product/11000408800014925",
  );
  assert.equal(result.items[0].coverUrl, "https://du.lnwfile.com/vdjnpn.jpg");
  for (const code of [isbn, "9786165894609"])
    assert.deepEqual(
      (await api.searchPublisherIsbn({ publisherId: "yaakz", isbn: code }))
        .items,
      [],
    );
});

test("Yaakz rejects fuzzy listing ISBNs and recommendations for a different product", async () => {
  const api = createCatalogService(
    memoryStore(),
    remote([], {
      search: { ...listing, data: [{ ...listing.data[0], barcode: isbn }] },
      page: nuxtPage([
        { ...product, barcode: "9786165890830" },
        { ...product, uuid: "99999" },
      ]),
    }),
    [yaakz],
  );
  assert.deepEqual(
    (await api.searchPublisherIsbn({ publisherId: "yaakz", isbn })).items,
    [],
  );
});

test("Yaakz keeps checking candidates after an unavailable product", async () => {
  const calls = [];
  const api = createCatalogService(
    memoryStore(),
    async (address) => {
      calls.push(address);
      if (address.includes("/api/products"))
        return Response.json({
          total: 2,
          data: [{ ...listing.data[0], uuid: "99999" }, listing.data[0]],
        });
      return address === url
        ? new Response(productPage)
        : new Response("Unavailable", { status: 503 });
    },
    [yaakz],
  );
  const result = await api.searchPublisherIsbn({ publisherId: "yaakz", isbn });
  assert.equal(result.items[0].isbn, isbn);
  assert.deepEqual(result.warnings, []);
  assert.equal(calls.length, 3);
});

test("Yaakz bounds ISBN verification to four candidate product pages", async () => {
  const calls = [];
  const api = createCatalogService(
    memoryStore(),
    async (address) => {
      calls.push(address);
      if (address.includes("/api/products"))
        return Response.json({
          total: 5,
          data: Array.from({ length: 5 }, (_, index) => ({
            ...listing.data[0],
            uuid: String(index + 1),
          })),
        });
      const uuid = new URL(address).pathname.split("/").pop();
      return new Response(
        nuxtPage([{ ...product, uuid, barcode: "9786165890830" }]),
      );
    },
    [yaakz],
  );
  assert.deepEqual(
    (await api.searchPublisherIsbn({ publisherId: "yaakz", isbn })).items,
    [],
  );
  assert.equal(calls.length, 5);
  assert.ok(!calls.includes("https://www.yaakz.com/product/5"));
});

test("Yaakz caches confirmed empty ISBN searches for 24 hours", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = memoryStore();
  const calls = [];
  const fetchImpl = remote(calls, { search: { total: 0, data: [] } });
  const search = () =>
    createCatalogService(store, fetchImpl, [yaakz]).searchPublisherIsbn({
      publisherId: "yaakz",
      isbn,
    });
  assert.deepEqual((await search()).items, []);
  t.mock.timers.tick(24 * 3600 * 1000 - 1);
  await search();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  await search();
  assert.equal(calls.length, 2);
});

for (const [name, overrides] of [
  ["missing listing data", { search: {} }],
  ["inconsistent listing total", { search: { ...listing, total: 0 } }],
  ["missing search results", { search: { total: 1, data: [] } }],
  [
    "invalid product UUID",
    { search: { total: 1, data: [{ uuid: "//evil.test" }] } },
  ],
  ["null product record", { search: { total: 1, data: [null] } }],
  ["changed product markup", { page: "<h1>Changed product</h1>" }],
  [
    "missing product barcode",
    { page: nuxtPage([{ ...product, barcode: null }]) },
  ],
  [
    "invalid product barcode",
    { page: nuxtPage([{ ...product, barcode: "9786165898840" }]) },
  ],
  [
    "recommendation without the main product",
    { page: nuxtPage([{ ...product, uuid: "99999" }]) },
  ],
]) {
  test(
    "Yaakz treats " + name + " as unavailable, not a cached ISBN miss",
    async () => {
      const store = memoryStore();
      const calls = [];
      const fetchImpl = remote(calls, overrides);
      await assert.rejects(
        createCatalogService(store, fetchImpl, [yaakz]).searchPublisherIsbn({
          publisherId: "yaakz",
          isbn,
        }),
      );
      const count = calls.length;
      await assert.rejects(
        createCatalogService(store, fetchImpl, [yaakz]).searchPublisherIsbn({
          publisherId: "yaakz",
          isbn,
          refresh: true,
        }),
        /cooldown/,
      );
      assert.equal(calls.length, count);
    },
  );
}

test("Yaakz remains available to the debounced publisher ISBN search client", async () => {
  const controller = new AbortController();
  const calls = [];
  let changed;
  const ready = new Promise((resolve) => {
    changed = resolve;
  });
  const search = createPublisherIsbnSearch({
    signal: controller.signal,
    rpc: async (name, arg) => {
      calls.push({ name, arg });
      return { ...arg, items: [], warnings: [] };
    },
    onChange: changed,
  });
  assert.equal(search.get("yaakz", "ISBN: 978-616-589-884-3").loading, true);
  await ready;
  assert.deepEqual(calls, [
    { name: "searchPublisherIsbn", arg: { publisherId: "yaakz", isbn } },
  ]);
  assert.deepEqual(search.get("yaakz", isbn).items, []);
  assert.equal(search.get("yaakz", "0140328726"), null);
  controller.abort();
});
