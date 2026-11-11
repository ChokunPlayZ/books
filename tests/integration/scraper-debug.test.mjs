import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openTestStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import { createScraperDebugger } from "../../lib/server/scraper-debug.ts";
import {
  createApplicationApi,
  applicationQueue,
} from "../../lib/server/api.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { phoenix } from "../../lib/server/scrapers/phoenix.ts";

const isbn = "9786164648357";
const request = { isbn, providerId: "phoenix" };
const product = "https://www.phoenixnext.com/mgm0098-01.html";
const fixture = (name) =>
  readFileSync(
    new URL(
      "../fixtures/publishers/phoenix-kyo-wa-" + name + ".html",
      import.meta.url,
    ),
    "utf8",
  );
const remote = (calls) => async (url) => {
  calls.push(url);
  return new Response(
    fixture(url.includes("catalogsearch") ? "search" : "product"),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": "publisher-session=not-in-report",
      },
    },
  );
};

test("admin debug starts fresh, captures exact raw responses and parsed metadata without changing shared caches or books", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  await store.api.saveBook({
    requestId: crypto.randomUUID(),
    book: { series: "Unchanged", isbn, type: "Manga (TH)", status: "Read" },
  });
  const books = await store.api.getCollection();
  const context = createScraperContext(store.cache, () => assert.fail(), [
    phoenix,
  ]);
  await context.scrapeCache.remember(
    "text:" + product,
    "Old product HTML",
    1,
    true,
  );
  await context.scrapeCache.remember(
    "source-book:v1:phoenix:" + isbn,
    { isbn, title: "Old cached title", url: product },
    1,
    true,
  );
  const before = await store.db
    .prepare("SELECT key,value,expires_at FROM cache ORDER BY key")
    .all();
  const calls = [];
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("Debug must not attach/download covers") },
    remote(calls),
  );
  t.after(() => applicationQueue(store).stop());
  assert.ok(
    (await api.getScraperDebugSources()).some(
      (source) => source.id === "phoenix",
    ),
  );
  const report = await api.debugScraperIsbn({
    ...request,
    isbn: "ISBN 978-616-464-835-7",
  });
  assert.equal(report.isbn, isbn);
  assert.equal(report.error, "");
  assert.equal(report.outcome, "found");
  assert.equal(report.result.msrp, 175);
  assert.equal(report.result.price, 166.25);
  assert.doesNotMatch(report.result.coverUrl, /\/cache\//);
  assert.deepEqual(calls, [
    "https://www.phoenixnext.com/catalogsearch/result/?q=" + isbn,
    product,
  ]);
  assert.deepEqual(
    report.responses.map((response) => response.body),
    [fixture("search"), fixture("product")],
  );
  assert.ok(
    report.responses.every(
      (response) =>
        response.status === 200 &&
        response.method === "GET" &&
        response.bytes > 0,
    ),
  );
  assert.ok(
    report.snapshots.some((snapshot) =>
      snapshot.source.startsWith("source-book:"),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /not-in-report|Set-Cookie|Old cached title/,
  );
  assert.deepEqual(
    await store.db
      .prepare("SELECT key,value,expires_at FROM cache ORDER BY key")
      .all(),
    before,
  );
  assert.deepEqual(await store.api.getCollection(), books);
  const queue = await api.getScrapeQueue();
  const job = await api.getScrapeJob({ id: queue.jobs[0].id });
  assert.equal(job.result.result.msrp, 175);
  assert.equal(job.kind, "debugScraperIsbn");
});

test("debug captures non-200 source bodies and errors, and never bypasses durable failure cooldowns", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  let calls = 0;
  const debug = createScraperDebugger(store, async () => {
    calls++;
    return new Response(
      "<h1>Source unavailable</h1><script>notExecuted()</script>",
      { status: 503 },
    );
  }, [phoenix]);
  const failed = await debug.debugScraperIsbn(request);
  assert.equal(failed.responses[0].status, 503);
  assert.match(failed.responses[0].body, /notExecuted/);
  assert.match(failed.error, /unavailable/i);
  assert.match(failed.error, /HTTP 503/);
  assert.match(failed.error, /phoenixnext\.com/);
  assert.match(failed.stack, /^ScrapeFailure:.*HTTP 503/);
  assert.match(failed.stack, /\n\s+at /);
  const cooled = await createScraperDebugger(
    store,
    () => assert.fail("Cooldown survives a new debugger instance"),
    [phoenix],
  ).debugScraperIsbn(request);
  assert.equal(cooled.responses.length, 0);
  assert.ok(cooled.cooldowns.length > 0);
  assert.match(cooled.error, /cooldown/i);
  assert.match(cooled.error, /HTTP 503/);
  assert.equal(calls, 1);
});

test("title debug runs through the queue with an inspectable search query and outcome", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const calls = [];
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("No covers") },
    remote(calls),
  );
  const report = await api.debugScraperIsbn({
    query: "今日はカノジョがいないから",
    providerId: "phoenix",
  });
  assert.equal(report.mode, "title");
  assert.equal(report.outcome, "found");
  assert.ok(report.result.items.length > 0);
  assert.equal(calls.length, 1, "Only the search listing is requested");
  const { jobs } = await api.getScrapeQueue();
  assert.match(jobs[0].label, /今日は/);
  const job = await api.getScrapeJob({ id: jobs[0].id });
  assert.equal(job.payload.query, report.query);
  assert.equal(job.result.mode, "title");
});

test("debug authorization and input validation happen before any request or enqueue", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const api = createApplicationApi(store, { ensure: () => assert.fail() }, () =>
    assert.fail("No network"),
  );
  for (const arg of [
    null,
    {},
    { ...request, isbn: "bad" },
    { ...request, providerId: "https://localhost" },
    { ...request, providerId: "kodansha" },
  ])
    await assert.rejects(api.debugScraperIsbn(arg));
  const reader = await createAccount(
    store,
    "debug-reader",
    "debug-reader@example.com",
  );
  await store.forUser(reader, async () => {
    await assert.rejects(api.getScraperDebugSources(), { status: 403 });
    await assert.rejects(api.debugScraperIsbn(request), { status: 403 });
  });
  assert.equal((await api.getScrapeQueue()).total, 0);
});

test("queued debug work rechecks administrator access before running", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const admin = await createAccount(
    store,
    "debug-admin",
    "debug-admin@example.com",
    "admin",
  );
  const api = createApplicationApi(store, { ensure: () => assert.fail() }, () =>
    assert.fail("Revoked administrator cannot scrape"),
  );
  const queue = applicationQueue(store);
  t.after(() => queue.stop());
  await api.manageScrapeQueue({ paused: true });
  await store.forUser(admin, () =>
    assert.rejects(api.debugScraperIsbn(request), /paused/),
  );
  const { jobs } = await api.getScrapeQueue();
  await store.db
    .prepare("UPDATE users SET role='user' WHERE id=?")
    .run(admin.id);
  await api.manageScrapeQueue({ paused: false });
  await store.forUser(admin, () =>
    assert.rejects(queue.wait(jobs[0].id), /administrator/i),
  );
  const job = await api.getScrapeJob({ id: jobs[0].id });
  assert.equal(job.status, "failed");
  assert.match(job.error, /administrator/i);
});
