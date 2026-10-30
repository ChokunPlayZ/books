import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const multilingual = [
  "kinokuniya.co.th",
  "www.googleapis.com",
  "openlibrary.org",
];
const thai = [
  "www.naiin.com",
  "www.yaakz.com",
  "www.firstpagepro.com",
  "www.animagshop.com",
  "www.dexpress-shop.com",
  "www.phoenixnext.com",
];
const withChecksum = (stem) => {
  const sum = [...stem].reduce(
    (sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1),
    0,
  );
  return stem + ((10 - (sum % 10)) % 10);
};
const cases = [
  ["Thai 616", "9786166247275", thai],
  ["Thai 974", withChecksum("978974000000"), thai],
  ["Thai 611", withChecksum("978611000000"), thai],
  ["Thai ISBN-10", "9748585476", thai],
  ["English 0 ISBN-10", "0140328726", ["yenpress.com"]],
  ["English 1", "9781975319434", ["yenpress.com"]],
  ["US 979-8", "9798400903526", ["yenpress.com"]],
  [
    "Japanese Kodansha ISBN-10",
    "4063951375",
    ["www.kodansha.co.jp", "www.hanmoto.com"],
  ],
  [
    "Japanese other publisher",
    withChecksum("978408000000"),
    ["www.hanmoto.com"],
  ],
  ["French 978-2", withChecksum("978200000000"), []],
  ["Chinese 978-7", withChecksum("978700000000"), []],
  ["French 979-10", withChecksum("979100000000"), []],
  ["Korean 979-11", withChecksum("979110000000"), []],
  ["Italian 979-12", withChecksum("979120000000"), []],
  ["Spanish 979-13", withChecksum("979130000000"), []],
];

test("ISBN metadata requests and outage warnings include only applicable sources", async (t) => {
  for (const [name, isbn, local] of cases)
    await t.test(name, async (t) => {
      const store = openStore(":memory:");
      t.after(() => store.close());
      const hosts = [];
      const service = createCatalogService(store, async (url) => {
        hosts.push(new URL(url).hostname);
        return new Response("Unavailable", { status: 503 });
      });
      const result = await service.lookupIsbn(isbn);
      assert.deepEqual(hosts.sort(), [...local, ...multilingual].sort());
      assert.equal(result.found, false);
      assert.equal(result.warnings.length, hosts.length);
      const offline = createCatalogService(store, () =>
        assert.fail("A routed lookup must retain its cached retry cooldown"),
      );
      assert.deepEqual(await offline.lookupIsbn(isbn), result);
    });
});

test("old unfiltered ISBN results do not retain unrelated availability warnings", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const isbn = "9780140328721";
  store.cache.put(
    "isbn:v12:" + isbn,
    JSON.stringify({ found: false, warnings: ["Naiin is unavailable"] }),
    86400,
  );
  const service = createCatalogService(
    store,
    () => assert.fail("No provider is configured"),
    [],
  );
  const result = await service.lookupIsbn(isbn);
  assert.equal(result.found, false);
  assert.deepEqual(result.warnings, []);
});

test("price comparison only checks applicable shops and omits skipped source statuses", async (t) => {
  for (const [isbn, shops] of [
    [
      "9786166247275",
      ["animag", "dexpress", "firstpage", "kinokuniya", "naiin", "phoenix"],
    ],
    ["0140328726", ["kinokuniya"]],
    ["4063951375", ["kinokuniya"]],
    [withChecksum("979100000000"), ["kinokuniya"]],
  ])
    await t.test(isbn, async (t) => {
      const store = openStore(":memory:");
      t.after(() => store.close());
      const hosts = [];
      const service = createCatalogService(store, async (url) => {
        hosts.push(new URL(url).hostname);
        return new Response("Unavailable", { status: 503 });
      });
      const result = await service.findLowestPrices({ isbn, refresh: true });
      assert.deepEqual(result.sources.map((source) => source.id).sort(), shops);
      assert.equal(hosts.length, shops.length);
      assert.ok(
        result.sources.every((source) => source.status === "unavailable"),
      );
    });
});

test("cover choices require compatible ISBN prefixes and recorded title languages", async (t) => {
  for (const [isbn, type, expected] of [
    [
      "9786166247275",
      "Manga (TH)",
      ["www.naiin.com", "www.yaakz.com", "kinokuniya.co.th"],
    ],
    ["0140328726", "Manga (EN)", ["yenpress.com", "kinokuniya.co.th"]],
    ["4063951375", "Manga (JP)", ["kinokuniya.co.th", "www.hanmoto.com"]],
    ["4063951375", "Manga (EN)", ["kinokuniya.co.th"]],
    ["4063951375", "Manga (TH)", ["kinokuniya.co.th"]],
    ["9786166247275", "Manga (EN)", ["kinokuniya.co.th"]],
    ["9786166247275", "Manga (JP)", ["kinokuniya.co.th"]],
    ["0140328726", "Manga (JP)", ["kinokuniya.co.th"]],
    [withChecksum("979110000000"), "Manga (EN)", ["kinokuniya.co.th"]],
  ])
    await t.test(isbn + " " + type, async (t) => {
      const store = openStore(":memory:");
      t.after(() => store.close());
      store.api.saveBook({
        requestId: "isbn_routing_cover",
        book: { series: "Routing test", isbn, type, status: "Read" },
      });
      const hosts = [];
      const service = createCatalogService(store, async (url) => {
        hosts.push(new URL(url).hostname);
        return new Response("Unavailable", { status: 503 });
      });
      const result = await service.getBookCoverOptions({
        row: 1,
        refresh: true,
      });
      assert.deepEqual(hosts.sort(), [...expected].sort());
      assert.equal(result.warnings.length, expected.length);
      assert.deepEqual(result.covers, []);
    });
});

test("country routing preserves title-based cover lookup when no ISBN is saved", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  store.api.saveBook({
    requestId: "isbn_routing_no_isbn",
    book: { series: "Routing test", type: "Manga (TH)", status: "Read" },
  });
  let calls = 0;
  const service = createCatalogService(
    store,
    () => assert.fail("No network expected"),
    [
      {
        id: "title-search",
        hosts: [],
        isbnPrefixes: ["978616"],
        create: () => ({
          coverOptions: async () => {
            calls++;
            return [];
          },
        }),
      },
    ],
  );
  await service.getBookCoverOptions({ row: 1 });
  assert.equal(calls, 1);
});
