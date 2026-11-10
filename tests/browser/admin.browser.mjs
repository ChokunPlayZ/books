// Standalone production checks with isolated PostgreSQL schemas, never a real library.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { openTestStore, testDatabaseUrl } from "../helpers/database.mjs";
import { createAccount, signInWithGoogle } from "../../lib/server/auth.ts";
import { checkAdminEditConflicts } from "../helpers/admin-edit-conflicts.mjs";
import {
  createApplicationApi,
  applicationQueue,
} from "../../lib/server/api.ts";
import {
  googleTestEnvironment,
  mockGooglePage,
} from "../helpers/mock-google.mjs";

const key = "admin-browser-" + crypto.randomUUID();
const store = await openTestStore(key);
const ownerSession = await signInWithGoogle(
  store,
  {
    sub: "owner-admin-browser",
    email: "owner@gmail.com",
    email_verified: true,
  },
  "owner@gmail.com",
);
await createAccount(store, "reader", "reader@gmail.com");
const readerSession = await signInWithGoogle(store, {
  sub: "reader-admin-browser",
  email: "reader@gmail.com",
  email_verified: true,
});
const cover = await store.forUser(readerSession.user, () =>
  store.covers.put({
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
      "base64",
    ),
    contentType: "image/png",
  }),
);
await store.forUser(readerSession.user, () =>
  store.api.saveBook({
    requestId: crypto.randomUUID(),
    book: {
      series: "Reader private inspection",
      type: "Other",
      status: "Read",
      note: 'Admin can inspect this record\n{"mood":"happy"}\n<em>Keep this literal note</em>',
      coverId: cover.id,
      volume: 2,
      publisher: "Reader publisher",
    },
  }),
);
const isbn = "9780316769488";
await store.cache.put(
  "scrape:v1:admin-inspect-fixture",
  JSON.stringify({
    source: "text:https://yenpress.com/cache-browser-fixture",
    checkedAt: Date.now(),
    value:
      "x".repeat(20000) +
      "<h1>Deep cached browser fixture</h1><script>window.adminCacheXss=true</script>" +
      "y".repeat(20000),
  }),
  Infinity,
);
await store.cache.put(
  `isbn:v15:${isbn}`,
  JSON.stringify({
    isbn,
    found: true,
    details: {
      title: "Queue browser fixture",
      coverId: cover.id,
      description: "First paragraph\nSecond paragraph",
    },
    warnings: [],
  }),
  Infinity,
);
const api = createApplicationApi(store, {
  ensure: () => assert.fail("Fixture has no cover"),
});
await api.manageScrapeQueue({ paused: true });
const initialJob = await applicationQueue(store).enqueue(
  "lookupIsbn",
  isbn,
  "Queued browser fixture",
);

const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const url = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["--import", "./tests/helpers/mock-google.mjs", ".next/standalone/server.js"],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: await testDatabaseUrl(key),
      BOOKS_APP_URL: url,
      ...googleTestEnvironment(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (chunk) => {
  logs = (logs + chunk).slice(-6000);
});
server.stderr.on("data", (chunk) => {
  logs = (logs + chunk).slice(-6000);
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      ready = (await fetch(url + "/api/health")).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BOOKS_BROWSER_EXECUTABLE
      ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
      : {}),
  });
  const cookie = (value) => ({
    name: "book_collection_session",
    value,
    url,
    httpOnly: true,
    sameSite: "Lax",
  });
  const adminContext = await browser.newContext();
  const readerContext = await browser.newContext({ javaScriptEnabled: false });
  const anonymous = await browser.newContext({ javaScriptEnabled: false });
  await adminContext.addCookies([cookie(ownerSession.token)]);
  await readerContext.addCookies([cookie(readerSession.token)]);
  const page = await adminContext.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rpc = (context, name, arg) =>
    context.request.post(url + "/api/rpc", { data: { name, arg } });
  assert.equal(
    (await adminContext.request.get(`${url}/api/covers/${cover.id}`)).status(),
    404,
  );
  assert.equal(
    (
      await adminContext.request.get(
        `${url}/api/covers/${cover.id}?inspection=1`,
      )
    ).status(),
    200,
  );
  assert.equal(
    (await adminContext.request.get(`${url}/api/covers/${cover.id}`)).status(),
    404,
    "inspection does not grant cover access",
  );
  assert.equal(
    (
      await readerContext.request.get(
        `${url}/api/covers/${cover.id}?inspection=1`,
      )
    ).status(),
    403,
  );
  assert.equal(
    (
      await anonymous.request.get(`${url}/api/covers/${cover.id}?inspection=1`)
    ).status(),
    401,
  );
  const unauthenticated = await anonymous.request.get(url + "/admin", {
    maxRedirects: 0,
  });
  assert.equal(unauthenticated.status(), 307);
  assert.match(unauthenticated.headers().location, /\/login\?returnTo=/);
  for (const path of ["/admin", "/admin?_rsc=admin-test"]) {
    const response = await readerContext.request.get(url + path, {
      headers: path.includes("_rsc") ? { RSC: "1" } : {},
    });
    const body = await response.text();
    // Flight can already be streaming when Next serializes notFound().
    assert.ok([200, 404].includes(response.status()), path);
    if (response.status() === 200)
      assert.match(body, /NEXT_HTTP_ERROR_FALLBACK;404/);
    assert.doesNotMatch(
      body,
      /Queued browser fixture|AdminPanel|Administrator workspace|Reader private inspection/,
    );
  }
  const reader = await readerContext.newPage();
  await reader.goto(url);
  assert.equal(await reader.locator('a[href="/admin"]').count(), 0);
  assert.equal(await reader.locator("#metadataManager").count(), 0);
  assert.equal(await reader.locator("#pullPublisherCovers").count(), 0);
  for (const field of [
    "msrp",
    "msrpCurrency",
    "edition",
    "pageCount",
    "publisherUrl",
    "coverUrl",
  ])
    assert.equal(
      await reader.locator("#" + field).getAttribute("type"),
      "hidden",
    );
  const adminLibraryHtml = await (await adminContext.request.get(url)).text();
  assert.match(adminLibraryHtml, /id="metadataManager"/);
  assert.match(adminLibraryHtml, /id="pullPublisherCovers"/);
  await reader.goto(url + "/data");
  assert.equal(await reader.locator('a[href="/admin"]').count(), 0);
  for (const [name, arg] of [
    ["getSystemOverview"],
    ["getScraperDebugSources"],
    ["debugScraperIsbn", { isbn: "9786164648357", providerId: "phoenix" }],
    ["getSystemRecords", { resource: "books" }],
    ["getScrapeQueue"],
    ["getScrapeJob", { id: initialJob }],
    ["manageScrapeQueue", { paused: false }],
    ["manageScrapeJob", { id: initialJob, action: "fasttrack" }],
    ["enqueueScrapeTask", { kind: "lookupIsbn", arg: { isbn } }],
    ["enqueueMetadataRecrawl", { id: "any" }],
    ["getAdminUsers"],
    ["getAdminUserLibrary", { userId: 1, confirmed: true }],
    ["manageAdminUser", { userId: 1, action: "disable" }],
    ["createAccountRelink", { userId: 1, email: "attacker@gmail.com" }],
    ["revokeAccountRelinks", { userId: 1 }],
    ["getPublisherCrawls"],
    ["startPublisherCrawl", { publisherId: "yenpress", mode: "all" }],
  ])
    assert.equal(
      (await rpc(readerContext, name, arg)).status(),
      403,
      name + "\n" + logs,
    );
  assert.equal(
    (
      await adminContext.request.post(url + "/api/rpc", {
        headers: { Origin: "https://evil.test" },
        data: { name: "manageScrapeQueue", arg: { paused: false } },
      })
    ).status(),
    403,
  );

  const adminHtml = await adminContext.request.get(url + "/admin");
  assert.equal(adminHtml.status(), 200);
  assert.match(await adminHtml.text(), /Queued browser fixture/);
  await page.goto(url + "/admin");
  await page
    .getByRole("heading", { name: "Scraping queue", exact: true })
    .waitFor();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Queued browser fixture" });
  await row.getByRole("button", { name: "Fast-track", exact: true }).click();
  await row.getByText("Fast-tracked", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Resume queue", exact: true }).click();
  await row.getByText("succeeded", { exact: true }).waitFor();
  await row
    .getByRole("button", { name: "Queued browser fixture", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Task details: Queued browser fixture",
      exact: true,
    })
    .waitFor();
  assert.match(
    await page.locator(".admin-events").innerText(),
    /Fast-tracked by administrator/,
  );
  await page.getByText("Queue browser fixture", { exact: true }).waitFor();
  assert.equal(await page.locator("#adminMain pre").count(), 0);
  assert.match(
    await page.locator(".admin-task-content").last().innerText(),
    /First paragraph\nSecond paragraph/,
  );
  await page
    .locator(".admin-task-content img")
    .evaluate((image) => image.scrollIntoView());
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".admin-task-content img")].some(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.getByRole("button", { name: "Pause queue", exact: true }).click();
  await page
    .getByRole("button", { name: "Resume queue", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Metadata & caches", exact: true })
    .click();
  await page
    .getByLabel("Search cache", { exact: true })
    .fill("Deep cached browser fixture");
  await page.getByLabel("Search cache", { exact: true }).press("Enter");
  const cachedRow = page
    .getByRole("row")
    .filter({ hasText: "scrape:v1:admin-inspect-fixture" });
  await cachedRow.getByRole("button", { name: "Inspect", exact: true }).click();
  const cachePreview = page.locator(".admin-card").filter({
    has: page.getByRole("heading", { name: "Cache preview", exact: true }),
  });
  assert.match(await cachePreview.innerText(), /Deep cached browser fixture/);
  assert.doesNotMatch(
    await cachePreview.innerText(),
    /<h1>|<script>|window.adminCacheXss/,
  );
  assert.equal(await cachePreview.locator("pre, script, iframe").count(), 0);
  assert.equal(await page.evaluate(() => window.adminCacheXss), undefined);
  await cachePreview
    .getByRole("button", { name: "Next text", exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".admin-card .admin-readable-text")].some(
      (text) =>
        text.textContent.length < 16000 &&
        text.textContent.endsWith("y".repeat(100)),
    ),
  );
  await cachePreview
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByLabel("ISBN", { exact: true }).fill(isbn);
  await page
    .getByRole("button", { name: "Re-scrape ISBN", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Re-scrape queued." })
    .waitFor();
  await page
    .getByRole("button", { name: "Scraping queue", exact: true })
    .click();
  const forced = page.getByRole("row").filter({ hasText: "Force re-scrape" });
  await forced.getByRole("button", { name: "Cancel", exact: true }).click();
  await forced.getByText("cancelled", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "System records", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByLabel("Record category", { exact: true })
    .selectOption("books");
  await page
    .getByRole("heading", {
      name: "Reader private inspection · Volume 2",
      exact: true,
    })
    .waitFor();
  assert.match(
    await page.locator(".admin-records").innerText(),
    /Reader private inspection/,
  );
  const bookRecord = page
    .locator(".admin-records .admin-record")
    .filter({ hasText: "Reader private inspection" });
  assert.match(await bookRecord.innerText(), /Reader publisher/);
  assert.match(await bookRecord.innerText(), /Admin can inspect this record/);
  assert.match(await bookRecord.innerText(), /\{"mood":"happy"\}/);
  assert.match(
    await bookRecord.innerText(),
    /<em>Keep this literal note<\/em>/,
  );
  assert.equal(await bookRecord.locator(".admin-record-notes em").count(), 0);
  await bookRecord
    .getByRole("img", { name: "Reader private inspection", exact: true })
    .scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".admin-records img")].some(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  const debugBody =
    "x".repeat(20000) +
    "<script>window.adminDebugXss=true</script><h1>Complete debug response tail</h1>";
  const debugReport = {
    isbn: "9786164648357",
    query: "9786164648357",
    mode: "isbn",
    outcome: "found",
    message: "Matching results returned.",
    diagnostics: [],
    providerId: "phoenix",
    startedAt: "2026-11-10T00:00:00.000Z",
    durationMs: 42,
    result: {
      isbn: "9786164648357",
      title: "Debug fixture",
      msrp: 175,
      msrpCurrency: "THB",
      coverUrl:
        "https://www.phoenixnext.com/media/catalog/product/debug-cover.jpg",
    },
    responses: [
      {
        url: "https://www.phoenixnext.com/mgm0098-01.html",
        method: "GET",
        status: 200,
        contentType: "text/html",
        body: debugBody,
        bytes: debugBody.length,
        durationMs: 20,
        error: "",
      },
    ],
    snapshots: [],
    cooldowns: [],
    error: "",
    stack: "",
  };
  let debugCalls = 0,
    coverDownloads = 0;
  let expectedDebugRequest = { isbn: "9786164648357", providerId: "phoenix" };
  let debugResponse = debugReport;
  await page.route("https://www.phoenixnext.com/**", (route) => {
    coverDownloads++;
    return route.abort();
  });
  await page.route("**/api/rpc", async (route) => {
    const input = route.request().postDataJSON();
    if (input.name !== "debugScraperIsbn") return route.continue();
    debugCalls++;
    assert.deepEqual(input.arg, expectedDebugRequest);
    return route.fulfill({ json: debugResponse });
  });
  await page
    .getByRole("button", { name: "Scraper debugger", exact: true })
    .click();
  await page.getByLabel("ISBN", { exact: true }).fill("9786164648357");
  await page.getByLabel("Provider", { exact: true }).selectOption("phoenix");
  await page
    .getByRole("button", { name: "Run fresh scrape", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Parsed result", exact: true })
    .waitFor();
  assert.equal(debugCalls, 1);
  assert.match(await page.locator(".admin-debug-report").innerText(), /175/);
  assert.equal(await page.locator(".admin-debug-report img").count(), 0);
  await page.getByText("Raw response body", { exact: true }).click();
  assert.equal(await page.locator(".admin-debug-raw").innerText(), debugBody);
  assert.equal(await page.evaluate(() => window.adminDebugXss), undefined);
  assert.equal(
    await page
      .locator(".admin-debug-report script, .admin-debug-report iframe")
      .count(),
    0,
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download debug report", exact: true })
    .click();
  assert.equal(
    (await downloadPromise).suggestedFilename(),
    "scraper-phoenix-9786164648357.json",
  );
  assert.equal(coverDownloads, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Search by", { exact: true }).selectOption("title");
  assert.equal(
    await page
      .getByLabel("Provider", { exact: true })
      .locator('option[value="kinokuniya"]')
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByLabel("Provider", { exact: true })
      .locator('option[value="luckpim"]')
      .count(),
    1,
  );
  expectedDebugRequest = { query: "Moon & Stars", providerId: "phoenix" };
  debugResponse = {
    ...debugReport,
    isbn: "",
    query: "Moon & Stars",
    mode: "title",
    result: {
      items: [
        { title: "Moon & Stars", url: "https://www.phoenixnext.com/moon.html" },
      ],
    },
  };
  await page
    .getByLabel("Title", { exact: true })
    .fill(expectedDebugRequest.query);
  await page
    .getByRole("button", { name: "Run fresh scrape", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Moon & Stars · Phoenix Next", exact: true })
    .waitFor();
  assert.equal(debugCalls, 2);
  expectedDebugRequest = { query: "Missing title", providerId: "phoenix" };
  debugResponse = {
    ...debugResponse,
    query: "Missing title",
    outcome: "not_found",
    message:
      "The scraper returned no matching results. Review the source responses and diagnostics below.",
    result: { items: [] },
  };
  await page
    .getByLabel("Title", { exact: true })
    .fill(expectedDebugRequest.query);
  await page
    .getByRole("button", { name: "Run fresh scrape", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "No matching results", exact: true })
    .waitFor();
  expectedDebugRequest = { query: "Website failure", providerId: "phoenix" };
  debugResponse = {
    ...debugResponse,
    query: "Website failure",
    outcome: "failed",
    error: "Website returned HTTP 503 (Service Unavailable).",
    diagnostics: [
      {
        kind: "http",
        sourceId: "phoenix",
        status: 503,
        url: "https://www.phoenixnext.com/catalogsearch/result/?q=Website%20failure",
        message: "Website returned HTTP 503 (Service Unavailable).",
      },
    ],
  };
  await page
    .getByLabel("Title", { exact: true })
    .fill(expectedDebugRequest.query);
  await page
    .getByRole("button", { name: "Run fresh scrape", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Scrape failed", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".admin-debug-report").innerText(),
    /HTTP 503/,
  );
  assert.match(
    await page.locator(".admin-debug-report").innerText(),
    /q=Website%20failure/,
  );
  assert.equal(debugCalls, 4);
  assert.equal(coverDownloads, 0);
  await page
    .getByRole("button", { name: "System records", exact: true })
    .click();
  await page
    .getByLabel("Record category", { exact: true })
    .selectOption("covers");
  await page
    .getByRole("heading", { name: "Stored cover", exact: true })
    .waitFor();
  await page.locator(".admin-records img").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".admin-records img")].some(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  const accounts = await (
    await rpc(adminContext, "getSystemRecords", { resource: "users" })
  ).json();
  assert.doesNotMatch(
    JSON.stringify(accounts),
    /password_hash|google_subject|credential_hash|token_hash/,
  );
  await page.getByRole("button", { name: "Users", exact: true }).click();
  let libraryRequests = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/rpc") &&
      request.postDataJSON()?.name === "getAdminUserLibrary"
    )
      libraryRequests++;
  });
  await page
    .getByRole("row")
    .filter({ hasText: "reader@gmail.com" })
    .getByRole("button", { name: "Manage account", exact: true })
    .click();
  assert.equal(libraryRequests, 0);
  assert.equal(await page.getByText("Keep this note").count(), 0);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", {
      name: "View library (confirmation required)",
      exact: true,
    })
    .click();
  assert.equal(
    libraryRequests,
    0,
    "declining confirmation never loads library data",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "View library (confirmation required)",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", {
      name: "Reader private inspection · Volume 2",
      exact: true,
    })
    .waitFor();
  assert.equal(libraryRequests, 1);
  await page
    .getByLabel("Destination Google email", { exact: true })
    .fill("destination@gmail.com");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Generate re-link URL", exact: true })
    .click();
  const linkField = page.getByLabel("Re-link URL", { exact: true });
  await linkField.waitFor();
  const link = await linkField.inputValue();
  assert.match(link, /\/relink#token=[a-f0-9]{64}$/);
  const recipientContext = await browser.newContext();
  const recipient = await recipientContext.newPage();
  await mockGooglePage(recipient, {
    sub: "relinked-admin-browser",
    email: "destination@gmail.com",
    email_verified: true,
  });
  await recipient.goto(link);
  await recipient
    .getByRole("button", {
      name: "Choose destination Google account",
      exact: true,
    })
    .waitFor();
  assert.equal(
    recipient.url(),
    url + "/relink",
    "the invitation fragment is removed after loading",
  );
  await recipient.getByRole("checkbox").check();
  await recipient
    .getByRole("button", {
      name: "Choose destination Google account",
      exact: true,
    })
    .click();
  await recipient.waitForURL(url + "/").catch((error) => {
    throw new Error(
      `${error.message}\nCurrent page: ${recipient.url()}\nServer: ${logs}`,
    );
  });
  const relinked = await (await rpc(recipientContext, "getCollection")).json();
  assert.equal(relinked.books[0].series, "Reader private inspection");
  assert.equal((await rpc(readerContext, "getCollection")).status(), 401);
  await checkAdminEditConflicts(
    page,
    async (name, arg) => {
      const response = await rpc(adminContext, name, arg);
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    },
    (row) =>
      store.db
        .prepare("UPDATE books SET revision=revision+1 WHERE id=?")
        .run(row),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  // Role changes take effect on the next server render and RPC, not just hydration.
  await store.db.prepare("UPDATE users SET role='user' WHERE id=1").run();
  assert.equal((await rpc(adminContext, "getSystemOverview")).status(), 403);
  const revoked = await adminContext.request.get(url + "/admin");
  assert.ok([200, 404].includes(revoked.status()));
  const revokedBody = await revoked.text();
  if (revoked.status() === 200)
    assert.match(revokedBody, /NEXT_HTTP_ERROR_FALLBACK;404/);
  assert.doesNotMatch(
    revokedBody,
    /AdminPanel|Administrator workspace|Reader private inspection/,
  );
  assert.deepEqual(errors, [], logs);
  console.log(
    "PASS SSR/RSC administrator gates, credential redaction, queue controls, forced re-scrapes, system inspection and role revocation",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
  await store.close();
}
