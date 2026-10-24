import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { digest } from "../../lib/domain/hash.ts";
import {
  createScraperRegistry,
  SCRAPER_SOURCES,
} from "../../lib/server/scrapers/registry.ts";

const isbn = "9780385496490";
const image = "https://books.google.com/example.jpg";

test("a registered metadata source works through the existing service without publisher-specific dispatch", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const calls = [];
  const source = {
    id: "example",
    hosts: ["catalog.example"],
    isbnPriority: 1,
    create: (context) => ({
      lookupIsbn: async (code) => {
        const data = await context.fetchJson("https://catalog.example/" + code);
        return data.isbn === code
          ? { title: data.title, source: "Example" }
          : null;
      },
    }),
  };
  const service = createCatalogService(
    store,
    async (url, options) => {
      calls.push(url);
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "manual");
      return Response.json({ isbn, title: "An example book" });
    },
    [source],
  );
  const result = await service.lookupIsbn(isbn);
  assert.equal(result.found, true);
  assert.equal(result.details.title, "An example book");
  assert.equal(result.details.source, "Example");
  assert.deepEqual(result.warnings, []);
  await service.lookupIsbn(isbn);
  assert.deepEqual(calls, ["https://catalog.example/" + isbn]);
  await assert.rejects(
    service.searchPublisherIsbn({ publisherId: "example", isbn }),
    /No publisher supports ISBN search/,
  );
});

test("removing a source disables its capabilities and hosts even when catalog data is cached", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const noNetwork = () =>
    assert.fail("A disabled source must not make requests");
  const sources = SCRAPER_SOURCES.filter((source) => source.id !== "phoenix");
  const service = createCatalogService(store, noNetwork, sources);
  store.cache.put(
    "releases:v1:phoenix",
    JSON.stringify({ items: [], checkedAt: new Date().toISOString() }),
    86400,
  );
  store.cache.put(
    "publisher-catalog:v1:" + digest("https://www.phoenixnext.com/gl.html"),
    JSON.stringify({
      items: [],
      complete: true,
      checkedAt: new Date().toISOString(),
    }),
    86400,
  );
  await assert.rejects(
    service.getPublisherReleases({ publisherId: "phoenix" }),
    /supported publisher/,
  );
  await assert.rejects(
    service.getPublisherCatalog({ url: "https://www.phoenixnext.com/gl.html" }),
    /supported publisher/,
  );
  await assert.rejects(
    service.getSeriesCatalog({
      publisherId: "phoenix",
      series: "Story",
      type: "Manga (TH)",
    }),
    /supported publisher/,
  );
  await assert.rejects(
    service.searchPublisherIsbn({ publisherId: "phoenix", isbn }),
    /ISBN search/,
  );
  const context = createScraperContext(store.cache, noNetwork, sources);
  for (const url of [
    "https://www.phoenixnext.com/",
    "https://www.firstpagepro.com.evil.test/",
    "https://user:pass@www.firstpagepro.com/",
    "https://www.firstpagepro.com:444/",
    "http://www.firstpagepro.com/",
  ])
    await assert.rejects(
      context.requestRemote(url),
      /Unsupported catalog source/,
    );
});

test("source priorities preserve preferred metadata and warning order when requests finish out of order", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const completed = [];
  let releasePreferred;
  const preferred = new Promise((resolve) => {
    releasePreferred = resolve;
  });
  const sources = [
    {
      id: "fallback",
      hosts: [],
      isbnPriority: 20,
      create: () => ({
        lookupIsbn: async () => {
          completed.push("fallback");
          releasePreferred();
          return { title: "Fallback" };
        },
      }),
    },
    {
      id: "preferred",
      hosts: [],
      isbnPriority: 10,
      create: () => ({
        lookupIsbn: async () => {
          await preferred;
          completed.push("preferred");
          return { title: "Preferred" };
        },
      }),
    },
    {
      id: "unavailable",
      hosts: [],
      isbnPriority: 5,
      isbnWarning: "First warning",
      create: () => ({
        lookupIsbn: async () => {
          throw new Error("Offline");
        },
      }),
    },
    {
      id: "later",
      hosts: [],
      isbnPriority: 30,
      isbnWarning: "Later warning",
      create: () => ({
        lookupIsbn: async () => {
          throw new Error("Offline");
        },
      }),
    },
  ];
  const service = createCatalogService(
    store,
    () => assert.fail("Unexpected request"),
    sources,
  );
  const result = await service.lookupIsbn(isbn);
  assert.deepEqual(completed, ["fallback", "preferred"]);
  assert.equal(result.details.title, "Preferred");
  assert.deepEqual(result.warnings, ["First warning"]);
});

test("a source can contribute cover options and be removed without changing the cover service", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  store.api.saveBook({
    requestId: "scraper_registry_cover",
    book: {
      isbn,
      series: "Story",
      type: "Manga (EN)",
      publisher: "Example",
      status: "Read",
      volume: 1,
      price: "",
      date: "",
      source: "",
      note: "",
    },
  });
  const book = store.api.getCollection().books[0];
  const source = {
    id: "example",
    hosts: [],
    coverPriority: 1,
    create: () => ({
      coverOptions: async (requested, refresh) => {
        assert.equal(requested.isbn, isbn);
        assert.equal(refresh, true);
        return [
          {
            title: "Example cover",
            coverUrl: image,
            url: "",
            source: "Example",
            sourceUrl: "https://catalog.example/book",
          },
        ];
      },
    }),
  };
  const noNetwork = () => assert.fail("Unexpected request");
  const service = createCatalogService(store, noNetwork, [source]);
  const result = await service.getBookCoverOptions({
    row: book.row,
    refresh: true,
  });
  assert.equal(result.covers[0].coverUrl, image);
  assert.equal(result.covers[0].source, "Example");
  const disabled = createCatalogService(store, noNetwork, []);
  const empty = await disabled.getBookCoverOptions({
    row: book.row,
    refresh: true,
  });
  assert.deepEqual(empty.covers, []);
  assert.deepEqual(empty.warnings, []);
});

test("duplicate source IDs are rejected instead of silently replacing a scraper", (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const source = { id: "duplicate", hosts: [], create: () => ({}) };
  const context = createScraperContext(
    store.cache,
    () => assert.fail("Unexpected request"),
    [source],
  );
  assert.throws(
    () => createScraperRegistry(context, [source, source]),
    /Duplicate scraper source: duplicate/,
  );
});
