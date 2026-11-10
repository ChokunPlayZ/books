import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScraperDebugger } from "../../lib/server/scraper-debug.ts";
import { phoenix } from "../../lib/server/scrapers/phoenix.ts";
import { googleBooks } from "../../lib/server/scrapers/google-books.ts";
import { kinokuniya } from "../../lib/server/scrapers/kinokuniya.ts";
import { luckpim } from "../../lib/server/scrapers/luckpim.ts";
import { firstpage } from "../../lib/server/scrapers/firstpage.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { createScraperRegistry } from "../../lib/server/scrapers/registry.ts";
import {
  withScrapeDiagnostics,
  errorMessage,
} from "../../lib/server/scrape-diagnostics.ts";
import { digest } from "../../lib/domain/hash.ts";

const isbn = "9786164648357";
const request = { isbn, providerId: "phoenix" };
function memoryStore() {
  const values = new Map();
  return {
    requireAdmin() {},
    cache: {
      get: (key) => values.get(key) ?? null,
      put: (key, value) => values.set(key, value),
    },
    values,
  };
}

for (const status of [404, 403, 429, 503]) {
  test(`debug distinguishes HTTP ${status} from an empty search`, async () => {
    const debug = createScraperDebugger(
      memoryStore(),
      async () => new Response("Website error body", { status }),
      [phoenix],
    );
    const report = await debug.debugScraperIsbn(request);
    assert.equal(report.outcome, "failed");
    assert.match(report.error, new RegExp(`HTTP ${status}`));
    assert.match(report.error, /phoenixnext\.com\/catalogsearch/);
    assert.equal(report.diagnostics[0].kind, "http");
    assert.equal(report.diagnostics[0].status, status);
    assert.equal(report.diagnostics[0].sourceId, "phoenix");
    assert.equal(report.responses[0].body, "Website error body");
    assert.equal(report.responses[0].status, status);
  });
}

test("recognized no-results pages are not reported as website failures", async () => {
  const debug = createScraperDebugger(
    memoryStore(),
    async () => new Response('<div class="message info empty">Empty</div>'),
    [phoenix],
  );
  const report = await debug.debugScraperIsbn(request);
  assert.equal(report.outcome, "not_found");
  assert.equal(report.error, "");
  assert.equal(report.result, null);
  assert.ok(report.diagnostics.some((entry) => entry.kind === "not_found"));
  assert.ok(
    report.diagnostics.some((entry) =>
      /explicitly returned no results/.test(entry.message),
    ),
  );
  assert.match(report.message, /no matching results/i);
});

test("a known product URL returning 404 is an explicit provider miss", async () => {
  const debug = createScraperDebugger(
    memoryStore(),
    async () => new Response("Missing product", { status: 404 }),
    [kinokuniya],
  );
  const report = await debug.debugScraperIsbn({
    isbn,
    providerId: "kinokuniya",
  });
  assert.equal(report.outcome, "not_found");
  assert.equal(report.error, "");
  assert.equal(report.diagnostics[0].status, 404);
});

for (const [error, kind, detail] of [
  [
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND publisher"), {
        code: "ENOTFOUND",
      }),
    }),
    "dns",
    "ENOTFOUND",
  ],
  [
    new DOMException("The operation timed out", "TimeoutError"),
    "timeout",
    "timed out",
  ],
  [
    Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    "connection",
    "ECONNREFUSED",
  ],
  [
    Object.assign(new Error("certificate has expired"), {
      code: "CERT_HAS_EXPIRED",
    }),
    "tls",
    "CERT_HAS_EXPIRED",
  ],
]) {
  test(`debug reports ${kind} failures with their underlying cause and URL`, async () => {
    const debug = createScraperDebugger(
      memoryStore(),
      async () => {
        throw error;
      },
      [phoenix],
    );
    const report = await debug.debugScraperIsbn(request);
    assert.equal(report.outcome, "failed");
    assert.equal(report.diagnostics[0].kind, kind);
    assert.ok(report.error.includes(detail));
    assert.match(report.error, /phoenixnext\.com/);
    assert.equal(report.responses[0].status, null);
    assert.ok(report.responses[0].error.includes(detail));
  });
}

test("cooldowns retain the original HTTP failure across debugger instances", async () => {
  const store = memoryStore();
  await createScraperDebugger(
    store,
    async () => new Response("Down", { status: 503 }),
    [phoenix],
  ).debugScraperIsbn(request);
  const report = await createScraperDebugger(
    store,
    () => assert.fail("Cooldown must not fetch"),
    [phoenix],
  ).debugScraperIsbn(request);
  assert.equal(report.outcome, "failed");
  assert.match(report.error, /cooldown/i);
  assert.match(report.error, /HTTP 503/);
  assert.match(report.error, /phoenixnext\.com\/catalogsearch/);
  assert.equal(report.responses.length, 0);
  assert.equal(report.diagnostics[0].kind, "cooldown");
  assert.equal(report.diagnostics[0].status, 503);
});

test("unrecognized HTML is a parser failure, not a confirmed no-match", async () => {
  const debug = createScraperDebugger(
    memoryStore(),
    async () => new Response("<h1>A completely different page</h1>"),
    [phoenix],
  );
  const report = await debug.debugScraperIsbn(request);
  assert.equal(report.outcome, "failed");
  assert.match(report.error, /search could not be read/i);
  assert.equal(report.responses[0].status, 200);
  assert.equal(report.diagnostics[0].kind, "parser");
  assert.match(report.diagnostics[0].url, /catalogsearch/);
});

test("candidate verification failures retain the underlying product error through outer cooldowns", async () => {
  const store = memoryStore();
  const search = readFileSync(
    new URL(
      "../fixtures/publishers/firstpage-isbn-search.html",
      import.meta.url,
    ),
    "utf8",
  );
  const debugRequest = { isbn, providerId: "firstpage" };
  const failed = await createScraperDebugger(
    store,
    async (url) =>
      url.includes("/search?")
        ? new Response(search)
        : new Response("Down", { status: 503 }),
    [firstpage],
  ).debugScraperIsbn(debugRequest);
  assert.equal(failed.outcome, "failed");
  assert.match(failed.error, /HTTP 503/);
  const cooled = await createScraperDebugger(
    store,
    () => assert.fail("No request during cooldown"),
    [firstpage],
  ).debugScraperIsbn(debugRequest);
  assert.match(cooled.error, /cooldown/i);
  assert.match(cooled.error, /HTTP 503/);
  assert.match(cooled.error, /firstpagepro\.com\/(?!search)/);
});

test("legacy cooldowns explicitly say when the original cause is unknown", async () => {
  const store = memoryStore();
  store.cache.put(
    "scrape:v1:" + digest("source-book:v1:phoenix:" + isbn) + ":retry",
    "1",
  );
  const report = await createScraperDebugger(
    store,
    () => assert.fail("No requests during cooldown"),
    [phoenix],
  ).debugScraperIsbn(request);
  assert.equal(report.outcome, "failed");
  assert.match(report.error, /original failure was not recorded/);
  assert.equal(report.responses.length, 0);
});

test("invalid JSON reports a parser failure despite HTTP 200", async () => {
  const debug = createScraperDebugger(
    memoryStore(),
    async () => new Response("<h1>Not JSON</h1>"),
    [googleBooks],
  );
  const report = await debug.debugScraperIsbn({
    query: "Moon",
    providerId: "google-books",
  });
  assert.equal(report.outcome, "failed");
  assert.match(report.error, /invalid JSON/);
  assert.equal(report.diagnostics[0].kind, "parser");
  assert.equal(report.diagnostics[0].status, 200);
  assert.match(report.diagnostics[0].url, /googleapis/);
});

test("title debugger uses a fresh bounded publisher search, preserving Unicode and raw responses", async () => {
  const store = memoryStore();
  const query = "今日は Moon & Stars";
  const body = readFileSync(
    new URL(
      "../fixtures/publishers/phoenix-kyo-wa-search.html",
      import.meta.url,
    ),
    "utf8",
  );
  const calls = [];
  const debug = createScraperDebugger(
    store,
    async (url) => {
      calls.push(url);
      return new Response(body);
    },
    [phoenix],
  );
  for (let i = 0; i < 2; i++) {
    const report = await debug.debugScraperIsbn({
      query,
      providerId: "phoenix",
    });
    assert.equal(report.mode, "title");
    assert.equal(report.query, query);
    assert.equal(report.isbn, "");
    assert.equal(report.outcome, "found");
    assert.equal(report.error, "");
    assert.ok(report.result.items.length > 0);
    assert.equal(report.responses[0].body, body);
  }
  assert.deepEqual(
    calls,
    Array(2).fill(
      "https://www.phoenixnext.com/catalogsearch/result/?q=" +
        encodeURIComponent(query),
    ),
  );
  assert.equal(
    store.values.size,
    0,
    "Successful debug requests never change shared caches",
  );
});

test("title debugger exercises API title parsers and supports title-only providers", async () => {
  const debug = createScraperDebugger(
    memoryStore(),
    async (url) => {
      assert.match(url, /q=Moon%20%26%20Stars/);
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "moon",
              volumeInfo: { title: "Moon & Stars", language: "en" },
            },
          ],
        }),
      );
    },
    [googleBooks, luckpim, kinokuniya],
  );
  const providers = await debug.getScraperDebugSources();
  assert.deepEqual(
    providers.find((source) => source.id === "luckpim"),
    { id: "luckpim", name: "Luckpim", isbn: false, title: true },
  );
  assert.equal(
    providers.find((source) => source.id === "kinokuniya").title,
    false,
  );
  assert.deepEqual(
    debug.validateScraperDebug({ query: isbn, providerId: "luckpim" }),
    { query: isbn, providerId: "luckpim" },
    "Explicit title mode is honored even for numeric book names",
  );
  const report = await debug.debugScraperIsbn({
    query: "Moon & Stars",
    providerId: "google-books",
  });
  assert.equal(report.outcome, "found");
  assert.equal(report.result.items[0].title, "Moon & Stars");
  assert.throws(
    () =>
      debug.validateScraperDebug({ query: "Moon", providerId: "kinokuniya" }),
    /does not support title/,
  );
  for (const query of ["", "x", "x".repeat(201), 42])
    assert.throws(() =>
      debug.validateScraperDebug({ query, providerId: "google-books" }),
    );
});

test("parallel source diagnostics stay attached to the correct async context", async () => {
  const definitions = [phoenix, kinokuniya];
  const context = createScraperContext(
    memoryStore().cache,
    async () => new Response("Down", { status: 503 }),
    definitions,
  );
  const registry = createScraperRegistry(context, definitions);
  const phoenixLog = [],
    kinoLog = [];
  await Promise.all([
    withScrapeDiagnostics(phoenixLog, () =>
      assert.rejects(registry.require("phoenix").lookupIsbn(isbn)),
    ),
    withScrapeDiagnostics(kinoLog, () =>
      assert.rejects(registry.require("kinokuniya").lookupIsbn(isbn)),
    ),
  ]);
  assert.ok(phoenixLog.length > 0 && kinoLog.length > 0);
  assert.ok(phoenixLog.every((entry) => entry.sourceId === "phoenix"));
  assert.ok(kinoLog.every((entry) => entry.sourceId === "kinokuniya"));
});

test("error cause formatting tolerates cyclic causes", () => {
  const error = new Error("outer");
  error.cause = error;
  assert.equal(errorMessage(error), "outer");
});
