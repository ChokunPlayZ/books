// Standalone production checks with isolated PostgreSQL schemas, never a real library.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { openTestStore, testDatabaseUrl } from "../helpers/database.mjs";
import { createAccount, signInWithGoogle } from "../../lib/server/auth.ts";
import {
  createApplicationApi,
  applicationQueue,
} from "../../lib/server/api.ts";
import { googleTestEnvironment } from "../helpers/mock-google.mjs";

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
await store.forUser(readerSession.user, () =>
  store.api.saveBook({
    requestId: crypto.randomUUID(),
    book: {
      series: "Reader private inspection",
      type: "Other",
      status: "Read",
      note: "Admin can inspect this record",
    },
  }),
);
const isbn = "9780316769488";
await store.cache.put(
  `isbn:v15:${isbn}`,
  JSON.stringify({
    isbn,
    found: true,
    details: { title: "Queue browser fixture" },
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
const server = spawn(process.execPath, [".next/standalone/server.js"], {
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
});
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
    ["getSystemRecords", { resource: "books" }],
    ["getScrapeQueue"],
    ["getScrapeJob", { id: initialJob }],
    ["manageScrapeQueue", { paused: false }],
    ["manageScrapeJob", { id: initialJob, action: "fasttrack" }],
    ["enqueueScrapeTask", { kind: "lookupIsbn", arg: { isbn } }],
    ["enqueueMetadataRecrawl", { id: "any" }],
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
  await page.getByRole("button", { name: "Pause queue", exact: true }).click();
  await page
    .getByRole("button", { name: "Resume queue", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Metadata & caches", exact: true })
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
  await page
    .getByLabel("Record category", { exact: true })
    .selectOption("books");
  await page
    .locator(".admin-records summary")
    .filter({ hasText: "reader" })
    .waitFor();
  await page.locator(".admin-records summary").first().click();
  assert.match(
    await page.locator(".admin-records").innerText(),
    /Reader private inspection/,
  );
  const accounts = await (
    await rpc(adminContext, "getSystemRecords", { resource: "users" })
  ).json();
  assert.doesNotMatch(
    JSON.stringify(accounts),
    /password_hash|google_subject|credential_hash|token_hash/,
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
