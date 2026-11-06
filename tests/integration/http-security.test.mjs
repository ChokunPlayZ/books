import test from "node:test";
import assert from "node:assert/strict";
import {
  errorResponse,
  readBody,
  readJson,
  sameOrigin,
} from "../../lib/server/http.ts";
import { openStore, AppError } from "../../lib/server/store.ts";
import {
  enforceRateLimit,
  limitConcurrentRequests,
} from "../../lib/server/rate-limit.ts";

test("writes compare complete canonical origins, not attacker-controlled hosts", () => {
  const old = process.env.BOOKS_APP_URL;
  process.env.BOOKS_APP_URL = "https://books.example.org";
  const request = (headers) =>
    new Request("http://internal:3000/api/rpc", { method: "POST", headers });
  try {
    sameOrigin(request({ Origin: "https://books.example.org" }));
    sameOrigin(request({}));
    for (const origin of [
      "http://books.example.org",
      "https://evil.test",
      "null",
      "not a URL",
      "https://books.example.org:3000",
    ])
      assert.throws(
        () =>
          sameOrigin(
            request({
              Origin: origin,
              Host: new URL("https://evil.test").host,
            }),
          ),
        { status: 403 },
      );
    assert.throws(
      () => sameOrigin(request({ "Sec-Fetch-Site": "cross-site" })),
      { status: 403 },
    );
    assert.throws(
      () => sameOrigin(request({ "Sec-Fetch-Site": "same-site" })),
      { status: 403 },
    );
  } finally {
    if (old === undefined) delete process.env.BOOKS_APP_URL;
    else process.env.BOOKS_APP_URL = old;
  }
});

test("unexpected errors never leak internal messages to public clients", async (t) => {
  t.mock.method(console, "error", () => {});
  const response = errorResponse(
    new Error("SQLite /private/secret.sqlite token=secret"),
  );
  assert.equal(response.status, 500);
  assert.equal(
    (await response.json()).message,
    "The request failed. Please try again.",
  );
  assert.equal(errorResponse({ status: 200, message: "forged" }).status, 500);
  assert.equal(errorResponse(new AppError("Not allowed", 403)).status, 403);
  assert.equal(
    errorResponse(new SyntaxError("internal syntax details")).status,
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
    await assert.rejects(readJson(request(body)), { status: 400 });
  await assert.rejects(readJson(request("{}", "application/jsonp")), {
    status: 415,
  });
  await assert.rejects(readBody(request("12345"), 4), { status: 413 });
  const streaming = new Request("https://books.example.org", {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    }),
  });
  await assert.rejects(readBody(streaming, 4), { status: 413 });
  assert.deepEqual(await readJson(request('{"name":"getCollection"}')), {
    name: "getCollection",
  });
});

test("persistent request budgets are account-scoped and expired counters are removed", (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  enforceRateLimit(store, "rpc:1", 2, 60000);
  enforceRateLimit(store, "rpc:1", 2, 60000);
  assert.throws(() => enforceRateLimit(store, "rpc:1", 2, 60000), {
    status: 429,
  });
  enforceRateLimit(store, "rpc:2", 2, 60000);
  store.db.exec("UPDATE request_limits SET resets_at=0");
  enforceRateLimit(store, "rpc:1", 2, 60000);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM request_limits").get().n,
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
