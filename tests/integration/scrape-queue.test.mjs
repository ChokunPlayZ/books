import test from "node:test";
import assert from "node:assert/strict";
import { openTestStore } from "../helpers/database.mjs";
import { createScrapeQueue } from "../../lib/server/scrape-queue.ts";
import { createAccount } from "../../lib/server/auth.ts";
import { AppError } from "../../lib/server/store.ts";
import {
  recordScrapeError,
  httpFailure,
} from "../../lib/server/scrape-diagnostics.ts";

async function setup(t, handlers, key) {
  const store = await openTestStore(key);
  const queue = createScrapeQueue(store, handlers);
  t.after(() => store.close());
  return { store, queue };
}

test("durable jobs deduplicate queued and running work and record inspectable results", async (t) => {
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  let calls = 0;
  const { queue } = await setup(t, {
    scrape: async (arg) => {
      calls++;
      started.resolve();
      await gate.promise;
      return { title: arg.title };
    },
  });
  const ids = await Promise.all(
    Array.from({ length: 8 }, () =>
      queue.enqueue("scrape", { title: "A" }, "Scrape A"),
    ),
  );
  assert.equal(new Set(ids).size, 1);
  await queue.tick();
  await started.promise;
  assert.equal(
    await queue.enqueue("scrape", { title: "A" }, "Scrape A"),
    ids[0],
  );
  gate.resolve();
  assert.deepEqual(await queue.wait(ids[0]), { title: "A" });
  assert.equal(calls, 1);
  const detail = await queue.getScrapeJob({ id: ids[0] });
  assert.equal(detail.status, "succeeded");
  assert.equal(detail.attempts, 1);
  assert.deepEqual(detail.payload, { title: "A" });
  assert.ok(detail.events.some((e) => e.message === "Completed"));
  await assert.rejects(queue.enqueue("unknown", {}, "Bad"));
});

test("pause, fast-track, cancel and requeue are durable and do not bypass cooldown scheduling", async (t) => {
  const order = [];
  const { queue, store } = await setup(t, {
    scrape: async ({ n }) => {
      order.push(n);
      return n;
    },
  });
  await queue.manageScrapeQueue({ paused: true });
  const first = await queue.enqueue("scrape", { n: 1 }, "First");
  const fast = await queue.enqueue("scrape", { n: 2 }, "Fast");
  const cancelled = await queue.enqueue("scrape", { n: 3 }, "Cancelled");
  await queue.manageScrapeJob({ id: fast, action: "fasttrack" });
  await queue.manageScrapeJob({ id: cancelled, action: "cancel" });
  await queue.tick();
  assert.deepEqual(order, []);
  assert.equal(
    (await queue.getScrapeJob({ id: cancelled })).status,
    "cancelled",
  );
  await assert.rejects(
    queue.manageScrapeJob({ id: cancelled, action: "fasttrack" }),
    { status: 409 },
  );
  const before = Date.now() + 900_000;
  await store.db
    .prepare("UPDATE scrape_jobs SET available_at=? WHERE id=?")
    .run(before, first);
  await queue.manageScrapeJob({ id: first, action: "fasttrack" });
  assert.equal((await queue.getScrapeJob({ id: first })).availableAt, before);
  await queue.manageScrapeQueue({ paused: false });
  assert.equal(await queue.wait(fast), 2);
  assert.deepEqual(order, [2]);
  const retry = await queue.manageScrapeJob({ id: cancelled, action: "retry" });
  assert.notEqual(retry.id, cancelled);
  assert.equal(await queue.wait(retry.id), 3);
  assert.ok(
    (await queue.getScrapeJob({ id: retry.id })).events.some((e) =>
      e.message.includes(cancelled),
    ),
  );
});

test("multiple pools share a global concurrency bound and priority ordering", async (t) => {
  const key = crypto.randomUUID();
  const gate = Promise.withResolvers();
  const twoStarted = Promise.withResolvers();
  const order = [];
  let running = 0,
    peak = 0;
  const handlers = {
    scrape: async ({ n }) => {
      order.push(n);
      running++;
      peak = Math.max(peak, running);
      if (order.length === 2) twoStarted.resolve();
      await gate.promise;
      running--;
      return n;
    },
  };
  const a = await setup(t, handlers, key);
  const b = await setup(t, handlers, key);
  const first = await a.queue.enqueue("scrape", { n: 1 }, "First");
  const second = await a.queue.enqueue("scrape", { n: 2 }, "Second");
  const fast = await a.queue.enqueue("scrape", { n: 3 }, "Fast");
  await a.queue.manageScrapeJob({ id: fast, action: "fasttrack" });
  await Promise.all([a.queue.tick(), b.queue.tick()]);
  await twoStarted.promise;
  assert.equal(peak, 2);
  assert.ok(order.includes(3));
  assert.ok(!order.includes(2));
  await assert.rejects(
    a.queue.manageScrapeJob({ id: fast, action: "cancel" }),
    { status: 409 },
  );
  gate.resolve();
  await Promise.all([
    a.queue.wait(first),
    a.queue.wait(second),
    a.queue.wait(fast),
  ]);
  assert.equal(peak, 2);
});

test("restart recovery retries expired leases and never reclaims a healthy running worker", async (t) => {
  const key = crypto.randomUUID();
  const first = await openTestStore(key);
  const before = createScrapeQueue(first, { scrape: async () => null });
  const id = await before.enqueue("scrape", {}, "Recover me");
  await first.db
    .prepare(
      "UPDATE scrape_jobs SET status='running',attempts=1,lease_token='old',lease_until=? WHERE id=?",
    )
    .run(Date.now() - 100, id);
  await first.close();
  let calls = 0;
  const { queue } = await setup(
    t,
    {
      scrape: async () => {
        calls++;
        return "recovered";
      },
    },
    key,
  );
  assert.equal(await queue.wait(id), "recovered");
  const detail = await queue.getScrapeJob({ id });
  assert.equal(detail.attempts, 2);
  assert.equal(calls, 1);
  assert.ok(detail.events.some((e) => /interrupted/.test(e.message)));
});

test("failed tasks back off, stop at the attempt limit, and keep stale source results inspectable", async (t) => {
  const { queue, store } = await setup(t, {
    scrape: async () => {
      throw new Error("offline");
    },
    invalid: async () => {
      throw new AppError("Invalid target.");
    },
    stale: async () => ({ stale: true, items: [{ title: "Previous data" }] }),
  });
  const id = await queue.enqueue("scrape", {}, "Offline");
  await queue.tick();
  // Drain the active handler without starting scheduled retries.
  await queue.stop();
  const retry = await queue.getScrapeJob({ id });
  assert.equal(retry.status, "queued");
  assert.equal(retry.attempts, 1);
  assert.ok(retry.availableAt > Date.now() + 800_000);
  const next = createScrapeQueue(store, {
    scrape: async () => {
      throw new Error("offline");
    },
    invalid: async () => {
      throw new AppError("Invalid target.");
    },
    stale: async () => ({ stale: true, items: [{ title: "Previous data" }] }),
  });
  await store.db
    .prepare(
      "UPDATE scrape_jobs SET attempts=max_attempts-1,available_at=? WHERE id=?",
    )
    .run(Date.now() - 1, id);
  await assert.rejects(next.wait(id), /offline/);
  assert.equal((await next.getScrapeJob({ id })).status, "failed");
  const invalid = await next.enqueue("invalid", {}, "Bad target");
  await assert.rejects(next.wait(invalid), /Invalid target/);
  assert.equal((await next.getScrapeJob({ id: invalid })).attempts, 1);
  const stale = await next.enqueue("stale", {}, "Stale result");
  assert.equal((await next.wait(stale)).items[0].title, "Previous data");
  assert.equal((await next.getScrapeJob({ id: stale })).status, "failed");
});

test("ordinary accounts cannot inspect/manage jobs and workers recheck roles and ownership", async (t) => {
  const { queue, store } = await setup(t, {
    admin: async () => {
      store.requireAdmin();
      return "privileged";
    },
    owner: async () => store.currentUser().id,
  });
  const user = await createAccount(store, "reader", "reader@gmail.com");
  const job = await queue.enqueue("admin", {}, "Admin operation");
  await store.forUser(user, async () => {
    for (const operation of [
      () => queue.getScrapeQueue(),
      () => queue.getScrapeJob({ id: job }),
      () => queue.manageScrapeQueue({ paused: true }),
      () => queue.manageScrapeJob({ id: job, action: "cancel" }),
    ])
      await assert.rejects(operation(), { status: 403 });
    await assert.rejects(queue.wait(job), { status: 404 });
    const own = await queue.enqueue("owner", {}, "Reader operation");
    assert.equal(await queue.wait(own), user.id);
  });
  // A queued administrator operation must not retain authority after demotion.
  const privileged = await queue.enqueue(
    "admin",
    { next: true },
    "Admin operation after demotion",
  );
  await store.db.prepare("UPDATE users SET role='user' WHERE id=1").run();
  await assert.rejects(queue.wait(privileged), /Only an administrator/);
});

test("fallback results keep exact source errors in queue summaries and permanent attempt history", async (t) => {
  const url = "https://www.phoenixnext.com/catalogsearch/result/?q=Moon";
  const { queue } = await setup(t, {
    scrape: async () => {
      recordScrapeError(httpFailure(url, 429));
      return { stale: true, items: [{ title: "Previous data" }] };
    },
  });
  const id = await queue.enqueue("scrape", {}, "Rate limited lookup");
  assert.equal((await queue.wait(id)).items[0].title, "Previous data");
  const job = await queue.getScrapeJob({ id });
  assert.equal(job.status, "failed");
  assert.match(job.error, /HTTP 429 \(Too Many Requests\)/);
  assert.ok(job.error.includes(url));
  assert.ok(
    job.events.some(
      (event) =>
        event.message.includes("HTTP 429") && event.message.includes(url),
    ),
  );
});

test("automatic retries preserve each attempt's cause instead of overwriting its history", async (t) => {
  const { queue, store } = await setup(t, {
    scrape: async () => {
      throw new Error("First attempt: DNS ENOTFOUND");
    },
  });
  const id = await queue.enqueue("scrape", {}, "Retry diagnostics");
  await queue.tick();
  await queue.stop();
  const retry = createScrapeQueue(store, {
    scrape: async () => {
      throw new Error("Second attempt: HTTP 503");
    },
  });
  await store.db
    .prepare(
      "UPDATE scrape_jobs SET attempts=max_attempts-1,available_at=? WHERE id=?",
    )
    .run(Date.now() - 1, id);
  await assert.rejects(retry.wait(id), /HTTP 503/);
  const job = await retry.getScrapeJob({ id });
  assert.ok(
    job.events.some((event) => event.message.includes("DNS ENOTFOUND")),
  );
  assert.ok(job.events.some((event) => event.message.includes("HTTP 503")));
});
