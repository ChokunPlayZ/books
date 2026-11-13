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
  ...(name === "alice"
    ? { picture: "https://lh3.googleusercontent.com/a/preferences-alice=s96-c" }
    : {}),
});
const alice = await signInWithGoogle(store, identity("alice"));
const aliceDevice = await signInWithGoogle(store, identity("alice"));
await signInWithGoogle(store, {
  ...identity("alice"),
  email: "alice.updated@gmail.com",
});
const bob = await signInWithGoogle(store, identity("bob"));
const owner = await signInWithGoogle(
  store,
  identity("owner"),
  "owner@gmail.com",
);
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
        source: "Book fair",
        publisher: "Example publisher",
        publisherUrl: "https://publisher.example/books/collection-1",
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
  const protectedSettings = await anonymous.request.get(url + "/settings", {
    maxRedirects: 0,
  });
  assert.equal(protectedSettings.status(), 307);
  assert.equal(protectedSettings.headers().location, "/login");
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
  await context.route("https://lh3.googleusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
        "base64",
      ),
    }),
  );
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
  assert.equal(
    (
      await context.request.patch(url + "/api/preferences", {
        data: { theme: "dark", seriesTitleLanguage: "invalid" },
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
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator(".book-row").click();
  assert.equal(await page.locator("#metadataManager").count(), 0);
  await page
    .getByRole("link", { name: "View on publisher site", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#metadataPublisherLink").getAttribute("href"),
    "https://publisher.example/books/collection-1?ref=meemai.ckl.moe",
  );
  assert.equal(
    await page.locator("#metadataPublisherLink").getAttribute("target"),
    "_blank",
  );
  assert.equal(
    await page.locator("#metadataPublisherLink").getAttribute("rel"),
    "noopener",
  );
  assert.equal(
    await page
      .locator("#bookDialog")
      .getByLabel("Bought from", { exact: true })
      .inputValue(),
    "Book fair",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "User settings", exact: true }).click();
  await page
    .getByRole("heading", { name: "User settings", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#accountEmail").textContent(),
    "alice.updated@gmail.com",
  );
  assert.equal(
    await page.locator("#accountUsername").textContent(),
    "alice@gmail.com",
  );
  assert.equal(await page.locator("#accountRole").count(), 0);
  assert.equal(
    await page.getByText("Account role", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .locator(".account-summary .account-avatar img")
      .getAttribute("src"),
    identity("alice").picture,
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".account-avatar img")].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  assert.equal(
    await page.locator(".profile-link .account-avatar img").count(),
    1,
  );
  await page.getByText("Google account", { exact: true }).waitFor();
  const titleLanguage = page.getByRole("combobox", {
    name: "View series title in",
    exact: true,
  });
  assert.equal(await titleLanguage.inputValue(), "");
  await titleLanguage.selectOption("ja");
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-labelledby="seriesTitleLanguageLabel"]')
        ?.value === "ja" &&
      !document.querySelector('[aria-labelledby="seriesTitleLanguageLabel"]')
        ?.disabled,
  );
  assert.equal((await preferences()).seriesTitleLanguage, "ja");
  await page.reload();
  assert.equal(await titleLanguage.inputValue(), "ja");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `settings overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // Settings, backups, and signed-in policies retain the same navigation and chrome.
  for (const [path, active] of [
    ["/settings", "settingsLink"],
    ["/data", "dataLink"],
    ["/terms", null],
    ["/privacy", null],
  ]) {
    await page.goto(url + path);
    assert.equal(await page.locator("header.top").count(), 1);
    assert.equal(await page.locator("main").count(), 1);
    assert.equal(await page.locator("#libraryNavigation").count(), 1);
    assert.equal(await page.locator(".footer .legal-links").count(), 1);
    assert.equal(
      await page.locator(".capture-actions").count(),
      0,
      "No dead book-entry buttons outside collection pages",
    );
    const selected = page.locator('#libraryNavigation [aria-current="page"]');
    assert.equal(await selected.count(), active ? 1 : 0);
    if (active) {
      assert.equal(await selected.getAttribute("id"), active);
      await page.waitForFunction(() => {
        const nav = document.getElementById("libraryNavigation");
        const current = nav
          .querySelector('[aria-current="page"]')
          .getBoundingClientRect();
        return current.left >= 0 && current.right <= innerWidth;
      });
    }
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${path}: overflow at ${width}`,
      );
      const nav = await page.locator("#libraryNavigation").boundingBox();
      const main = await page.locator("main").boundingBox();
      if (width > 760)
        assert.ok(
          main.x >= nav.x + nav.width,
          `${path}: content clears desktop navigation`,
        );
      else
        assert.ok(
          main.y >= nav.y + nav.height,
          `${path}: content clears handheld navigation`,
        );
      if (["/settings", "/data"].includes(path) && [390, 1440].includes(width))
        await page.screenshot({
          path: join(directory, `${path.slice(1)}-${width}.png`),
          fullPage: true,
        });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }

  // A failed profile photo falls back to the account icon, never a broken image.
  const brokenPhotoContext = await browser.newContext({
    storageState: await context.storageState(),
  });
  await brokenPhotoContext.route(
    "https://lh3.googleusercontent.com/**",
    (route) => route.abort(),
  );
  const brokenPhoto = await brokenPhotoContext.newPage();
  await brokenPhoto.goto(url + "/settings");
  await brokenPhoto.waitForFunction(
    () => !document.querySelector(".account-summary .account-avatar img"),
  );
  assert.equal(
    await brokenPhoto.locator(".account-summary .account-avatar svg").count(),
    1,
  );
  await brokenPhotoContext.close();
  await page.goto(url);
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  assert.deepEqual(await preferences(), {
    locale: "en",
    theme: "dark",
    seriesTitleLanguage: "ja",
  });
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
  assert.equal(
    await page
      .locator("#bookDialog")
      .getByLabel("ซื้อจาก", { exact: true })
      .inputValue(),
    "",
  );
  assert.equal(await page.locator("#metadataPublisherLink").isVisible(), false);
  await page.keyboard.press("Escape");
  await page.locator("#toggleSelection").click();
  assert.equal(
    await page.locator("#toggleSelection").textContent(),
    "เลือกเสร็จแล้ว",
  );
  await page.keyboard.press("Escape");
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator(".book-row").click();
  await page
    .getByRole("link", { name: "ดูบนเว็บไซต์สำนักพิมพ์", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("#bookDialog")
      .getByLabel("ซื้อจาก", { exact: true })
      .inputValue(),
    "Book fair",
  );
  await page.keyboard.press("Escape");
  await page.goto(url);
  assert.deepEqual(await preferences(), {
    locale: "th",
    theme: "dark",
    seriesTitleLanguage: "ja",
  });

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
  await fresh.goto(url + "/settings", { waitUntil: "domcontentloaded" });
  assert.equal(
    await fresh.getByLabel("ภาษาของชื่อเรื่อง", { exact: true }).inputValue(),
    "ja",
    "A fresh device receives the saved title language from the account",
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
    ["/settings", "การตั้งค่าผู้ใช้"],
  ]) {
    await page.goto(url + path);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "th");
    if (path === "/settings") {
      assert.equal(
        await page
          .getByLabel("ภาษาของชื่อเรื่อง", { exact: true })
          .inputValue(),
        "ja",
      );
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `Thai settings overflow at ${width}`,
        );
        await page.screenshot({
          path: join(directory, `settings-th-dark-${width}.png`),
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
  }
  await page.goto(url);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);

  const other = await context.newPage();
  await other.goto(url + "/data");
  await other.locator("#preferencesTitle").waitFor();
  await other
    .getByRole("link", { name: "การตั้งค่าผู้ใช้", exact: true })
    .click();
  await other.locator("#accountTitle").waitFor();
  await other.waitForLoadState("networkidle");
  assert.equal(await other.locator("#accountRole").count(), 0);
  await other
    .getByRole("combobox", { name: "รูปแบบการแสดงผล", exact: true })
    .selectOption("light");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.deepEqual(await preferences(), {
    locale: "th",
    theme: "light",
    seriesTitleLanguage: "ja",
  });

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
  await other
    .getByLabel("ภาษาของชื่อเรื่อง", { exact: true })
    .selectOption("en");
  await other.locator(".preference-error[role='alert']").waitFor();
  assert.equal(
    await other.getByLabel("ภาษาของชื่อเรื่อง", { exact: true }).inputValue(),
    "ja",
  );
  assert.deepEqual(await preferences(), {
    locale: "th",
    theme: "light",
    seriesTitleLanguage: "ja",
  });
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
  assert.deepEqual(await preferences(), {
    locale: "en",
    theme: "light",
    seriesTitleLanguage: "ja",
  });

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
  assert.deepEqual(await preferences(), {
    locale: "en",
    theme: "system",
    seriesTitleLanguage: "",
  });
  await page.goto(url + "/settings");
  assert.equal(
    await page.locator("#accountEmail").textContent(),
    "bob@gmail.com",
  );
  assert.equal(
    await page.locator("#accountUsername").textContent(),
    "bob@gmail.com",
  );
  assert.equal(
    await page
      .locator("main")
      .textContent()
      .then((text) => text.includes("alice")),
    false,
  );

  // A failed sign-out stays on settings and can be retried safely.
  await page.route("**/api/logout", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not sign out" })
    .waitFor();
  assert.equal(page.url(), url + "/settings");
  assert.equal(
    (await context.request.get(url + "/api/preferences")).status(),
    200,
  );
  await page.unroute("**/api/logout");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(url + "/login");
  assert.equal(
    (await context.request.get(url + "/api/preferences")).status(),
    401,
  );
  await page.goto(url + "/settings");
  await page.waitForURL(url + "/login");
  assert.deepEqual(errors, []);
  await context.close();
  const adminContext = await browser.newContext();
  await adminContext.addCookies([cookie(owner.token)]);
  const adminPage = await adminContext.newPage();
  await adminPage.goto(url + "/settings");
  assert.equal(await adminPage.locator("#accountRole").count(), 0);
  assert.equal(
    await adminPage.getByText("Account role", { exact: true }).count(),
    0,
  );
  for (const width of [320, 390, 768, 1440]) {
    await adminPage.setViewportSize({ width, height: 900 });
    assert.equal(
      await adminPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `admin settings overflow at ${width}`,
    );
    assert.equal(
      Math.round((await adminPage.locator("header.top").boundingBox()).height),
      width <= 760 ? 65 : 73,
    );
  }
  assert.equal(
    await adminPage.locator("#accountEmail").textContent(),
    "owner@gmail.com",
  );
  await adminContext.close();
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
    "PASS user settings, account details/isolation, sign-out/retry, account language/theme, authenticated validation, Thai hydration, unchanged book data, fresh device/pre-paint, cross-tab sync, save failure and account switching",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
