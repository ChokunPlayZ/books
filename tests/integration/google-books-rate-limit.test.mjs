import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";

test("Google Books request budgets are atomic across pools, accounts and service restarts", async (t) => {
  const key = randomUUID();
  const first = await openTestStore(key);
  const second = await openTestStore(key);
  const stores = new Set([first, second]);
  t.after(() => Promise.all([...stores].map((store) => store.close())));
  const alice = await createAccount(
    first,
    "limit-alice",
    "limit-alice@gmail.com",
  );
  const bob = await createAccount(second, "limit-bob", "limit-bob@gmail.com");
  const claims = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? first : second).forUser(i % 2 ? alice : bob, () =>
        (i % 2 ? first : second).cache.claimRateLimit(
          "google-books:test",
          5,
          60_000,
        ),
      ),
    ),
  );
  assert.equal(claims.filter((delay) => delay === 0).length, 5);
  assert.ok(
    claims.filter(Boolean).every((delay) => delay > 0 && delay <= 60_000),
  );
  await first.close();
  stores.delete(first);
  const restarted = await openTestStore(key);
  stores.add(restarted);
  assert.ok(
    (await restarted.cache.claimRateLimit("google-books:test", 5, 60_000)) > 0,
  );
  await second.db
    .prepare("UPDATE request_limits SET resets_at=? WHERE key=?")
    .run(Date.now() - 1, "google-books:test");
  assert.equal(
    await restarted.cache.claimRateLimit("google-books:test", 5, 60_000),
    0,
  );
});
