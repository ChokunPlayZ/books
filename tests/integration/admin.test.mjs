import test from "node:test";
import assert from "node:assert/strict";
import { openTestStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import { createAdminService } from "../../lib/server/admin.ts";
import { createApplicationApi } from "../../lib/server/api.ts";

test("admin inspection spans all libraries but never returns account credentials", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const user = await createAccount(store, "reader", "reader@gmail.com");
  await store.db
    .prepare(
      "UPDATE users SET password_hash='secret-hash',google_subject='secret-subject' WHERE id=?",
    )
    .run(user.id);
  await store.forUser(user, async () => {
    await store.api.saveBook({
      requestId: crypto.randomUUID(),
      book: {
        series: "Private reader book",
        type: "Other",
        status: "Read",
        note: "Private reader note",
      },
    });
    await store.cache.put(
      "series:v1:reader",
      JSON.stringify({ series: "Private reader alias" }),
      3600,
    );
  });
  const admin = createAdminService(store);
  assert.equal((await admin.getSystemOverview()).counts.users, 2);
  const records = await admin.getSystemRecords({
    resource: "books",
    search: "private reader",
    confirmed: true,
  });
  assert.equal(records.total, 1);
  assert.equal(records.rows[0].user_id, user.id);
  const accounts = await admin.getSystemRecords({ resource: "users" });
  assert.ok(!JSON.stringify(accounts).includes("secret-hash"));
  assert.ok(!JSON.stringify(accounts).includes("secret-subject"));
  await assert.rejects(admin.getSystemRecords({ resource: "sessions" }));
  await assert.rejects(
    admin.getSystemRecords({ resource: "users;DROP TABLE books" }),
  );
  const api = createApplicationApi(store, {
    ensure: () => assert.fail("Admin inspection must not fetch covers"),
  });
  assert.ok(
    (await api.getMetadataOverview()).entries.some(
      (row) => row.key === `user:${user.id}:series:v1:reader`,
    ),
  );
  assert.match(
    (
      await api.getMetadataCacheEntry({
        key: `user:${user.id}:series:v1:reader`,
      })
    ).content,
    /Private reader alias/,
  );
  assert.deepEqual((await store.api.getCollection()).books, []);
  await store.forUser(user, async () => {
    for (const [name, arg] of [
      ["getSystemOverview"],
      ["getSystemRecords", { resource: "books" }],
      ["getScrapeQueue"],
      ["getScrapeJob", { id: "any" }],
      ["manageScrapeQueue", { paused: true }],
      ["manageScrapeJob", { id: "any", action: "fasttrack" }],
      ["enqueueMetadataRecrawl", { id: "any" }],
      [
        "enqueueScrapeTask",
        { kind: "lookupIsbn", arg: { isbn: "9780316769488" } },
      ],
      ["getMetadataCacheEntry", { key: `user:${user.id}:series:v1:reader` }],
    ])
      await assert.rejects(api[name](arg), { status: 403 });
  });
});

test("cache-only catalog calls stay immediate even when the scraping queue is paused", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const isbn = "9780316769488";
  await store.cache.put(
    `isbn:v15:${isbn}`,
    JSON.stringify({
      isbn,
      found: true,
      details: { title: "Cached book" },
      warnings: [],
    }),
    Infinity,
  );
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("No cover requested") },
    () => assert.fail("Cached metadata must not refetch"),
  );
  await api.manageScrapeQueue({ paused: true });
  const result = await api.lookupIsbn(isbn);
  assert.equal(result.details.title, "Cached book");
  const queue = await api.getScrapeQueue();
  assert.equal(queue.total, 0);
  const forced = await api.enqueueScrapeTask({
    kind: "lookupIsbn",
    arg: { isbn },
  });
  const pending = await api.getScrapeJob({ id: forced.id });
  assert.equal(pending.status, "queued");
  assert.equal(pending.payload.refresh, true);
});
