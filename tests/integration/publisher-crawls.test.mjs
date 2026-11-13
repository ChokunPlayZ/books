import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { openTestStore } from "../helpers/database.mjs";
import { createPublisherCrawls } from "../../lib/server/publisher-crawls.ts";
import { CATALOG_CRAWLER } from "../../lib/server/catalogs.ts";
import { createScrapeQueue } from "../../lib/server/scrape-queue.ts";
import {
  backgroundRequest,
  scrapeCheckpoint,
} from "../../lib/server/scrape-runtime.ts";
import { createAccount } from "../../lib/server/auth.ts";

const product = (title) => ({
  kind: "book",
  title,
  url: `https://yenpress.com/titles/9780316769488-${title}`,
});

function recoveryService(store, warmed) {
  return createPublisherCrawls(store, {
    [CATALOG_CRAWLER]: {
      sources: [{ id: "yenpress", name: "Yen Press", full: true }],
      warm: async (_id, item) => warmed.push(item.url),
    },
  });
}

test("restarted crawls recover expired or missing leases at the attempt limit and retain their cursor", async (t) => {
  for (const [status, lease] of [
    ["running", Date.now() - 100],
    ["running", null],
    ["paused", Date.now() - 100],
  ]) {
    await t.test(
      `${status}/${lease === null ? "missing" : "expired"} lease`,
      async (t) => {
        const key = crypto.randomUUID();
        const before = await openTestStore(key);
        const service = recoveryService(before, []);
        const oldQueue = createScrapeQueue(before, {
          crawlPublisher: service.crawlPublisher,
        });
        const { id } = await service.startPublisherCrawl(
          { publisherId: "yenpress", mode: "all" },
          (id, label) =>
            oldQueue.enqueue("crawlPublisher", { id }, label, -100),
        );
        const { jobId } = (await service.getPublisherCrawls()).crawls[0];
        const done = product("done"),
          pending = product("pending");
        await before.db
          .prepare(
            "UPDATE publisher_crawls SET status=?,frontier=?::jsonb,frontier_offset=1,processed=1,discovered=2 WHERE id=?",
          )
          .run(status, JSON.stringify([done, pending]), id);
        await before.db
          .prepare(
            "UPDATE scrape_jobs SET status='running',attempts=max_attempts,lease_token='old',lease_until=? WHERE id=?",
          )
          .run(lease, jobId);
        await before.close();

        const store = await openTestStore(key);
        t.after(() => store.close());
        const warmed = [];
        const recovered = recoveryService(store, warmed);
        const queue = createScrapeQueue(store, {
          crawlPublisher: recovered.crawlPublisher,
        });
        await queue.tick();
        const job = await store.db
          .prepare("SELECT status,lease_token FROM scrape_jobs WHERE id=?")
          .get(jobId);
        assert.notEqual(
          job.status,
          "failed",
          "restarts do not exhaust a crawl",
        );
        assert.notEqual(
          job.lease_token,
          "old",
          "the abandoned worker is fenced",
        );
        if (status === "paused") {
          assert.equal(
            (await recovered.getPublisherCrawls()).crawls[0].status,
            "paused",
          );
          assert.deepEqual(warmed, []);
          await recovered.managePublisherCrawl({ id, action: "resume" });
          assert.equal(
            (await recovered.getPublisherCrawls()).crawls[0].jobId,
            jobId,
          );
        }
        await queue.wait(jobId);
        assert.deepEqual(warmed, [pending.url]);
        const crawl = (await recovered.getPublisherCrawls()).crawls[0];
        assert.equal(crawl.status, "completed");
        assert.equal(crawl.processed, 2);
        assert.equal(crawl.remaining, 0);
        const detail = await queue.getScrapeJob({ id: jobId });
        assert.equal(detail.attempts, detail.maxAttempts);
        assert.ok(
          detail.events.some((event) => /interrupted/.test(event.message)),
        );
      },
    );
  }
});

test("orphaned running and paused crawls can resume pending work through reconciliation or directly", async (t) => {
  for (const [status, jobStatus, reconcile] of [
    ["running", "failed", true],
    ["paused", null, true],
    ["running", "failed", false],
    ["paused", "cancelled", false],
  ]) {
    await t.test(`${status}/${jobStatus}/${reconcile}`, async (t) => {
      const store = await openTestStore();
      t.after(() => store.close());
      const warmed = [];
      const service = recoveryService(store, warmed);
      const queue = createScrapeQueue(store, {
        crawlPublisher: service.crawlPublisher,
      });
      const enqueue = (id, label) =>
        queue.enqueue("crawlPublisher", { id }, label, -100);
      await queue.manageScrapeQueue({ paused: true });
      const { id } = await service.startPublisherCrawl(
        { publisherId: "yenpress", mode: "all" },
        enqueue,
      );
      const { jobId } = (await service.getPublisherCrawls()).crawls[0];
      const done = product("done"),
        pending = product("pending"),
        failed = product("failed");
      await store.db
        .prepare(
          "UPDATE publisher_crawls SET status=?,frontier=?::jsonb,frontier_offset=1,failed_tasks=?::jsonb,processed=1 WHERE id=?",
        )
        .run(
          status,
          JSON.stringify([done, pending]),
          JSON.stringify([failed]),
          id,
        );
      if (jobStatus)
        await store.db
          .prepare(
            "UPDATE scrape_jobs SET status=?,error='Worker stopped' WHERE id=?",
          )
          .run(jobStatus, jobId);
      else
        await store.db.prepare("DELETE FROM scrape_jobs WHERE id=?").run(jobId);

      if (reconcile) {
        await queue.tick();
        const orphan = (await service.getPublisherCrawls()).crawls[0];
        assert.equal(
          orphan.status,
          "failed",
          "a finished worker cannot leave an active crawl",
        );
        assert.ok(orphan.error);
        assert.equal(orphan.processed, 1);
      }
      await service.managePublisherCrawl({ id, action: "resume" }, enqueue);
      const resumed = (await service.getPublisherCrawls()).crawls[0];
      assert.equal(resumed.status, "running");
      assert.notEqual(resumed.jobId, jobId);
      await service.managePublisherCrawl({ id, action: "resume" }, enqueue);
      assert.equal(
        (await service.getPublisherCrawls()).crawls[0].jobId,
        resumed.jobId,
      );
      await queue.manageScrapeQueue({ paused: false });
      await queue.wait(resumed.jobId);
      assert.deepEqual(warmed, [pending.url, failed.url]);
      assert.equal(
        (await service.getPublisherCrawls()).crawls[0].status,
        "completed",
      );
    });
  }
});

test("manual publisher runs discover all series, retain checkpoints, distinguish new books/new series and enforce admin gates", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  let categories = [{ title: "One", url: "https://yenpress.com/series/one" }];
  let count = 1;
  const warmed = [];
  const catalogs = {
    [CATALOG_CRAWLER]: {
      sources: [{ id: "yenpress", name: "Yen Press", full: true }],
      warm: async (_id, item) => warmed.push(item.url),
    },
    getSeriesCategories: async () => ({ categories }),
    getPublisherCatalog: async ({ url }) => ({
      complete: true,
      items: Array.from({ length: count }, (_, i) => ({
        url: `https://yenpress.com/titles/9780316769488-${url.split("/").at(-1)}-${i}`,
        title: `Volume ${i}`,
        isbn: "9780316769488",
      })),
    }),
  };
  const service = createPublisherCrawls(store, catalogs);
  assert.deepEqual((await service.getPublisherCrawls()).crawls, []);
  async function run(mode) {
    const { id } = await service.startPublisherCrawl(
      { publisherId: "yenpress", mode },
      async () => crypto.randomUUID(),
    );
    await service.crawlPublisher({ id });
    return (await service.getPublisherCrawls()).crawls.find((c) => c.id === id);
  }
  assert.equal((await run("all")).status, "completed");
  assert.equal(warmed.length, 1);
  count = 2;
  await run("new");
  assert.equal(warmed.length, 2, "only the newly discovered volume is warmed");
  await run("new-series");
  assert.equal(warmed.length, 2);
  categories.push({ title: "Two", url: "https://yenpress.com/series/two" });
  await run("new-series");
  assert.equal(warmed.length, 4);
  const active = await service.startPublisherCrawl(
    { publisherId: "yenpress", mode: "all" },
    async () => "job",
  );
  await assert.rejects(
    service.startPublisherCrawl(
      { publisherId: "yenpress", mode: "new" },
      async () => "job",
    ),
    { status: 409 },
  );
  await service.managePublisherCrawl({ id: active.id, action: "pause" });
  assert.equal((await service.getPublisherCrawls()).crawls[0].status, "paused");
  await service.managePublisherCrawl({ id: active.id, action: "cancel" });
  const user = await createAccount(store, "reader", "reader@gmail.com");
  await store.forUser(user, async () => {
    await assert.rejects(service.getPublisherCrawls(), { status: 403 });
    await assert.rejects(
      service.startPublisherCrawl(
        { publisherId: "yenpress", mode: "all" },
        async () => "job",
      ),
      { status: 403 },
    );
  });
});

test("running background work stops at the next request for user lookups, reserves a foreground slot and can be cancelled while paused", async (t) => {
  const store = await openTestStore();
  let first, release, userStarted, finishUser;
  const firstRequest = new Promise((r) => (first = r)),
    gate = new Promise((r) => (release = r));
  const userRequest = new Promise((r) => (userStarted = r)),
    userGate = new Promise((r) => (finishUser = r));
  let remote = 0;
  const crawlId = crypto.randomUUID();
  await store.db
    .prepare(
      "INSERT INTO publisher_crawls(id,publisher_id,mode,status,user_id,created_at,updated_at) VALUES (?,'yenpress','all','running',1,?,?)",
    )
    .run(crawlId, Date.now(), Date.now());
  const queue = createScrapeQueue(store, {
    crawlPublisher: async () => {
      await backgroundRequest("https://yenpress.com/one", async () => {
        remote++;
        first();
        await gate;
      });
      await backgroundRequest("https://yenpress.com/two", async () => {
        remote++;
      });
      await scrapeCheckpoint();
    },
    lookup: async () => {
      userStarted();
      await userGate;
      return "user result";
    },
  });
  t.after(async () => {
    release();
    finishUser();
    await store.close();
  });
  const jobId = await queue.enqueue(
    "crawlPublisher",
    { id: crawlId },
    "Background",
    -100,
  );
  await store.db
    .prepare("UPDATE publisher_crawls SET job_id=? WHERE id=?")
    .run(jobId, crawlId);
  await queue.tick();
  await firstRequest;
  const user = queue.run("lookup", null, "Unknown ISBN");
  await userRequest;
  release();
  await delay(300);
  assert.equal(
    remote,
    1,
    "background makes no further requests while a user lookup is running",
  );
  finishUser();
  assert.equal(await user, "user result");
  await store.db
    .prepare("UPDATE publisher_crawls SET status='paused' WHERE id=?")
    .run(crawlId);
  await store.db
    .prepare("UPDATE publisher_request_slots SET available_at=0")
    .run();
  await delay(300);
  assert.equal(remote, 1);
  await store.db
    .prepare("UPDATE publisher_crawls SET status='cancelled' WHERE id=?")
    .run(crawlId);
});
