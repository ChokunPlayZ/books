import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { googleBooks } from "../../lib/server/scrapers/google-books.ts";
import { openLibrary } from "../../lib/server/scrapers/open-library.ts";
import { createScraperDebugger } from "../../lib/server/scraper-debug.ts";
import {
  GOOGLE_BOOKS_LIMITS,
  claimScraperRateLimit,
  observeGoogleBooksResponse,
} from "../../lib/server/scrapers/google-books-rate-limit.ts";

const isbnUrl =
  "https://www.googleapis.com/books/v1/volumes?q=isbn:9780140328721";
const titleUrl = "https://www.googleapis.com/books/v1/volumes?q=Matilda";
const now = Date.parse("2026-11-11T07:59:50Z"); // Still Nov 10 in Pacific time.
function memoryCache() {
  const values = new Map();
  return {
    values,
    get: (key) => values.get(key) || null,
    put: (key, value) => values.set(key, value),
  };
}

test("direct Google Books adapters also skip Thai and Japanese titles and ISBN-10/13 inputs", async () => {
  const source = googleBooks.create({
    fetchJson: () => assert.fail("Excluded lookups must never make requests"),
  });
  for (const query of ["ห้องสมุด Moon", "図書館", "進撃の巨人"])
    assert.deepEqual(await source.searchTitles(query), {
      items: [],
      complete: true,
    });
  for (const isbn of [
    "9786166247275",
    "9748585476",
    "9784063951370",
    "4063951375",
  ])
    assert.equal(await source.lookupIsbn(isbn), null);
});

test("Google Books title and ISBN requests share pacing across contexts; cached and unrelated requests do not wait", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const cache = memoryCache(),
    calls = [];
  const fetchImpl = async (url) => {
    calls.push({ url, at: Date.now() });
    return Response.json({});
  };
  const first = createScraperContext(cache, fetchImpl, [
    googleBooks,
    openLibrary,
  ]);
  const second = createScraperContext(cache, fetchImpl, [googleBooks]);
  await first.fetchJson(isbnUrl);
  const title = second.fetchJson(titleUrl);
  await setImmediate();
  assert.equal(calls.length, 1);
  await first.fetchJson(isbnUrl);
  await first.fetchJson("https://openlibrary.org/api/books");
  assert.equal(calls.length, 2);
  t.mock.timers.tick(GOOGLE_BOOKS_LIMITS.intervalMs - 1);
  await setImmediate();
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1);
  await title;
  assert.equal(calls[2].at - calls[0].at, GOOGLE_BOOKS_LIMITS.intervalMs);
  const refresh = first.fetchJson(isbnUrl, true);
  await setImmediate();
  assert.equal(calls.length, 3);
  t.mock.timers.tick(GOOGLE_BOOKS_LIMITS.intervalMs);
  await refresh;
  assert.equal(calls[3].at - calls[2].at, GOOGLE_BOOKS_LIMITS.intervalMs);
  assert.equal(
    JSON.parse(cache.values.get("request-limit:google-books:daily:2026-11-10"))
      .count,
    3,
  );
});

test("daily Google Books budget stops network requests, not cached data, and resets at Pacific midnight", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const cache = memoryCache();
  let calls = 0;
  const context = createScraperContext(cache, async () => {
    calls++;
    return Response.json({});
  }, [googleBooks]);
  await context.fetchJson(isbnUrl);
  for (let i = 1; i < GOOGLE_BOOKS_LIMITS.requestsPerDay; i++)
    assert.equal(
      await claimScraperRateLimit(
        cache,
        "google-books:daily:2026-11-10",
        GOOGLE_BOOKS_LIMITS.requestsPerDay,
        26 * 3600 * 1000,
      ),
      0,
    );
  t.mock.timers.tick(GOOGLE_BOOKS_LIMITS.intervalMs);
  await assert.rejects(context.requestRemote(titleUrl), /daily request budget/);
  assert.equal(calls, 1);
  await context.fetchJson(isbnUrl);
  assert.equal(calls, 1);
  t.mock.timers.tick(10_000);
  await context.requestRemote(titleUrl);
  assert.equal(calls, 2);
});

test("Google Books 429 and quota 403 responses block other queries and contexts without blocking other providers", async (t) => {
  for (const [status, body] of [
    [429, "Too many requests"],
    [403, '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}'],
  ]) {
    await t.test(String(status), async (t) => {
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
      const cache = memoryCache(),
        calls = [];
      const fetchImpl = async (url) => {
        calls.push(url);
        return new Response(body, {
          status,
          headers: { "retry-after": "1800" },
        });
      };
      const first = createScraperContext(cache, fetchImpl, [googleBooks]);
      await first.requestRemote(isbnUrl);
      const second = createScraperContext(cache, fetchImpl, [
        googleBooks,
        openLibrary,
      ]);
      await assert.rejects(second.requestRemote(titleUrl), /quota cooldown/);
      assert.equal(calls.length, 1);
      await second.requestRemote("https://openlibrary.org/api/books");
      assert.equal(calls.length, 2);
      t.mock.timers.tick(1800 * 1000 - 1);
      await assert.rejects(second.requestRemote(titleUrl), /quota cooldown/);
      t.mock.timers.tick(1);
      await second.requestRemote(titleUrl);
      assert.equal(calls.length, 3);
    });
  }
});

test("Google Books respects HTTP-date Retry-After and daily quota errors without cooling down unrelated 403s", async () => {
  const cache = memoryCache();
  await observeGoogleBooksResponse(
    cache,
    isbnUrl,
    403,
    new Headers(),
    "Forbidden",
  );
  assert.equal(cache.values.size, 0);
  const retryAt = Math.ceil((Date.now() + 3600_000) / 1000) * 1000;
  await observeGoogleBooksResponse(
    cache,
    isbnUrl,
    429,
    new Headers({ "retry-after": new Date(retryAt).toUTCString() }),
    "",
  );
  assert.equal(Number(cache.get("google-books:cooldown")), retryAt);
  await observeGoogleBooksResponse(
    cache,
    isbnUrl,
    403,
    new Headers(),
    "dailyLimitExceeded",
  );
  assert.ok(
    Number(cache.get("google-books:cooldown")) >=
      Date.now() + 24 * 3600_000 - 100,
  );
});

test("administrator debugging shares the Google Books pacing and quota cooldown", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const cache = memoryCache();
  const store = { cache, requireAdmin() {} };
  let calls = 0;
  const debug = createScraperDebugger(store, async () => {
    calls++;
    return new Response("Throttled", { status: 429 });
  }, [googleBooks]);
  await debug.debugScraperIsbn({
    query: "Matilda",
    providerId: "google-books",
  });
  const second = await debug.debugScraperIsbn({
    query: "Moon",
    providerId: "google-books",
  });
  assert.equal(second.outcome, "failed");
  assert.match(second.error, /quota cooldown/);
  assert.equal(calls, 1);
});
