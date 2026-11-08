import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openTestStore } from "../helpers/database.mjs";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import {
  createApplicationApi,
  applicationQueue,
} from "../../lib/server/api.ts";
import { createImportDiscovery } from "../../lib/server/import-discovery.ts";
import { createCoverService } from "../../lib/server/covers.ts";
import { createAccount } from "../../lib/server/auth.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { phoenix } from "../../lib/server/scrapers/phoenix.ts";
import { naiin } from "../../lib/server/scrapers/naiin.ts";
import { releaseItem } from "../../lib/domain.ts";
import { createScrapeCache } from "../../lib/server/scrape-cache.ts";

const series = "ดอกรักผลิบานที่กลางใจ";
const category =
  "https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html";
const codes = { 8: "9786165998840", 9: "9786165999656", 10: "9786165999816" };
const fixture = (name) =>
  readFileSync(new URL("../fixtures/" + name, import.meta.url), "utf8");
const planFor = (books) =>
  parseImport(Buffer.from(JSON.stringify(books)), "books.json");

function remote(calls) {
  return async (url) => {
    calls.push(url);
    if (url.endsWith("/book-series.html"))
      return new Response(fixture("series-catalogs/phoenix-directory.html"));
    if (url === category)
      return new Response(fixture("series-catalogs/phoenix-category.html"));
    if (url.endsWith("/mg0980-01.html"))
      return new Response(fixture("publishers/phoenix-kaoru-9.html"));
    if (url.endsWith("/mg0981-01.html"))
      return new Response(fixture("publishers/phoenix-kaoru-10.html"));
    if (url === "https://www.naiin.com/product/detail/632961")
      return new Response(fixture("publishers/naiin-kaoru-8.html"));
    if (url.startsWith("https://www.naiin.com/search-result?")) {
      const items = [
        {
          ProductTypeId: 3,
          ProductID: 635418,
          ProductName: series + " เล่ม 8 (Mg)",
        },
        {
          ProductTypeId: 1,
          ProductID: 692071,
          ProductName: series + " เล่ม 18 (Mg)",
          PublisherName: "PHOENIX Next",
        },
        {
          ProductTypeId: 1,
          ProductID: 632961,
          ProductName: series + " เล่ม 8 (Mg)",
          PublisherName: "PHOENIX Next",
          PriceFull: 175,
        },
      ];
      return new Response(
        `<product-list :items='${JSON.stringify(items)}'></product-list>`,
      );
    }
    return new Response("Unavailable", { status: 503 });
  };
}

test("name/volume discovery reuses one series category and targets only missing volume 8 at Naiin", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const calls = [];
  await createScrapeCache(store.cache).remember(
    "source-book:v1:phoenix:" + codes[9],
    null,
    86400,
  );
  let service = createCatalogService(store, remote(calls), [phoenix, naiin]);
  for (const volume of [8, 9, 10]) {
    const result = await service.lookupBook({ series, volume });
    assert.equal(result.found, true);
    assert.equal(result.details.isbn, codes[volume]);
    assert.equal(result.details.isbnVerified, true);
    assert.equal(result.details.volume, volume);
    assert.equal(result.details.msrp, 175);
    assert.equal(result.categoryUrl, category);
    assert.deepEqual(result.warnings, []);
    if (volume === 8) assert.equal(result.details.pageCount, 192);
  }
  assert.equal(calls.length, 6);
  assert.equal(calls.filter((url) => url === category).length, 1);
  assert.equal(calls.filter((url) => url.includes("search-result")).length, 1);
  assert.ok(
    !calls.some(
      (url) =>
        url.includes("catalogsearch") ||
        url.includes("635418") ||
        url.includes("692071"),
    ),
  );
  service = createCatalogService(
    store,
    () => assert.fail("Durable results should be reused"),
    [phoenix, naiin],
  );
  for (const volume of [8, 9, 10])
    assert.equal((await service.lookupBook({ series, volume })).found, true);
  const exact = createCatalogService(
    store,
    () => assert.fail("Discovered ISBN should not repeat a store search"),
    [phoenix],
  );
  assert.equal((await exact.lookupIsbn(codes[9])).details.isbn, codes[9]);
  for (const request of [
    { series, volume: "" },
    { series, volume: -1 },
    { series: 8, volume: 8 },
    { series, volume: 8, publisher: [] },
  ]) {
    await assert.rejects(service.lookupBook(request), { status: 400 });
  }
});

test("imports atomically queue discovery, resume after restart, preserve duplicates and continue in low-priority batches", async (t) => {
  const key = crypto.randomUUID();
  let store = await openTestStore(key);
  const reader = await createAccount(
    store,
    "import-reader",
    "import-reader@gmail.com",
  );
  const other = await createAccount(
    store,
    "other-reader",
    "other-reader@gmail.com",
  );
  const calls = [];
  const plan = planFor(
    Array.from({ length: 27 }, (_, index) => ({
      series,
      volume: [8, 9, 10][index % 3],
      type: index === 0 ? "Manga" : "",
      status: "Read",
      price: index === 0 ? 0 : "",
      source: "Book fair",
      date: "2026-01-01",
      note: "My copy " + index,
      ...(index === 0 ? { pageCount: 999, msrp: 0, msrpCurrency: "THB" } : {}),
    })),
  );
  let result;
  await store.forUser(reader, async () => {
    result = await store.importData(plan, plan.fingerprint);
  });
  assert.ok(result.discoveryJobId);
  assert.equal(calls.length, 0, "Import and preview must not scrape");
  await store.close();
  store = await openTestStore(key);
  t.after(() => store.close());
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const covers = createCoverService(store, {
    fetchImpl: async () =>
      new Response(png, { headers: { "content-type": "image/png" } }),
  });
  createApplicationApi(store, covers, remote(calls));
  const queue = applicationQueue(store);
  await queue.manageScrapeQueue({ paused: true });
  await queue.tick();
  assert.equal(calls.length, 0);
  await queue.manageScrapeQueue({ paused: false });
  let first;
  await store.forUser(reader, async () => {
    first = await queue.wait(result.discoveryJobId);
  });
  assert.equal(first.filled, 25);
  assert.ok(first.next);
  const continuation = await store.db
    .prepare(
      "SELECT * FROM scrape_jobs WHERE id<>? AND kind='discoverImportedBooks'",
    )
    .get(result.discoveryJobId);
  assert.equal(continuation.priority, -10);
  await store.forUser(reader, async () => {
    const last = await queue.wait(continuation.id);
    assert.equal(last.filled, 2);
    assert.equal(last.next, null);
    const books = (await store.api.getCollection()).books;
    assert.equal(books.length, 27);
    for (const [index, book] of books.entries()) {
      assert.equal(book.isbn, codes[book.volume]);
      assert.equal(book.series, series);
      assert.equal(book.type, "Manga");
      assert.equal(book.price, index === 0 ? 0 : "");
      assert.equal(book.note, "My copy " + index);
      assert.equal(book.source, "Book fair");
      assert.equal(book.date, "2026-01-01");
      assert.equal(book.status, "Read");
      assert.ok(book.coverId);
    }
    assert.equal(books[0].pageCount, 999);
    assert.equal(books[0].msrp, 0);
    const again = await store.importData(plan, plan.fingerprint);
    assert.equal(again.alreadyImported, true);
    assert.equal(again.discoveryJobId, result.discoveryJobId);
  });
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS count FROM scrape_jobs").get())
      .count,
    2,
  );
  await store.forUser(other, async () => {
    assert.equal((await store.api.getCollection()).books.length, 0);
  });
});

test("discovery never overwrites edits made during a remote lookup or fills removed/other-account rows", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const plan = planFor([{ series, volume: 8, type: "Manga", status: "Read" }]);
  await store.importData(plan, plan.fingerprint);
  const book = (await store.api.getCollection()).books[0];
  const started = Promise.withResolvers(),
    gate = Promise.withResolvers();
  const discover = createImportDiscovery(
    store,
    {
      lookupBook: async () => {
        started.resolve();
        await gate.promise;
        return {
          details: { isbn: codes[8], isbnVerified: true, pageCount: 192 },
          warnings: [],
        };
      },
    },
    {},
  );
  const running = discover({
    firstRow: book.row,
    lastRow: book.row,
    afterRow: 0,
  });
  await started.promise;
  await store.api.saveBook({
    row: book.row,
    token: book.token,
    book: { ...book, note: "Changed while scraping" },
    requestId: crypto.randomUUID(),
  });
  gate.resolve();
  assert.equal((await running).filled, 0);
  const edited = (await store.api.getCollection()).books[0];
  assert.equal(edited.note, "Changed while scraping");
  assert.equal(edited.isbn, "");
  await store.api.removeBook({
    row: edited.row,
    token: edited.token,
    requestId: crypto.randomUUID(),
  });
  assert.equal(
    (await discover({ firstRow: book.row, lastRow: book.row, afterRow: 0 }))
      .discovered,
    0,
  );
});

test("ambiguous formats, special sets and unverified listing ISBNs cannot be auto-confirmed", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const items = [
    releaseItem(
      "phoenix",
      `(มังงะ) ${series} เล่ม 8`,
      "https://www.phoenixnext.com/manga.html",
      175,
      codes[8],
    ),
    releaseItem(
      "phoenix",
      `(LN) ${series} เล่ม 8`,
      "https://www.phoenixnext.com/novel.html",
      175,
      codes[9],
    ),
    releaseItem(
      "phoenix",
      `(มังงะ) Special Set ${series} เล่ม 10`,
      "https://www.phoenixnext.com/set.html",
      500,
      codes[10],
    ),
  ];
  const source = {
    ...phoenix,
    create: () => ({
      catalog: async () => ({
        items,
        complete: true,
        total: 3,
        pages: 1,
        title: series,
      }),
      seriesDirectory: {
        url: "https://www.phoenixnext.com/book-series.html",
        load: async () => [{ title: series, url: category }],
      },
    }),
  };
  const service = createCatalogService(
    store,
    () => assert.fail("Unexpected network"),
    [source],
  );
  assert.equal(
    (await service.lookupBook({ series, volume: 8 })).needsSelection,
    true,
  );
  assert.equal(
    (
      await service.lookupBook({
        series,
        volume: 8,
        type: "Manga",
        edition: "Limited edition",
      })
    ).needsSelection,
    true,
  );
  assert.equal((await service.lookupBook({ series, volume: 10 })).found, false);
  const regular = await service.lookupBook({
    series,
    volume: 8,
    type: "Manga",
  });
  assert.equal(regular.found, true);
  assert.equal(
    regular.isbn,
    "",
    "Unverified listing ISBN must not be suggested as verified",
  );
  const plan = planFor([{ series, volume: 8, type: "Manga", status: "Read" }]);
  await store.importData(plan, plan.fingerprint);
  const book = (await store.api.getCollection()).books[0];
  await store.fillDiscoveredBook(book, regular.details);
  assert.equal((await store.api.getCollection()).books[0].isbn, "");
});

test("discovery aliases stay private while shared catalog/product results contain only published titles", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const reader = await createAccount(
    store,
    "private-reader",
    "private-reader@gmail.com",
  );
  const alias = "My private flower title";
  const service = createCatalogService(store, remote([]), [phoenix]);
  await store.api.setSeriesCatalog({
    series: alias,
    publisherId: "phoenix",
    type: "Manga",
    url: category,
    title: series,
  });
  assert.equal(
    (
      await service.lookupBook({
        series: alias,
        volume: 9,
        publisherId: "phoenix",
        type: "Manga",
      })
    ).found,
    true,
  );
  const rows = await store.db
    .prepare("SELECT key,value FROM cache WHERE key NOT LIKE 'user:%'")
    .all();
  assert.ok(rows.every((row) => !row.value.includes(alias)));
  await store.forUser(reader, async () => {
    assert.ok(
      (await store.cache.searchable()).every(
        (row) => !row.value.includes(alias),
      ),
    );
    assert.equal(
      (
        await service.lookupBook({
          series: alias,
          volume: 9,
          publisherId: "phoenix",
          type: "Manga",
        })
      ).found,
      false,
    );
  });
  const removed = createCatalogService(
    store,
    () => assert.fail("Disabled source"),
    [],
  );
  assert.equal((await removed.lookupBook({ series, volume: 9 })).found, false);
});
