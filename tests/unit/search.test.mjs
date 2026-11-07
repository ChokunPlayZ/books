import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mergeSearchResults,
  searchKey,
  searchLanguage,
  searchScore,
} from "../../lib/domain/search.ts";
import { runUniversalSearch } from "../../lib/client/universal-search.ts";
import { createSearchService } from "../../lib/server/search.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const result = (title, values = {}) => ({
  id: title,
  kind: "title",
  title,
  series: title,
  publisher: "Phoenix Next",
  type: "Manga (TH)",
  volume: 1,
  isbn: "",
  url: "",
  known: false,
  owned: false,
  sources: [],
  score: 0,
  ...values,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function memoryStore(books = [], rows = []) {
  const values = new Map();
  return {
    values,
    api: { getCollection: async () => ({ books, savedReleases: [] }) },
    cache: {
      get: (key) => values.get(key) || null,
      put: (key, value) => values.set(key, value),
      searchable: async () =>
        rows.concat(
          [...values]
            .filter(([key]) => key.startsWith("search-titles:v1:"))
            .map(([key, value]) => ({ key, value })),
        ),
    },
  };
}
const source = (id, load, languages = ["th"]) => ({
  id,
  hosts: [id + ".example"],
  titleLanguages: languages,
  create: () => ({ searchTitles: load }),
});
const noNetwork = () => assert.fail("Known search must never use the network");

test("search normalization preserves Thai marks, detects language and canonicalizes ISBNs", () => {
  assert.equal(searchKey("  ＭＯＯＮ：Library  "), "moon library");
  assert.notEqual(searchKey("ป่า"), searchKey("ปา"));
  assert.equal(searchLanguage("ห้องสมุด Moon"), "th");
  assert.equal(searchLanguage("本の図書館"), "ja");
  assert.equal(searchLanguage("Moon Library"), "en");
  assert.equal(
    searchScore(
      "ISBN: 0-14-032872-6",
      result("Matilda", { isbn: "9780140328721" }),
    ),
    1200,
  );
  assert.equal(
    searchScore(
      "9780140328721",
      result("9780140328721 unrelated", { isbn: "9780385496490" }),
    ),
    0,
  );
});

test("exact matches promote above known partial matches, while duplicate editions retain library membership and all sources", () => {
  const known = result("Moon Library companion", {
    id: "owned",
    known: true,
    owned: true,
    librarySeries: "Moon Library companion",
    isbn: "9780140328721",
    sources: [{ id: "library", name: "Your library", url: "" }],
  });
  const better = result("Moon Library", {
    isbn: "9780140328721",
    sources: [
      {
        id: "naiin",
        name: "Naiin",
        url: "https://www.naiin.com/product/detail/1",
      },
    ],
  });
  const merged = mergeSearchResults(
    "Moon Library",
    [known],
    [result("Moon Library guide"), better],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, "Moon Library");
  assert.equal(merged[0].id, "owned");
  assert.equal(merged[0].owned, true);
  assert.equal(merged[0].librarySeries, known.librarySeries);
  assert.equal(merged[0].sources.length, 2);
  const editions = mergeSearchResults(
    "Moon",
    [],
    [
      result("Moon", { publisher: "ฟีนิกซ์", url: "https://a.example/1" }),
      result("Moon", { publisher: "Phoenix Next", url: "https://b.example/1" }),
      result("Moon", { type: "Manga (EN)" }),
      result("Moon", { type: "Light novel" }),
      result("Moon", { variant: true }),
      result("Moon", { volume: 2 }),
      result("Moon", { volume: "", url: "https://a.example/directory" }),
    ],
  );
  assert.equal(editions.length, 6);
  const sameUrl = [
    result("Moon", { id: "manga", url: "https://a.example/options" }),
    result("Moon", {
      id: "novel",
      url: "https://a.example/options",
      type: "Light novel",
    }),
  ];
  assert.equal(mergeSearchResults("Moon", [], sameUrl).length, 2);
  assert.equal(
    mergeSearchResults("Moon", [], [sameUrl[0], sameUrl[0]]).length,
    1,
  );
});

test("linked catalog aliases match without inventing translations or changing the publisher title", async () => {
  const store = memoryStore(
    [],
    [
      {
        key: "series:v1:alias",
        value: JSON.stringify({
          publisherId: "phoenix",
          items: [
            {
              title: "ห้องสมุด เล่ม 2",
              series: "ห้องสมุด",
              catalogSeries: "Moon Library",
              volume: 2,
            },
          ],
        }),
      },
    ],
  );
  const service = createSearchService(store, {}, noNetwork);
  const known = await service.searchKnownEntities({ query: "Moon Library" });
  assert.equal(known.results[0].title, "ห้องสมุด เล่ม 2");
  assert.equal(known.results[0].score, 1000);
});

test("English publisher title lookup uses a bounded search instead of crawling the full directory", async () => {
  const fixture = (name) =>
    readFileSync(
      new URL("../fixtures/publishers/" + name, import.meta.url),
      "utf8",
    );
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url === "https://yenpress.com/search")
      return new Response(fixture("yenpress-search.html"));
    assert.ok(url.startsWith("https://enterprise-search.yenpress.com/"));
    const query = JSON.parse(options.body);
    assert.equal(query.query, "Solo Leveling");
    assert.deepEqual(query.page, { size: 24, current: 1 });
    return new Response(fixture("yenpress-directory-1.json"));
  };
  const store = memoryStore();
  const service = createSearchService(
    store,
    createCatalogService(store, fetchImpl),
    fetchImpl,
  );
  const response = await service.searchExternalTitles({
    query: "Solo Leveling",
    sourceId: "yenpress",
  });
  assert.equal(response.results.length, 2);
  assert.equal(response.status, "partial");
  assert.equal(calls.length, 2);
});

test("known search combines the library, cached titles, publishers and shops without remote requests", async () => {
  const store = memoryStore(
    [
      {
        row: 1,
        series: "ห้องสมุดใต้แสงจันทร์",
        volume: 1,
        publisher: "Phoenix Next",
        type: "Manga",
      },
    ],
    [
      {
        key: "publisher-directory:v1:fixture",
        value: JSON.stringify({
          publisherId: "phoenix",
          titles: [{ series: "ห้องสมุดแห่งใหม่", url: "javascript:alert(1)" }],
        }),
      },
      { key: "isbn:v15:corrupt", value: "not JSON" },
    ],
  );
  const catalogs = createCatalogService(store, noNetwork);
  const service = createSearchService(store, catalogs, noNetwork);
  const known = await service.searchKnownEntities({ query: "ห้องสมุด" });
  assert.equal(known.results.length, 2);
  assert.equal(known.results[0].owned, true);
  assert.equal(known.results[1].url, "");
  assert.ok(known.sources.some((item) => item.id === "naiin"));
  assert.ok(known.sources.some((item) => item.id === "phoenix"));
  assert.ok(!known.sources.some((item) => item.id === "yenpress"));
  const isbn = await service.searchKnownEntities({ query: "9786166247275" });
  assert.ok(isbn.sources.some((item) => item.id === "naiin"));
  assert.ok(!isbn.sources.some((item) => item.id === "yenpress"));
  assert.ok(!isbn.sources.some((item) => item.id === "hanmoto"));
  const entities = await service.searchKnownEntities({ query: "Phoenix" });
  assert.ok(entities.results.some((item) => item.kind === "publisher"));
  assert.ok(entities.results.some((item) => item.kind === "store"));
  await assert.rejects(service.searchKnownEntities({ query: "a" }), /2–200/);
  await assert.rejects(service.searchKnownEntities({ query: {} }), /2–200/);
  await assert.rejects(
    service.searchExternalTitles({ query: "ห้องสมุด", sourceId: "yenpress" }),
    /applicable/,
  );
});

test("external search caches public titles, rejects unsafe source URLs and reuses discoveries on subsequent known searches", async () => {
  let calls = 0;
  const definitions = [
    source("thai", async () => {
      calls++;
      return {
        items: [
          { title: "ห้องสมุด", url: "https://thai.example/book" },
          { title: "ห้องสมุด unsafe", url: "https://other.example/book" },
          { title: "ห้องสมุด javascript", url: "javascript:alert(1)" },
        ],
        complete: false,
      };
    }),
  ];
  const store = memoryStore();
  const service = createSearchService(store, {}, noNetwork, definitions);
  const response = await service.searchExternalTitles({
    query: "ห้องสมุด",
    sourceId: "thai",
  });
  assert.equal(response.status, "partial");
  assert.equal(response.results.length, 1);
  const reopened = createSearchService(store, {}, noNetwork, definitions);
  assert.deepEqual(
    await reopened.searchExternalTitles({
      query: "ห้องสมุด",
      sourceId: "thai",
    }),
    response,
  );
  assert.equal(calls, 1);
  const known = await reopened.searchKnownEntities({ query: "ห้องสมุด" });
  assert.equal(known.results[0].known, true);
  assert.equal(known.results[0].title, "ห้องสมุด");
});

test("source outages preserve previous discoveries without relabeling stale snapshots as new successes", async () => {
  let fail = false;
  const store = memoryStore();
  const service = createSearchService(store, {}, noNetwork, [
    source("thai", async () => {
      if (fail) throw new Error("offline");
      return {
        items: [{ title: "ห้องสมุด", url: "https://thai.example/1" }],
        complete: true,
      };
    }),
  ]);
  await service.searchExternalTitles({ query: "ห้องสมุด", sourceId: "thai" });
  for (const [key, value] of store.values) {
    const record = JSON.parse(value);
    if (key.startsWith("search-titles:"))
      record.checkedAt = "2000-01-01T00:00:00Z";
    else if (key.startsWith("scrape:")) record.checkedAt = 0;
    store.values.set(key, JSON.stringify(record));
  }
  fail = true;
  const failed = await service.searchExternalTitles({
    query: "ห้องสมุด",
    sourceId: "thai",
  });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.results[0].title, "ห้องสมุด");
});

test("Thai title search reads publisher and Naiin listing cards while Japanese text only checks multilingual title sources", async () => {
  const calls = [];
  const store = memoryStore();
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://www.phoenixnext.com/"))
      return new Response(
        '<span class="toolbar-number">1</span><a class="product-item-link" href="https://www.phoenixnext.com/moon-1.html">(มังงะ) ห้องสมุด เล่ม 1</a>',
      );
    if (url.startsWith("https://www.naiin.com/"))
      return new Response(
        `<product-list :items='${JSON.stringify([{ ProductTypeId: 1, ProductID: 123, ProductName: "ห้องสมุด เล่ม 1", PublisherName: "Phoenix Next" }])}'></product-list>`,
      );
    if (url.startsWith("https://www.googleapis.com/"))
      return Response.json({
        items: [
          {
            id: "book1",
            volumeInfo: { title: "図書館", publisher: "Publisher" },
          },
        ],
      });
    assert.fail("Unexpected source " + url);
  };
  const service = createSearchService(
    store,
    createCatalogService(store, fetchImpl),
    fetchImpl,
  );
  const publisher = await service.searchExternalTitles({
    query: "ห้องสมุด",
    sourceId: "phoenix",
  });
  assert.equal(publisher.results[0].volume, 1);
  const shop = await service.searchExternalTitles({
    query: "ห้องสมุด",
    sourceId: "naiin",
  });
  assert.equal(shop.results[0].title, "ห้องสมุด เล่ม 1");
  assert.equal(shop.results[0].isbn, "");
  const japanese = await service.searchKnownEntities({ query: "図書館" });
  assert.deepEqual(
    japanese.sources.map((item) => item.id),
    ["google-books"],
  );
  const google = await service.searchExternalTitles({
    query: "図書館",
    sourceId: "google-books",
  });
  assert.equal(
    google.results[0].url,
    "https://books.google.com/books?id=book1",
  );
  assert.equal(calls.length, 3);
});

test("progressive search publishes known results first, appends fast matches and promotes a better late match", async () => {
  const slow = deferred(),
    fast = deferred(),
    started = deferred(),
    fastPublished = deferred();
  const updates = [];
  const pending = runUniversalSearch({
    query: "Moon",
    signal: new AbortController().signal,
    rpc: async (name, arg) => {
      if (name === "searchKnownEntities")
        return {
          query: "Moon",
          results: [result("Moon companion", { known: true })],
          sources: [
            { id: "slow", name: "Slow" },
            { id: "fast", name: "Fast" },
          ],
        };
      if (arg.sourceId === "slow") {
        started.resolve();
        return slow.promise;
      }
      return fast.promise;
    },
    onProgress: (progress) => {
      updates.push(progress);
      if (
        progress.sources.some(
          (item) => item.id === "fast" && item.status === "complete",
        )
      )
        fastPublished.resolve();
    },
  });
  await started.promise;
  assert.equal(updates[0].phase, "known");
  assert.equal(updates[0].results.length, 1);
  fast.resolve({ results: [result("Moon guide")], status: "complete" });
  await fastPublished.promise;
  assert.equal(updates.at(-1).results.length, 2);
  slow.resolve({ results: [result("Moon")], status: "complete" });
  await pending;
  assert.equal(updates.at(-1).phase, "complete");
  assert.equal(updates.at(-1).results[0].title, "Moon");
});

test("superseded searches never publish late responses or start queued sources", async () => {
  const first = deferred(),
    started = deferred(),
    controller = new AbortController();
  const updates = [],
    calls = [];
  const pending = runUniversalSearch({
    query: "Moon",
    signal: controller.signal,
    rpc: async (name, arg) => {
      if (name === "searchKnownEntities")
        return {
          query: "Moon",
          results: [],
          sources: ["one", "two", "three", "four"].map((id) => ({
            id,
            name: id,
          })),
        };
      calls.push(arg.sourceId);
      started.resolve();
      return first.promise;
    },
    onProgress: (value) => updates.push(value),
  });
  await started.promise;
  controller.abort();
  first.resolve({ results: [result("Moon")], status: "complete" });
  await pending;
  assert.equal(updates.length, 1);
  assert.deepEqual(calls, ["one", "two", "three"]);
});
