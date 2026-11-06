import test from "node:test";
import assert from "node:assert/strict";
import {
  errorResponse,
  readBody,
  readJson,
  sameOrigin,
} from "../../lib/server/http.ts";
import { AppError } from "../../lib/server/store.ts";
import { openTestStore as openStore } from "../helpers/database.mjs";
import {
  enforceRateLimit,
  limitConcurrentRequests,
} from "../../lib/server/rate-limit.ts";

test("writes compare complete canonical origins, not attacker-controlled hosts", async () => {
  const old = process.env.BOOKS_APP_URL;
  process.env.BOOKS_APP_URL = "https://books.example.org";
  const request = (headers) =>
    new Request("http://internal:3000/api/rpc", { method: "POST", headers });
  try {
    sameOrigin(await request({ Origin: "https://books.example.org" }));
    sameOrigin(await request({}));
    for (const origin of [
      "http://books.example.org",
      "https://evil.test",
      "null",
      "not a URL",
      "https://books.example.org:3000",
    ])
      await assert.rejects(
        async () =>
          sameOrigin(
            await request({
              Origin: origin,
              Host: new URL("https://evil.test").host,
            }),
          ),
        { status: 403 },
      );
    await assert.rejects(
      async () => sameOrigin(await request({ "Sec-Fetch-Site": "cross-site" })),
      { status: 403 },
    );
    await assert.rejects(
      async () => sameOrigin(await request({ "Sec-Fetch-Site": "same-site" })),
      { status: 403 },
    );
  } finally {
    if (old === undefined) delete process.env.BOOKS_APP_URL;
    else process.env.BOOKS_APP_URL = old;
  }
});

test("unexpected errors never leak internal messages to public clients", async (t) => {
  t.mock.method(console, "error", () => {});
  const response = await errorResponse(
    new Error("PostgreSQL /private/secret.sqlite token=secret"),
  );
  assert.equal(response.status, 500);
  assert.equal(
    (await response.json()).message,
    "The request failed. Please try again.",
  );
  assert.equal(
    (await errorResponse({ status: 200, message: "forged" })).status,
    500,
  );
  assert.equal(
    (await errorResponse(new AppError("Not allowed", 403))).status,
    403,
  );
  assert.equal(
    (await errorResponse(new SyntaxError("internal syntax details"))).status,
    400,
  );
});

test("JSON and streaming body limits reject malformed, oversized and non-object requests", async () => {
  const request = (body, contentType = "application/json") =>
    new Request("https://books.example.org", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
  for (const body of ["null", "[]", "1", '"string"'])
    await assert.rejects(readJson(await request(body)), { status: 400 });
  await assert.rejects(readJson(await request("{}", "application/jsonp")), {
    status: 415,
  });
  await assert.rejects(readBody(await request("12345"), 4), { status: 413 });
  const streaming = new Request("https://books.example.org", {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      async start(controller) {
        controller.enqueue(new Uint8Array(5));
        await controller.close();
      },
    }),
  });
  await assert.rejects(readBody(streaming, 4), { status: 413 });
  assert.deepEqual(await readJson(await request('{"name":"getCollection"}')), {
    name: "getCollection",
  });
});

test("persistent request budgets are account-scoped and expired counters are removed", async (t) => {
  const store = await openStore();
  t.after(async () => await store.close());
  await enforceRateLimit(store, "rpc:1", 2, 60000);
  await enforceRateLimit(store, "rpc:1", 2, 60000);
  await assert.rejects(
    async () => await enforceRateLimit(store, "rpc:1", 2, 60000),
    {
      status: 429,
    },
  );
  await enforceRateLimit(store, "rpc:2", 2, 60000);
  await store.db.exec("UPDATE request_limits SET resets_at=0");
  await enforceRateLimit(store, "rpc:1", 2, 60000);
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM request_limits").get())
      .n,
    1,
  );
});

test("concurrent work is bounded per account and slots are released on failure", async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const pending = Array.from({ length: 4 }, () =>
    limitConcurrentRequests(1, () => blocked),
  );
  await assert.rejects(
    limitConcurrentRequests(1, async () => {}),
    { status: 429 },
  );
  await limitConcurrentRequests(2, async () => {});
  release();
  await Promise.all(pending);
  await assert.rejects(
    limitConcurrentRequests(1, async () => {
      throw new Error("failure");
    }),
  );
  await limitConcurrentRequests(1, async () => {});
});
