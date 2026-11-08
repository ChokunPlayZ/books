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
  await queue.enqueue("crawlPublisher", { id: crawlId }, "Background", -100);
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
