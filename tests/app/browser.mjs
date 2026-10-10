// Production Next.js + actual SQLite. Every database and server here belongs to this test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "book-collection-e2e-"));
const launched = [],
  temporaryScripts = [];
const executable =
  process.env.BOOKS_BROWSER_EXECUTABLE ||
  process.argv
    .find((arg) => arg.startsWith("--browser-executable="))
    ?.slice("--browser-executable=".length);
const password = "book-collection-test-password";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const value = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return value;
}
async function start(name, extra = {}) {
  const selectedPort = await port(),
    url = `http://127.0.0.1:${selectedPort}`;
  const child = spawn(process.execPath, [".next/standalone/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(selectedPort),
      BOOKS_DATABASE_PATH: join(directory, `${name}.sqlite`),
      BOOKS_PASSWORD: "",
      BOOKS_ALLOW_UNAUTHENTICATED: "false",
      BOOKS_SECURE_COOKIES: "false",
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  launched.push(child);
  let logs = "";
  child.stdout.on("data", (value) => (logs = (logs + value).slice(-4000)));
  child.stderr.on("data", (value) => (logs = (logs + value).slice(-4000)));
  for (let count = 0; count < 200; count++) {
    if (child.exitCode !== null) throw new Error(`Next.js exited: ${logs}`);
    try {
      if ((await fetch(url + "/api/health")).ok) return url;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Next.js did not start: ${logs}`);
}
async function runLegacy(name, url) {
  // Reuse established UI regressions without overwriting the Apps Script screenshots.
  const path = join(root, "tests", `.next-${name}`);
  let source = readFileSync(join(root, "tests", name), "utf8").replaceAll(
    "../outputs/",
    "../outputs/next-",
  );
  source = source.replace(
    /await cleanup\.goto\([^;]+\);/g,
    (match) =>
      match + "await cleanup.waitForFunction(() => typeof rpc === 'function');",
  );
  if (name === "publishers.browser.mjs") {
    const lookup = {
      isbn: "9786166247275",
      found: true,
      details: {
        title: "ดอกรักผลิบานที่กลางใจ เล่ม 22",
        series: "ดอกรักผลิบานที่กลางใจ",
        volume: 22,
        type: "Manga (TH)",
        publisher: "PHOENIX Next",
        source: "Naiin",
      },
      warnings: [],
      searchUrl: "https://www.naiin.com/search-result?title=9786166247275",
    };
    source = source.replace(
      "const request=route.request().postDataJSON();",
      `const request=route.request().postDataJSON();if(request?.name==='lookupIsbn')return route.fulfill({json:${JSON.stringify(lookup)}});`,
    );
  }
  writeFileSync(path, source);
  temporaryScripts.push(path);
  const child = spawn(process.execPath, [path], {
    cwd: root,
    env: {
      ...process.env,
      ...(executable ? { BOOKS_BROWSER_EXECUTABLE: executable } : {}),
      BOOKS_PREVIEW_URL: url,
    },
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw new Error(`${name} failed (${code}).`);
}

let browser;
try {
  const url = await start("protected", { BOOKS_PASSWORD: password });
  browser = await chromium.launch({
    headless: true,
    ...(executable ? { executablePath: executable } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  const post = (body) => page.request.post(url + "/api/rpc", { data: body });
  assert.equal((await post({ name: "getCollection" })).status(), 401);
  assert.equal((await page.request.get(url + "/api/backup")).status(), 401);
  assert.equal((await page.request.post(url + "/api/import")).status(), 401);
  await page.goto(url);
  await page.waitForURL("**/login");
  await page.getByLabel("Library password").fill("incorrect");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.getByLabel("Library password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url + "/");
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  assert.equal((await post({ name: "getCollection" })).status(), 200);
  assert.equal(
    (
      await page.request.post(url + "/api/rpc", {
        data: { name: "getCollection" },
        headers: { Origin: "https://unrelated.test" },
      })
    ).status(),
    403,
  );
  assert.equal((await post({ name: "__proto__" })).status(), 404);
  console.log(
    "PASS production sign-in, protected APIs, same-origin writes, and action allowlist",
  );

  await page.goto(url + "/data");
  await page
    .locator("#importFile")
    .setInputFiles(join(root, "preview/books.json"));
  await page.getByRole("button", { name: "Review import" }).click();
  await page.getByRole("heading", { name: "Ready to import" }).waitFor();
  await page.getByRole("button", { name: "Import this collection" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("link", { name: "Open your shelf" }).click();
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  assert.equal(await page.locator("#bookCount").textContent(), "150");
  await page.locator("#search").fill("Bocchi");
  await page.locator(".series-row").click();
  assert.equal(await page.locator(".book-row").count(), 1);
  await page.locator("#backSeries").click();
  await page.locator("#addButton").click();
  await page.locator("#series").fill("Next.js browser check");
  await page.locator("#type").selectOption("LN (TH)");
  await page.locator("#status").selectOption("Read");
  await page.locator("#volume").fill("14.5");
  await page.locator("#price").fill("0");
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => !document.getElementById("bookDialog").open);
  const collection = await (await post({ name: "getCollection" })).json();
  const added = collection.books.find(
    (book) => book.series === "Next.js browser check",
  );
  assert.equal(added.price, 0);
  assert.equal(added.volume, 14.5);
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  assert.equal(await page.locator("#bookCount").textContent(), "151");
  const backup = await (await page.request.get(url + "/api/backup")).json();
  assert.equal(backup.books.length, 151);
  assert.equal(backup.format, "book-collection");
  await page.screenshot({
    path: join(root, "outputs", "next-collection-phone.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: join(root, "outputs", "next-collection-desktop.png"),
  });
  assert.deepEqual(errors, []);
  await page.goto(url + "/data");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL("**/login");
  assert.equal((await post({ name: "getCollection" })).status(), 401);
  console.log(
    "PASS file import review, 150 migrated records, shelf gaps, save/reload persistence, JSON backup and logout",
  );
  await browser.close();
  browser = null;

  const fixturesUrl = await start("ui-regressions", {
    BOOKS_ALLOW_UNAUTHENTICATED: "true",
  });
  for (const name of [
    "pricing.browser.mjs",
    "series-entry.browser.mjs",
    "series-missing.browser.mjs",
    "volume-editions.browser.mjs",
    "publishers.browser.mjs",
    "release-filters.browser.mjs",
  ])
    await runLegacy(name, fixturesUrl);
  if (
    process.env.BOOKS_TEST_SCANNING === "true" ||
    process.argv.includes("--scan-photos")
  )
    await runLegacy("scan-photos.browser.mjs", fixturesUrl);
  console.log("PASS all standalone app browser checks");
} finally {
  if (browser) await browser.close();
  for (const child of launched) child.kill("SIGTERM");
  for (const path of temporaryScripts) unlinkSync(path);
}
