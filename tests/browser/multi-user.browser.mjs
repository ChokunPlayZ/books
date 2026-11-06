// Isolated production-server smoke test; never opens the normal library database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { openStore } from "../../lib/server/store.ts";
import { createAccount } from "../../lib/server/auth.ts";

const directory = mkdtempSync(join(tmpdir(), "books-users-browser-"));
const database = join(directory, "books.sqlite");
const store = openStore(database);
const alice = createAccount(store, "alice", "alice-browser-password");
createAccount(store, "bob", "bob-browser-password");
let aliceBook;
const image = store.covers.put({
  contentType: "image/png",
  body: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  ),
});
store.forUser(alice, () => {
  // Copies can share a public ISBN, but the owned copy and its details remain private.
  store.covers.allow(image.id);
  store.api.saveBook({
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
      msrp: 175,
      msrpCurrency: "THB",
    },
  });
  aliceBook = store.api.getCollection().books[0];
});
store.close();
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
    BOOKS_DATABASE_PATH: database,
    BOOKS_PASSWORD: "admin-browser-password",
    BOOKS_SECURE_COOKIES: "false",
    BOOKS_ALLOW_UNAUTHENTICATED: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
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
  const errors = [];
  for (const page of [alicePage, bobPage])
    page.on("pageerror", (error) => errors.push(error.message));
  async function login(page, username) {
    await page.goto(url);
    await page.waitForURL("**/login");
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page
      .getByLabel("Password", { exact: true })
      .fill(username + "-browser-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(url + "/");
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
  assert.equal(
    (await alicePage.request.get(url + "/api/covers/" + image.id)).status(),
    200,
  );
  const bobBackup = await (
    await bobPage.request.get(url + "/api/backup")
  ).text();
  assert.ok(!bobBackup.includes("Alice secret"));
  assert.ok(!bobBackup.includes(image.id));
  await bobPage.locator("#addButton").click();
  assert.deepEqual(await bobPage.locator("#type option").allTextContents(), [
    "Light novel",
    "Manga",
    "Others",
  ]);
  await bobPage.locator("#cancelBook").click();
  await bobPage.goto(url + "/data");
  assert.equal(await bobPage.locator("#metadata-maintenance").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS separate account login, private libraries/backups/covers, admin-only refresh, and three book types",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
}
