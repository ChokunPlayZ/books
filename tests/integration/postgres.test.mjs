import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../../lib/server/store.ts";
import { createAccount } from "../../lib/server/auth.ts";
import { testDatabaseUrl } from "../helpers/database.mjs";

const book = {
  series: "PostgreSQL concurrency",
  type: "Manga",
  status: "Read",
  isbn: "9780140328721",
};
const request = (extra = {}) => ({ requestId: randomUUID(), book, ...extra });

test("separate pools coalesce receipts, reject duplicate ISBNs and stale edits atomically", async (t) => {
  const url = await testDatabaseUrl();
  const [first, second] = await Promise.all([openStore(url), openStore(url)]);
  t.after(async () => {
    await first.close();
    await second.close();
  });
  const change = request();
  const results = await Promise.all([
    first.api.saveBook(change),
    second.api.saveBook(change),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await first.api.getCollection()).books.length, 1);
  const duplicate = await Promise.allSettled([
    first.api.saveBook(request()),
    second.api.saveBook(request()),
  ]);
  assert.ok(
    duplicate.every(
      (result) => result.status === "rejected" && result.reason.status === 409,
    ),
  );
  const original = (await first.api.getCollection()).books[0];
  const edits = await Promise.allSettled([
    first.api.saveBook(
      request({ ...original, book: { ...original, note: "first" } }),
    ),
    second.api.saveBook(
      request({ ...original, book: { ...original, note: "second" } }),
    ),
  ]);
  assert.equal(
    edits.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    edits.find((result) => result.status === "rejected").reason.status,
    409,
  );
});

test("PostgreSQL enforces case-insensitive account names and keeps millisecond expiries numeric", async (t) => {
  const store = await openStore(await testDatabaseUrl());
  t.after(() => store.close());
  await createAccount(store, "Reader", "reader@gmail.com");
  await assert.rejects(createAccount(store, "reader", "other@gmail.com"), {
    status: 409,
  });
  await store.cache.put("epoch-test", "value", 60);
  const row = await store.db
    .prepare("SELECT expires_at FROM cache WHERE key=?")
    .get("epoch-test");
  assert.equal(typeof row.expires_at, "number");
  assert.ok(row.expires_at > Date.now());
  assert.equal(await store.cache.get("epoch-test"), "value");
});

test("missing or SQLite connection strings fail with an actionable error", async () => {
  await assert.rejects(openStore(""), /DATABASE_URL.*PostgreSQL/);
  await assert.rejects(
    openStore("./data/books.sqlite"),
    /DATABASE_URL.*PostgreSQL/,
  );
});
