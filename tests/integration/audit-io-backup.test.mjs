import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { testDatabaseUrl } from "../helpers/database.mjs";
import { getApp } from "../../lib/server/app.ts";
import { SESSION_COOKIE, signInWithGoogle } from "../../lib/server/auth.ts";
import { limitConcurrentRequests } from "../../lib/server/rate-limit.ts";
import { GET } from "../../app/api/backup/route.ts";
import { createBackupDownload } from "../../lib/server/backup-download.ts";

test("audit IO: backup exports are account-rate-limited and share the import's aggregate memory slot", async (t) => {
  // Only a random schema in BOOKS_TEST_DATABASE_URL is used, never a configured
  // application database. This file runs in its own Node test process.
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = await testDatabaseUrl();
  const { store } = await getApp();
  t.after(async () => {
    await store.close();
    delete globalThis.__bookCollectionApp;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });
  const alice = await signInWithGoogle(store, {
    sub: "audit-backup-alice",
    email: "audit-backup-alice@gmail.com",
    email_verified: true,
  });
  const bob = await signInWithGoogle(store, {
    sub: "audit-backup-bob",
    email: "audit-backup-bob@gmail.com",
    email_verified: true,
  });
  const request = (login) =>
    new NextRequest("https://books.example/api/backup", {
      headers: { Cookie: `${SESSION_COOKIE}=${login.token}` },
    });
  let start, release;
  const started = new Promise((resolve) => {
    start = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let exports = 0;
  t.mock.method(store, "exportData", async () => {
    exports++;
    start();
    await blocked;
    return { format: "book-collection", version: 1, books: [], covers: [] };
  });
  const first = GET(request(alice));
  try {
    await started;
    assert.equal((await GET(request(alice))).status, 429);
    assert.equal((await GET(request(bob))).status, 429);
    assert.equal(
      exports,
      1,
      "concurrent exports never allocate another backup",
    );
  } finally {
    release();
  }
  const response = await first;
  assert.equal(response.status, 200);
  assert.equal(
    (await GET(request(alice))).status,
    429,
    "a slow, unread download retains the aggregate slot",
  );
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(
    response.headers.get("Content-Disposition"),
    /^attachment; filename="meemai-/,
  );
  assert.equal((await response.json()).format, "book-collection");
  await limitConcurrentRequests(
    0,
    async () => {
      assert.equal(
        (await GET(request(alice))).status,
        429,
        "an active upload also blocks a backup",
      );
    },
    1,
  );
  await store.db
    .prepare("UPDATE request_limits SET attempts=20 WHERE key=?")
    .run(`backup:${alice.user.id}`);
  assert.equal((await GET(request(alice))).status, 429);
  assert.equal(exports, 1);
});

test("audit IO: cancelled backups release their slots and streamed UTF-8 never splits surrogate pairs", async () => {
  const prefix = '{\n  "value": "';
  const data = {
    value: "x".repeat(32767 - prefix.length) + "🍣" + "y".repeat(40000),
  };
  const store = {
    forUser: (_user, action) => action(),
    exportData: async () => data,
  };
  const user = { id: 99117 };
  const cancelled = await createBackupDownload(store, user, undefined, {});
  await assert.rejects(createBackupDownload(store, user, undefined, {}), {
    status: 429,
  });
  await cancelled.body.cancel();
  await new Promise(setImmediate);
  const response = await createBackupDownload(store, user, undefined, {});
  assert.deepEqual(await response.json(), data);
});
