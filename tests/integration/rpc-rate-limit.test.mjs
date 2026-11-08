import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { testDatabaseUrl } from "../helpers/database.mjs";
import { getApp } from "../../lib/server/app.ts";
import { SESSION_COOKIE, signInWithGoogle } from "../../lib/server/auth.ts";
import { RPC_LIMITS } from "../../lib/server/rate-limit.ts";
import { PUBLISHERS } from "../../lib/domain/constants.ts";
import { POST } from "../../app/api/rpc/route.ts";

test("RPC budgets allow normal refresh bursts while still bounding abuse", async (t) => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = await testDatabaseUrl();
  const { store, api } = await getApp();
  t.after(async () => {
    await store.close();
    delete globalThis.__bookCollectionApp;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });
  const alice = await signInWithGoogle(store, {
    sub: "rpc-alice",
    email: "rpc-alice@gmail.com",
    email_verified: true,
  });
  const bob = await signInWithGoogle(store, {
    sub: "rpc-bob",
    email: "rpc-bob@gmail.com",
    email_verified: true,
  });
  const request = (login, name = "getCollection", arg) =>
    new NextRequest("https://books.example/api/rpc", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${login.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, arg }),
    });

  await t.test(
    "overlapping publisher refreshes fit, excess work stays account-scoped",
    async (t) => {
      const gate = Promise.withResolvers();
      const observed = Promise.withResolvers();
      let arrived = 0;
      let entered = 0;
      const observe = () => {
        if (++arrived === RPC_LIMITS.concurrentRequests) observed.resolve();
      };
      t.mock.method(api, "getPublisherReleases", async () => {
        if (store.currentUser().id === alice.user.id) {
          entered++;
          observe();
          await gate.promise;
        }
        return { items: [] };
      });
      // Each releases page requests every publisher at once. Hold several page
      // loads open to model an old refresh still running when a new one starts.
      const pending = Array.from(
        { length: RPC_LIMITS.concurrentRequests },
        (_, index) =>
          POST(
            request(alice, "getPublisherReleases", {
              publisherId: PUBLISHERS[index % PUBLISHERS.length].id,
            }),
          ).then((response) => {
            if (!response.ok) observe();
            return response;
          }),
      );
      let responses;
      try {
        // Observe both admitted and rejected calls so a regression fails instead
        // of waiting forever for rejected calls to enter the application method.
        await observed.promise;
        assert.equal(entered, RPC_LIMITS.concurrentRequests);
        assert.equal(
          (await POST(request(alice, "getPublisherReleases"))).status,
          429,
        );
        assert.equal(
          (await POST(request(bob, "getPublisherReleases"))).status,
          200,
        );
      } finally {
        gate.resolve();
        responses = await Promise.all(pending);
      }
      assert.ok(responses.every((response) => response.status === 200));
      assert.equal(
        (await POST(request(alice, "getPublisherReleases"))).status,
        200,
        "completed refreshes release their slots",
      );
    },
  );

  await t.test(
    "minute budgets have refresh headroom, expire, and remain account-scoped",
    async (t) => {
      t.mock.method(api, "getCollection", async () => ({ books: [] }));
      const setBudget = (attempts, resetsAt = Date.now() + 60_000) =>
        store.db
          .prepare(
            `INSERT INTO request_limits (key,attempts,resets_at) VALUES (?,?,?)
           ON CONFLICT(key) DO UPDATE SET attempts=EXCLUDED.attempts,resets_at=EXCLUDED.resets_at`,
          )
          .run(`rpc:${alice.user.id}`, attempts, resetsAt);

      await setBudget(240);
      assert.equal((await POST(request(alice))).status, 200);
      await setBudget(RPC_LIMITS.requestsPerMinute - 1);
      assert.equal((await POST(request(alice))).status, 200);
      assert.equal((await POST(request(alice))).status, 429);
      assert.equal((await POST(request(bob))).status, 200);
      await setBudget(RPC_LIMITS.requestsPerMinute, 0);
      assert.equal((await POST(request(alice))).status, 200);
    },
  );
});
