import test from "node:test";
import assert from "node:assert/strict";
import { openTestStore } from "../helpers/database.mjs";
import { createPublisherCrawls } from "../../lib/server/publisher-crawls.ts";
import {
  CATALOG_CRAWLER,
  createCatalogService,
} from "../../lib/server/catalogs.ts";
import { createScrapeQueue } from "../../lib/server/scrape-queue.ts";
import { recordScrapeDiagnostic } from "../../lib/server/scrape-diagnostics.ts";
import {
  ScrapeInterrupted,
  withScrapeRuntime,
} from "../../lib/server/scrape-runtime.ts";
import { phoenix } from "../../lib/server/scrapers/phoenix.ts";

test("saved-book discovery preserves the existing Naiin link when publisher metadata is filled", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  await store.api.saveBook({
    requestId: crypto.randomUUID(),
    book: {
      series: "รุ่นพี่โนอาเป็นเพื่อนผมครับ",
      type: "Manga",
      edition: "Manga (TH)",
      status: "Read",
      volume: 1,
      publisherUrl: "https://www.naiin.com/product/detail/648281",
      msrp: 145,
      price: 0,
      note: "Keep my copy",
    },
  });
  const book = (await store.api.getCollection()).books[0];
  assert.equal(
    await store.fillDiscoveredBook(book, {
      isbn: "9786165999656",
      isbnVerified: true,
      publisher: "Luckpim",
      pageCount: 192,
      msrp: 150,
      url: "https://www.luckpim.com/product/detail/1780",
    }),
    true,
  );
  const discovered = (await store.api.getCollection()).books[0];
  assert.equal(discovered.publisher, "Luckpim");
  assert.equal(discovered.publisherUrl, book.publisherUrl);
  assert.equal(discovered.isbn, "9786165999656");
  assert.equal(discovered.msrp, 145);
  assert.equal(discovered.price, 0);
  assert.equal(discovered.note, "Keep my copy");
  await store.api.saveBook({
    requestId: crypto.randomUUID(),
    ...discovered,
    book: { ...discovered, note: "Still editable" },
  });
  assert.equal(
    (await store.api.getCollection()).books[0].note,
    "Still editable",
  );
});

test("a failed product does not abort healthy series, is logged live, and resumes without repeating successes", async (t) => {
  const store = await openTestStore();
  const seriesUrl = "https://yenpress.com/series/fixture";
  const products = Array.from({ length: 12 }, (_, i) => ({
    title: `Book ${i}`,
    url: `https://yenpress.com/titles/9780316769488-fixture-${i}`,
  }));
  let fail = true;
  const warmed = [];
  const started = Promise.withResolvers(),
    gate = Promise.withResolvers();
  t.after(async () => {
    gate.resolve();
    await store.close();
  });
  const service = createPublisherCrawls(store, {
    [CATALOG_CRAWLER]: {
      sources: [{ id: "yenpress", name: "Yen Press", full: true }],
      warm: async (_id, item) => {
        warmed.push(item.url);
        if (warmed.length === 1) {
          started.resolve();
          await gate.promise;
        }
        if (fail && item.url === products[1].url)
          throw new Error("Website DNS ENOTFOUND at product details");
      },
    },
    getSeriesCategories: async () => ({
      categories: [{ title: "Fixture", url: seriesUrl }],
    }),
    getPublisherCatalog: async () => ({ complete: true, items: products }),
  });
  const queue = createScrapeQueue(store, {
    crawlPublisher: service.crawlPublisher,
  });
  const enqueue = (id, label) =>
    queue.enqueue("crawlPublisher", { id }, label, -100);
  const { id } = await service.startPublisherCrawl(
    { publisherId: "yenpress", mode: "all" },
    enqueue,
  );
  const { jobId } = (await service.getPublisherCrawls()).crawls[0];
  const sql = [];
  const prepare = store.db.prepare;
  store.db.prepare = (query) => {
    sql.push(query);
    return prepare(query);
  };
  await queue.tick();
  await started.promise;
  const live = await queue.getScrapeJob({ id: jobId });
  assert.equal(live.status, "running");
  assert.ok(
    live.events.some((event) => event.message.includes("Warm product details")),
  );
  gate.resolve();
  assert.equal((await queue.wait(jobId)).status, "failed");
  assert.equal(
    warmed.length,
    products.length,
    "healthy products after the bad one must still run",
  );
  const crawl = (await service.getPublisherCrawls()).crawls[0];
  assert.equal(crawl.status, "failed");
  assert.equal(
    crawl.remaining,
    2,
    "retain the failed book and dependent series-completion marker",
  );
  assert.equal(
    (
      await store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM publisher_crawl_seen WHERE kind='series'",
        )
        .get()
    ).n,
    0,
  );
  const detail = await queue.getScrapeJob({ id: jobId });
  assert.ok(
    detail.events.some(
      (event) =>
        event.message.includes("Stage failed") &&
        event.message.includes(products[1].url) &&
        event.message.includes("ENOTFOUND"),
    ),
  );
  assert.equal(
    sql.filter((query) => /SET frontier=|,frontier=frontier/.test(query))
      .length,
    2,
    "product checkpoints must not rewrite the full frontier",
  );
  fail = false;
  await service.managePublisherCrawl({ id, action: "resume" }, enqueue);
  const resumed = (await service.getPublisherCrawls()).crawls[0];
  assert.notEqual(resumed.jobId, jobId);
  await queue.wait(resumed.jobId);
  assert.equal(warmed.length, products.length + 1);
  assert.equal(
    (await service.getPublisherCrawls()).crawls[0].status,
    "completed",
  );
  assert.equal(
    (
      await store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM publisher_crawl_seen WHERE kind='series'",
        )
        .get()
    ).n,
    1,
  );
});

test("worker interruption survives catalog fallback without marking the publisher failed", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const service = createCatalogService(store, async () => {
    throw new Error("must not fetch");
  }, [phoenix]);
  await assert.rejects(
    withScrapeRuntime(
      {
        checkpoint: async () => {},
        minimumDelay: () => {},
        request: async () => {
          throw new ScrapeInterrupted("Worker stopping.");
        },
      },
      () =>
        service.getPublisherCatalog({
          url: "https://www.phoenixnext.com/book-series/fixture.html",
          refresh: true,
        }),
    ),
    ScrapeInterrupted,
  );
  assert.equal(
    (
      await store.db
        .prepare("SELECT COUNT(*) AS n FROM cache WHERE key LIKE '%:retry'")
        .get()
    ).n,
    0,
  );
});

test("exact internal failure causes stay in background diagnostics, not public catalog responses", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const catalogs = createCatalogService(store, async () => {
    throw new Error("private-db-fixture failure");
  }, [phoenix]);
  const request = {
    url: "https://www.phoenixnext.com/book-series/fixture.html",
    refresh: true,
  };
  const foreground = await catalogs.getPublisherCatalog(request);
  assert.doesNotMatch(JSON.stringify(foreground), /private-db-fixture/);
  const background = await withScrapeRuntime(
    {
      checkpoint: async () => {},
      minimumDelay: () => {},
      request: (_url, load) => load(),
    },
    () => catalogs.getPublisherCatalog(request),
  );
  assert.match(background.failureReason, /private-db-fixture/);
});

test("partial categories retain healthy books but remain resumable rather than complete", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  let complete = false;
  const url = "https://yenpress.com/series/partial";
  const service = createPublisherCrawls(store, {
    [CATALOG_CRAWLER]: {
      sources: [{ id: "yenpress", name: "Yen Press", full: true }],
      warm: async () => {},
    },
    getSeriesCategories: async () => ({
      categories: [{ title: "Partial", url }],
    }),
    getPublisherCatalog: async () => ({
      complete,
      error: complete ? "" : "Page 2 could not be read",
      items: [],
    }),
  });
  const queue = createScrapeQueue(store, {
    crawlPublisher: service.crawlPublisher,
  });
  const enqueue = (id, label) =>
    queue.enqueue("crawlPublisher", { id }, label, -100);
  const { id } = await service.startPublisherCrawl(
    { publisherId: "yenpress", mode: "new-series" },
    enqueue,
  );
  await queue.wait((await service.getPublisherCrawls()).crawls[0].jobId);
  const partial = (await service.getPublisherCrawls()).crawls[0];
  assert.equal(partial.status, "failed");
  assert.equal(partial.remaining, 1);
  assert.ok(
    (await queue.getScrapeJob({ id: partial.jobId })).events.some(
      (event) =>
        event.message.includes("Stage incomplete") &&
        event.message.includes("Page 2"),
    ),
  );
  complete = true;
  await service.managePublisherCrawl({ id, action: "resume" }, enqueue);
  await queue.wait((await service.getPublisherCrawls()).crawls[0].jobId);
  assert.equal(
    (await service.getPublisherCrawls()).crawls[0].status,
    "completed",
  );
});

test("resuming a fatal mid-cursor crawl also recovers earlier failures before series completion", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const product = (suffix) => ({
    kind: "book",
    title: suffix,
    url: `https://yenpress.com/titles/9780316769488-${suffix}`,
  });
  const done = product("done"),
    pending = product("pending"),
    failed = product("failed");
  const marker = {
    kind: "complete",
    title: "Fixture",
    url: "https://yenpress.com/series/fixture",
    books: [pending.url, failed.url],
  };
  const warmed = [];
  const service = createPublisherCrawls(store, {
    [CATALOG_CRAWLER]: {
      sources: [{ id: "yenpress", name: "Yen Press", full: true }],
      warm: async (_id, item) => warmed.push(item.url),
    },
  });
  const queue = createScrapeQueue(store, {
    crawlPublisher: service.crawlPublisher,
  });
  const enqueue = (id, label) =>
    queue.enqueue("crawlPublisher", { id }, label, -100);
  const { id } = await service.startPublisherCrawl(
    { publisherId: "yenpress", mode: "all" },
    enqueue,
  );
  const oldJob = (await service.getPublisherCrawls()).crawls[0].jobId;
  await store.db
    .prepare("UPDATE scrape_jobs SET status='failed' WHERE id=?")
    .run(oldJob);
  await store.db
    .prepare(
      "UPDATE publisher_crawls SET status='failed',frontier=?::jsonb,frontier_offset=1,failed_tasks=?::jsonb WHERE id=?",
    )
    .run(JSON.stringify([done, marker, pending]), JSON.stringify([failed]), id);
  await service.managePublisherCrawl({ id, action: "resume" }, enqueue);
  const nextJob = (await service.getPublisherCrawls()).crawls[0].jobId;
  await queue.wait(nextJob);
  assert.deepEqual(warmed, [pending.url, failed.url]);
  assert.equal(
    (await service.getPublisherCrawls()).crawls[0].status,
    "completed",
  );
});

test("queue diagnostics are persisted before task completion and long histories are bounded and pageable", async (t) => {
  const store = await openTestStore();
  const started = Promise.withResolvers(),
    gate = Promise.withResolvers();
  t.after(async () => {
    gate.resolve();
    await store.close();
  });
  const queue = createScrapeQueue(store, {
    fixture: async () => {
      recordScrapeDiagnostic({
        kind: "parser",
        operation: "verifyISBN",
        url: "https://yenpress.com/fixture",
        message: "Main product ISBN missing",
      });
      started.resolve();
      await gate.promise;
      return "done";
    },
  });
  const id = await queue.enqueue("fixture", null, "Diagnostic fixture");
  await queue.tick();
  await started.promise;
  // Drain the diagnostic write through the same database pool before inspection.
  const live = await queue.getScrapeJob({ id });
  assert.ok(live.events.some((event) => event.message.includes("verifyISBN")));
  gate.resolve();
  await queue.wait(id);
  await store.db.query(
    `INSERT INTO scrape_job_events(job_id,created_at,message)
    SELECT $1,1,'Fixture ' || n FROM generate_series(1,450) n`,
    [id],
  );
  const latest = await queue.getScrapeJob({ id });
  assert.equal(latest.events.length, 200);
  assert.equal(latest.eventPages, 3);
  const older = await queue.getScrapeJob({ id, eventPage: 2 });
  assert.equal(older.events.length, 200);
  assert.ok(older.events.at(-1).id < latest.events[0].id);
  const first = await queue.getScrapeJob({ id, eventPage: 3 });
  assert.ok(first.events.some((event) => event.message === "Queued"));
});

test("expired-cache cleanup is bounded and never deletes permanent or fresh records", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  for (let n = 0; n < 5; n++)
    await store.cache.put(`expired-${n}`, "expired", -1);
  await store.cache.put("permanent", "verified metadata", Infinity);
  const original = await store.db
    .prepare("SELECT ctid::text AS tuple FROM cache WHERE key='permanent'")
    .get();
  await store.cache.put("permanent", "verified metadata", Infinity);
  assert.deepEqual(
    await store.db
      .prepare("SELECT ctid::text AS tuple FROM cache WHERE key='permanent'")
      .get(),
    original,
    "reusing identical permanent metadata must not create another database tuple",
  );
  await store.cache.put("fresh", "fresh", 3600);
  assert.equal(await store.cache.pruneExpired(2), 2);
  assert.equal(await store.cache.pruneExpired(2), 2);
  assert.equal(await store.cache.pruneExpired(2), 1);
  assert.equal(await store.cache.get("permanent"), "verified metadata");
  assert.equal(await store.cache.get("fresh"), "fresh");
  await assert.rejects(store.cache.pruneExpired(0));
});
