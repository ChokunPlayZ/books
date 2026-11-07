// Isolated production server and PostgreSQL database; never opens the real library.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  openTestStore as openStore,
  testDatabaseUrl,
} from "../helpers/database.mjs";
import { signInWithGoogle, SESSION_COOKIE } from "../../lib/server/auth.ts";

const directory = mkdtempSync(join(tmpdir(), "books-preferences-browser-"));
const database = join(directory, "books.sqlite");
const store = await openStore(database);
const identity = (name) => ({
  sub: `preferences-${name}`,
  email: `${name}@gmail.com`,
  email_verified: true,
});
const alice = await signInWithGoogle(store, identity("alice"));
const aliceDevice = await signInWithGoogle(store, identity("alice"));
const bob = await signInWithGoogle(store, identity("bob"));
const themeTest = await signInWithGoogle(store, identity("theme-test"));
await store.forUser(
  alice.user,
  async () =>
    await store.api.saveBook({
      requestId: "preferences_browser_book",
      book: {
        series: "Collection",
        type: "Manga",
        status: "Read",
        volume: 1,
        isbn: "",
        price: "",
        date: "",
        source: "",
        publisher: "",
        note: "Your collection",
      },
    }),
);
await store.close();
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
    DATABASE_URL: await testDatabaseUrl(database),
    BOOKS_APP_URL: url,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (value) => {
  logs = (logs + value).slice(-6000);
});
server.stderr.on("data", (value) => {
  logs = (logs + value).slice(-6000);
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
  const anonymous = await browser.newContext();
  assert.equal(
    (await anonymous.request.get(url + "/api/preferences")).status(),
    401,
  );
  assert.equal(
    (
      await anonymous.request.patch(url + "/api/preferences", {
        data: { locale: "th" },
      })
    ).status(),
    401,
  );
  await anonymous.close();
  const context = await browser.newContext({
    colorScheme: "light",
    viewport: { width: 390, height: 844 },
  });
  const cookie = (token) => ({ name: SESSION_COOKIE, value: token, url });
  await context.addCookies([cookie(alice.token)]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const preferences = async () =>
    (await context.request.get(url + "/api/preferences")).json();
  assert.equal(
    (
      await context.request.patch(url + "/api/preferences", {
        data: { theme: "dark" },
        headers: { Origin: "https://evil.test" },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await context.request.patch(url + "/api/preferences", {
        data: { userId: bob.user.id, locale: "th" },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await context.request.patch(url + "/api/preferences", {
        data: { locale: "ja" },
      })
    ).status(),
    400,
  );
  await page.goto(url);
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  assert.equal(await page.locator(".brand-name").textContent(), "meemai");
  await page.getByRole("link", { name: "meemai home", exact: true }).waitFor();
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  assert.deepEqual(await preferences(), { locale: "en", theme: "dark" });
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("th");
  await page.waitForFunction(() => document.documentElement.lang === "th");
  await page
    .getByRole("heading", { name: "คลังหนังสือของคุณ", exact: true })
    .waitFor();
  assert.equal(await page.locator(".brand-name").textContent(), "มีมั้ย");
  await page
    .getByRole("link", { name: "หน้าหลักมีมั้ย", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  assert.equal(
    await page.locator(".shelf-caption").textContent(),
    "Collection",
  );
  assert.equal(
    await page.locator("#toggleSelection").textContent(),
    "เลือกเรื่อง",
  );
  await page.locator("#addButton").click();
  await page
    .getByRole("heading", { name: "เพิ่มเข้าคลังหนังสือ", exact: true })
    .waitFor();
  assert.equal(await page.locator("#saveButton").textContent(), "เพิ่มหนังสือ");
  assert.equal(
    await page.locator("#type option[value='Manga']").textContent(),
    "มังงะ",
  );
  assert.equal(
    await page.locator("#status option[value='Read']").textContent(),
    "อ่านแล้ว",
  );
  await page.keyboard.press("Escape");
  await page.locator("#toggleSelection").click();
  assert.equal(
    await page.locator("#toggleSelection").textContent(),
    "เลือกเสร็จแล้ว",
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(await preferences(), { locale: "th", theme: "dark" });

  // A fresh browser has no localStorage and an opposing system theme.
  const device = await browser.newContext({ colorScheme: "light" });
  await device.addCookies([cookie(aliceDevice.token)]);
  const fresh = await device.newPage();
  await fresh.route("**/_next/**/*.js", (route) => route.abort());
  await fresh.goto(url, { waitUntil: "domcontentloaded" });
  assert.equal(await fresh.locator("html").getAttribute("lang"), "th");
  assert.equal(await fresh.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(
    await fresh.locator("#collectionTitle").textContent(),
    "คลังหนังสือของคุณ",
  );
  await device.close();

  const staleStorage = await browser.newContext({ colorScheme: "light" });
  await staleStorage.addCookies([cookie(aliceDevice.token)]);
  await staleStorage.addInitScript(() =>
    localStorage.setItem("books-theme", "light"),
  );
  const stalePage = await staleStorage.newPage();
  await stalePage.goto(url);
  await stalePage.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  assert.equal(await stalePage.locator("html").getAttribute("lang"), "th");
  await staleStorage.close();

  for (const [path, heading] of [
    ["/stats", "สถิติ"],
    ["/removed", "ที่นำออกล่าสุด"],
  ]) {
    await page.goto(url + path);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "th");
  }
  await page.goto(url);

  const other = await context.newPage();
  await other.goto(url + "/data");
  await other.locator("#preferencesTitle").waitFor();
  await other
    .getByRole("combobox", { name: "รูปแบบการแสดงผล", exact: true })
    .selectOption("light");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.deepEqual(await preferences(), { locale: "th", theme: "light" });

  // Failed writes stay visibly failed and do not silently change the account.
  await other.route("**/api/preferences", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: "{}",
        })
      : route.continue(),
  );
  await other
    .getByRole("combobox", { name: "รูปแบบการแสดงผล", exact: true })
    .selectOption("dark");
  await other.locator(".preference-error[role='alert']").waitFor();
  assert.equal(await other.locator("html").getAttribute("data-theme"), "light");
  assert.deepEqual(await preferences(), { locale: "th", theme: "light" });
  await other.unroute("**/api/preferences");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `collection overflow at ${width}`,
    );
  }

  await other
    .getByRole("combobox", { name: "ภาษา", exact: true })
    .first()
    .selectOption("en");
  await other.waitForFunction(() => document.documentElement.lang === "en");
  await other
    .getByRole("heading", { name: "Account preferences", exact: true })
    .waitFor();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  assert.deepEqual(await preferences(), { locale: "en", theme: "light" });

  // Switching accounts on the same browser must not reuse Alice's language/theme.
  await context.addCookies([cookie(bob.token)]);
  await page.goto(url);
  await page
    .getByRole("heading", { name: "Your collection", exact: true })
    .waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.deepEqual(await preferences(), { locale: "en", theme: "system" });
  assert.deepEqual(errors, []);
  await context.close();
  const themeScenario = spawn(
    process.execPath,
    ["tests/browser/theme.browser.mjs"],
    {
      env: {
        ...process.env,
        BOOKS_TEST_URL: url,
        BOOKS_TEST_SESSION: themeTest.token,
      },
      stdio: "inherit",
    },
  );
  const themeCode = await new Promise((resolve, reject) => {
    themeScenario.once("error", reject);
    themeScenario.once("exit", resolve);
  });
  assert.equal(themeCode, 0, "Theme browser regression failed");
  console.log(
    "PASS account language/theme, authenticated validation, Thai hydration, unchanged book data, fresh device/pre-paint, cross-tab sync, save failure and account switching",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
