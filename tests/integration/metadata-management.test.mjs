import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createMetadataService } from "../../lib/server/metadata.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { googleBooks } from "../../lib/server/scrapers/google-books.ts";
import { openLibrary } from "../../lib/server/scrapers/open-library.ts";

const isbn = "9780316769488";
const source =
  "https://www.phoenixnext.com/media/catalog/product/maintenance.jpg";
const book = {
  isbn,
  series: "Maintenance",
  type: "Other",
  publisher: "",
  volume: 1,
  status: "Read",
  source: "Bookshop",
  price: 0,
  date: "2026-10-30",
  note: "Keep my notes",
};
const save = (store, data = book) =>
  store.api.saveBook({
    requestId: crypto.randomUUID(),
    book: data,
    allowDuplicate: true,
  });
function setup(t, remote = async () => new Response("{}"), sources) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const catalogs = createCatalogService(store, remote, sources);
  return { store, catalogs, ...createMetadataService(store, catalogs) };
}

test("cache maintenance filters and paginates records, inspects content and purges only the requested scope", (t) => {
  const service = setup(t),
    { store } = service;
  save(store);
  for (let index = 0; index < 25; index++)
    store.cache.put(
      `isbn:v15:test-${index}`,
      JSON.stringify({ details: { title: `Cached title ${index}` } }),
      index < 2 ? -1 : 3600,
    );
  store.cache.put("cover:isbn:v1:" + isbn, source, 3600);
  store.cache.put("scrape:v1:test:retry", "1", 900);
  store.cache.put("anilist:cooldown", String(Date.now() + 60000), 60);
  store.cache.put("cover:retry:v1:test", "1", 900);
  const overview = service.getMetadataOverview({ group: "isbn", page: 2 });
  assert.equal(overview.total, 25);
  assert.equal(overview.entries.length, 5);
  assert.equal(overview.summary.cooldowns, 3);
  assert.equal(overview.summary.expired, 2);
  assert.equal(
    service.getMetadataOverview({ search: "Cached title 24" }).total,
    1,
  );
  assert.equal(service.getMetadataOverview({ page: -20 }).page, 1);
  assert.equal(
    service.getMetadataCacheEntry({ key: "cover:isbn:v1:" + isbn }).content,
    source,
  );
  store.covers.put(
    { body: new Uint8Array([1, 2, 3]), contentType: "image/png" },
    source,
  );
  const before = store.exportData();
  assert.equal(
    service.purgeMetadataCache({ group: "isbn", expiredOnly: true }).purged,
    2,
  );
  assert.equal(
    service.purgeMetadataCache({ search: "Cached title 24" }).purged,
    1,
  );
  assert.equal(
    service.purgeMetadataCache({ key: "scrape:v1:test:retry" }).purged,
    0,
  );
  assert.equal(service.purgeMetadataCache().purged, 23);
  assert.equal(service.getMetadataOverview().summary.count, 3);
  const after = store.exportData();
  assert.deepEqual({ ...after, exportedAt: before.exportedAt }, before);
  assert.ok(store.covers.bySource(source));
  assert.throws(() => service.getMetadataOverview({ group: "invalid" }));
  assert.throws(() => service.purgeMetadataCache(null));
  assert.throws(() => service.purgeMetadataCache({ key: "" }));
  assert.throws(() => service.getMetadataCacheEntry({ key: "gone" }), {
    status: 404,
  });
});

test("ISBN re-crawls bypass both cache layers and fill only missing fields on matching owned copies", async (t) => {
  let pages = 200,
    requests = 0;
  const service = setup(
    t,
    async (url) => {
      requests++;
      return new Response(
        JSON.stringify(
          url.includes("googleapis.com")
            ? {
                items: [
                  {
                    volumeInfo: {
                      title: "Remote title",
                      publisher: "Remote publisher",
                      pageCount: pages,
                      industryIdentifiers: [{ identifier: isbn }],
                      imageLinks: { thumbnail: source },
                    },
                  },
                ],
              }
            : {},
        ),
      );
    },
    [googleBooks, openLibrary],
  );
  save(service.store);
  save(service.store, {
    ...book,
    pageCount: 123,
    coverUrl: source.replace("maintenance", "manual"),
    publisherUrl: "https://example.com/manual",
  });
  const target = service
    .getMetadataOverview()
    .targets.find((target) => target.kind === "isbn");
  assert.equal(
    service.getMetadataOverview().targets.length,
    1,
    "Duplicate copies share one ISBN crawl",
  );
  await service.catalogs.lookupIsbn(isbn);
  const beforeRequests = requests;
  pages = 208;
  assert.equal(
    (await service.catalogs.lookupIsbn(isbn)).details.pageCount,
    200,
  );
  assert.equal(requests, beforeRequests);
  assert.equal((await service.recrawlMetadata({ id: target.id })).filled, 0);
  assert.equal(service.store.api.getCollection().books[0].pageCount, "");
  assert.ok(
    requests > beforeRequests,
    "A re-crawl fetches source APIs despite fresh page entries",
  );
  const result = await service.recrawlMetadata({
    id: target.id,
    fillMissing: true,
  });
  assert.equal(result.filled, 1);
  assert.equal(result.status, "updated");
  const books = service.store.api.getCollection().books;
  assert.equal(books[0].pageCount, 208);
  assert.equal(books[0].coverUrl, source);
  assert.equal(books[0].series, book.series);
  assert.equal(books[0].publisher, "");
  assert.equal(books[0].price, 0);
  assert.equal(books[0].note, book.note);
  assert.equal(books[0].status, book.status);
  assert.equal(books[1].pageCount, 123);
  assert.equal(books[1].publisherUrl, "https://example.com/manual");
  assert.equal(books[1].coverUrl, source.replace("maintenance", "manual"));
  const retained = service.getMetadataOverview({ group: "responses" }).entries;
  assert.ok(retained.some((entry) => entry.label.includes("googleapis.com")));
  assert.ok(retained.every((entry) => entry.checkedAt));
});

test("failed ISBN refreshes preserve metadata, report failure and respect cooldowns after purging", async (t) => {
  let offline = false,
    requests = 0;
  const service = setup(
    t,
    async (url) => {
      requests++;
      if (offline) return new Response("Unavailable", { status: 503 });
      return new Response(
        JSON.stringify(
          url.includes("googleapis.com")
            ? {
                items: [
                  {
                    volumeInfo: {
                      title: "Previous metadata",
                      industryIdentifiers: [{ identifier: isbn }],
                    },
                  },
                ],
              }
            : {},
        ),
      );
    },
    [googleBooks, openLibrary],
  );
  save(service.store);
  await service.catalogs.lookupIsbn(isbn);
  const target = service.getMetadataOverview().targets[0];
  offline = true;
  const result = await service.recrawlMetadata({ id: target.id });
  assert.equal(result.status, "failed");
  assert.match(result.message, /Previous metadata kept/);
  assert.equal(
    (await service.catalogs.lookupIsbn(isbn)).details.title,
    "Previous metadata",
  );
  const before = requests;
  service.purgeMetadataCache();
  assert.equal(
    (await service.recrawlMetadata({ id: target.id })).status,
    "failed",
  );
  assert.equal(requests, before, "Purge cannot bypass retry cooldowns");
});

test("linked series crawl uses the saved link, keeps stale catalogs, and validates target IDs", async (t) => {
  let offline = false;
  const html = readFileSync(
    new URL(
      "../fixtures/series-catalogs/phoenix-category.html",
      import.meta.url,
    ),
    "utf8",
  );
  const service = setup(
    t,
    async () =>
      new Response(offline ? "Offline" : html, { status: offline ? 503 : 200 }),
  );
  service.store.api.setSeriesCatalog({
    series: "Linked series",
    type: "Manga (TH)",
    publisherId: "phoenix",
    url: "https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html",
  });
  const target = service.getMetadataOverview().targets[0];
  assert.equal(
    (await service.recrawlMetadata({ id: target.id })).status,
    "updated",
  );
  offline = true;
  const result = await service.recrawlMetadata({ id: target.id });
  assert.equal(result.status, "failed");
  assert.match(result.message, /previous check/);
  service.purgeMetadataCache();
  assert.equal(service.store.api.getCollection().seriesCatalogs.length, 1);
  await assert.rejects(
    service.recrawlMetadata({ id: "https://arbitrary.test/private" }),
    { status: 404 },
  );
});

test("the application exposes maintenance without interpreting previews as book data or fetching covers", async (t) => {
  const { store } = setup(t);
  store.cache.put(
    "isbn:v15:" + isbn,
    JSON.stringify({ details: { coverUrl: source, title: "Preview" } }),
    3600,
  );
  const api = createApplicationApi(store, {
    ensure: () => assert.fail("Maintenance must not fetch cover images"),
  });
  assert.equal((await api.getMetadataOverview()).total, 1);
  assert.match(
    (await api.getMetadataCacheEntry({ key: "isbn:v15:" + isbn })).content,
    /Preview/,
  );
});

test("overlapping re-crawls share work, block purges and preserve edits made while a source is loading", async (t) => {
  const { store, catalogs } = setup(t);
  save(store);
  const gate = Promise.withResolvers();
  let lookups = 0;
  const service = createMetadataService(store, {
    ...catalogs,
    lookupIsbn: () => {
      lookups++;
      return gate.promise;
    },
  });
  const target = service.getMetadataOverview().targets[0];
  const first = service.recrawlMetadata({ id: target.id, fillMissing: true });
  const second = service.recrawlMetadata({ id: target.id, fillMissing: true });
  assert.equal(lookups, 1);
  assert.throws(() => service.purgeMetadataCache(), { status: 409 });
  const current = store.api.getCollection().books[0];
  store.api.saveBook({
    row: current.row,
    token: current.token,
    requestId: crypto.randomUUID(),
    book: { ...current, pageCount: 321, note: "Edited while crawling" },
  });
  gate.resolve({
    found: true,
    details: {
      isbn,
      pageCount: 208,
      coverUrl: source,
      url: "https://www.phoenixnext.com/maintenance.html",
    },
    warnings: [],
  });
  assert.deepEqual(await first, await second);
  assert.equal((await first).filled, 1);
  const updated = store.api.getCollection().books[0];
  assert.equal(updated.pageCount, 321);
  assert.equal(updated.note, "Edited while crawling");
  assert.equal(
    updated.publisherUrl,
    "https://www.phoenixnext.com/maintenance.html",
  );
  assert.equal(updated.coverUrl, source);
});
