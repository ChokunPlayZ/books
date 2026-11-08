// Isolated production-server smoke test; never opens the normal library database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import {
  openTestStore as openStore,
  testDatabaseUrl,
} from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import { seriesPath } from "../../lib/domain/navigation.ts";
import {
  googleTestEnvironment,
  mockGooglePage,
} from "../helpers/mock-google.mjs";

const directory = mkdtempSync(join(tmpdir(), "books-users-browser-"));
const database = join(directory, "books.sqlite");
const store = await openStore(database);
const alice = await createAccount(store, "alice", "alice@gmail.com");
await createAccount(store, "bob", "bob@gmail.com");
let aliceBook;
const image = await store.covers.put({
  contentType: "image/png",
  body: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
    "base64",
  ),
});
await store.forUser(alice, async () => {
  // Copies can share a public ISBN, but the owned copy and its details remain private.
  await store.covers.allow(image.id);
  await store.api.saveBook({
    requestId: randomUUID(),
    book: {
      isbn: "9786166247275",
      series: "Alice private shelf",
      type: "Manga (TH) (Color)",
      publisher: "Phoenix Next",
      status: "Reading",
      volume: 1,
      source: "Alice secret shop",
      price: 120,
      date: "2026-11-01",
      note: "Alice secret note",
      coverId: image.id,
      coverUrl: "https://www.phoenixnext.com/media/catalog/product/reader.png",
      publisherUrl: "https://www.phoenixnext.com/reader-volume.html",
      pageCount: 208,
      msrp: 175,
      msrpCurrency: "THB",
    },
  });
  aliceBook = (await store.api.getCollection()).books[0];
});
await store.close();
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
      DATABASE_URL: await testDatabaseUrl(database),
      ...googleTestEnvironment(),
      BOOKS_APP_URL: url,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (chunk) => {
  logs = (logs + chunk).slice(-4000);
});
server.stderr.on("data", (chunk) => {
  logs = (logs + chunk).slice(-4000);
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
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  assert.equal(
    (
      await alicePage.request.post(url + "/api/rpc", {
        data: { name: "getCollection" },
      })
    ).status(),
    401,
  );
  assert.equal(
    (await alicePage.request.get(url + "/api/auth/google")).status(),
    405,
  );
  assert.equal(
    (
      await alicePage.request.post(url + "/api/auth/google", {
        headers: { Origin: "https://evil.test" },
        maxRedirects: 0,
      })
    ).status(),
    403,
  );
  const invalid = await alicePage.request.get(
    url + "/api/auth/google/callback?state=invalid&code=forged",
    { maxRedirects: 0 },
  );
  assert.equal(invalid.status(), 303);
  assert.equal(invalid.headers().location, url + "/login?error=google");
  const errors = [];
  for (const page of [alicePage, bobPage])
    page.on("pageerror", (error) => errors.push(error.message));
  async function login(page, username) {
    await page.goto(url);
    await page.waitForURL("**/login");
    await mockGooglePage(page, {
      sub: "google-" + username,
      email: username + "@gmail.com",
      email_verified: true,
    });
    await page
      .getByRole("button", { name: "Continue with Google", exact: true })
      .click();
    await page.waitForURL(url + "/").catch((error) => {
      throw new Error(
        `${error.message}\nCurrent page: ${page.url()}\nServer: ${logs}`,
      );
    });
    await page.waitForFunction(
      () => !document.getElementById("addButton").disabled,
    );
  }
  await Promise.all([login(alicePage, "alice"), login(bobPage, "bob")]);
  const rpc = (page, name, arg) =>
    page.request.post(url + "/api/rpc", { data: { name, arg } });
  const aliceData = await (await rpc(alicePage, "getCollection")).json();
  const bobData = await (await rpc(bobPage, "getCollection")).json();
  assert.equal(aliceData.books[0].source, "Alice secret shop");
  assert.deepEqual(bobData.books, []);
  assert.equal(
    (
      await rpc(bobPage, "removeBook", {
        ...aliceBook,
        requestId: randomUUID(),
      })
    ).status(),
    409,
  );
  assert.equal((await rpc(bobPage, "getMetadataOverview")).status(), 403);
  assert.equal(
    (
      await rpc(bobPage, "lookupIsbn", { isbn: aliceBook.isbn, refresh: true })
    ).status(),
    403,
  );
  assert.equal(
    (await bobPage.request.get(url + "/api/covers/" + image.id)).status(),
    404,
  );
  const cover = await alicePage.request.get(url + "/api/covers/" + image.id);
  assert.equal(cover.status(), 200);
  assert.equal(cover.headers()["content-type"], "image/webp");
  assert.equal(
    (
      await bobPage.request.get(url + "/api/covers/" + image.id, {
        headers: { "If-None-Match": cover.headers().etag },
      })
    ).status(),
    404,
  );
  const bobBackup = await (
    await bobPage.request.get(url + "/api/backup")
  ).text();
  assert.ok(!bobBackup.includes("Alice secret"));
  assert.ok(!bobBackup.includes(image.id));
  await bobPage.locator("#addButton").click();
  assert.equal(await bobPage.locator("#metadataManager").count(), 0);
  assert.equal(await bobPage.locator("#pullPublisherCovers").count(), 0);
  for (const id of [
    "msrp",
    "msrpCurrency",
    "edition",
    "pageCount",
    "publisherUrl",
    "coverUrl",
  ])
    assert.equal(
      await bobPage.locator("#" + id).getAttribute("type"),
      "hidden",
    );
  assert.deepEqual(await bobPage.locator("#type option").allTextContents(), [
    "Light novel",
    "Manga",
    "Others",
  ]);
  await bobPage.locator("#cancelBook").click();
  for (const path of [
    seriesPath(aliceBook.series),
    "/series/" + Buffer.from(aliceBook.series).toString("base64url"),
  ]) {
    await bobPage.goto(url + path);
    assert.equal(await bobPage.locator("#seriesTitle").count(), 0);
    assert.ok(!(await bobPage.title()).includes(aliceBook.series));
  }
  await alicePage.goto(url + seriesPath(aliceBook.series));
  await alicePage.waitForFunction(() => !!window.bookCollection?.state.data);
  await alicePage
    .getByRole("button", {
      name: "Edit Alice private shelf, volume 1",
      exact: true,
    })
    .click();
  assert.equal(await alicePage.locator("#metadataManager").count(), 0);
  assert.equal(await alicePage.locator("#pullPublisherCovers").count(), 0);
  await alicePage.locator("#note").fill("Reader edited only their notes");
  await alicePage.locator("#saveButton").click();
  await alicePage.waitForFunction(
    () => !document.getElementById("bookDialog").open,
  );
  const updated = (await (await rpc(alicePage, "getCollection")).json())
    .books[0];
  assert.equal(updated.note, "Reader edited only their notes");
  for (const field of [
    "msrp",
    "msrpCurrency",
    "edition",
    "pageCount",
    "publisherUrl",
    "coverUrl",
    "coverId",
  ])
    assert.equal(updated[field], aliceBook[field], field + " is preserved");
  await alicePage.locator("#editVolumesButton").click();
  await alicePage.locator(".series-edit-volume button").click();
  for (const field of ["pageCount", "coverUrl", "publisherUrl"])
    assert.equal(
      await alicePage
        .locator(`#seriesEditor [name="${field}"]`)
        .getAttribute("type"),
      "hidden",
    );
  await alicePage.locator("#cancelSeriesEdit").click();
  await bobPage.goto(url + "/data");
  assert.equal(await bobPage.locator("#metadata-maintenance").count(), 0);
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await login(publicPage, "new-reader");
  const publicData = await (await rpc(publicPage, "getCollection")).json();
  assert.equal(publicData.user.role, "user");
  assert.deepEqual(publicData.books, []);
  const session = (await publicContext.cookies()).find(
    (cookie) => cookie.name === "book_collection_session",
  );
  assert.equal(session.httpOnly, true);
  assert.equal(session.sameSite, "Lax");
  assert.equal(
    (
      await publicPage.request.post(url + "/api/logout", {
        headers: { Origin: url },
      })
    ).status(),
    200,
  );
  assert.equal((await rpc(publicPage, "getCollection")).status(), 401);
  assert.equal(
    (
      await publicPage.request.post(url + "/api/rpc", {
        headers: { Cookie: "book_collection_session=" + session.value },
        data: { name: "getCollection" },
      })
    ).status(),
    401,
  );
  await publicContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS Google-only login, public signup, callback/CSRF protection, private libraries/backups/covers, admin-only refresh, and session revocation",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
}
