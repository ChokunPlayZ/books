// Production Next.js + actual PostgreSQL. Every database and server here belongs to this test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createCoverService, coverDigest } from "../../lib/server/covers.ts";
import {
  openTestStore as openStore,
  testDatabaseUrl,
} from "../helpers/database.mjs";
import { seriesPath } from "../../lib/domain/navigation.ts";
import { seedMetadataMaintenance } from "../helpers/metadata.mjs";
import { signInWithGoogle } from "../../lib/server/auth.ts";
import {
  googleTestEnvironment,
  mockGooglePage,
} from "../helpers/mock-google.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "book-collection-e2e-"));
const launched = [];
const executable =
  process.env.BOOKS_BROWSER_EXECUTABLE ||
  process.argv
    .find((arg) => arg.startsWith("--browser-executable="))
    ?.slice("--browser-executable=".length);
const googleEnv = googleTestEnvironment();
const owner = {
  sub: "browser-owner",
  email: "owner@gmail.com",
  email_verified: true,
};
const fixtureSessions = new Map();
const coverSource =
  "https://www.phoenixnext.com/media/catalog/product/cached-test.png";
const coverPath =
  "/api/covers/" +
  coverDigest(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
const coverBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const value = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return value;
}
async function start(name, seed) {
  const seeded = await openStore(join(directory, `${name}.sqlite`));
  const fixtureSession = (await signInWithGoogle(seeded, owner, owner.email))
    .token;
  if (seed) await seed(seeded);
  const seedCovers = createCoverService(seeded, {
    fetchImpl: async () => new Response(coverBytes),
  });
  await seedCovers.ensure(coverSource);
  await seedCovers.ensure(
    "https://www.phoenixnext.com/media/catalog/product/alternate-test.png",
  );
  await seeded.close();
  const selectedPort = await port(),
    url = `http://127.0.0.1:${selectedPort}`;
  fixtureSessions.set(url, fixtureSession);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "./tests/helpers/mock-google.mjs",
      ".next/standalone/server.js",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(selectedPort),
        DATABASE_URL: await testDatabaseUrl(join(directory, `${name}.sqlite`)),
        ...googleEnv,
        BOOKS_APP_URL: url,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
async function runBrowserScenario(name, url) {
  const child = spawn(
    process.execPath,
    [join(root, "tests", "browser", name)],
    {
      cwd: root,
      env: {
        ...process.env,
        ...(executable ? { BOOKS_BROWSER_EXECUTABLE: executable } : {}),
        BOOKS_TEST_URL: url,
        ...(name === "pwa.browser.mjs"
          ? {}
          : { BOOKS_TEST_SESSION: fixtureSessions.get(url) }),
      },
      stdio: "inherit",
    },
  );
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw new Error(`${name} failed (${code}).`);
}

let browser;
try {
  const url = await start("protected");
  await runBrowserScenario("legal.browser.mjs", url);
  await runBrowserScenario("audit-browser-security.browser.mjs", url);
  await runBrowserScenario("audit-deployment.browser.mjs", url);
  await runBrowserScenario("pwa.browser.mjs", url);
  browser = await chromium.launch({
    headless: true,
    ...(executable ? { executablePath: executable } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  // CRUD/import checks must not launch live publisher discovery for 150 fixtures.
  // Cover lookup itself is exercised by the dedicated publisher scenarios.
  await page.route("**/api/rpc", (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    return route.continue();
  });
  const post = (body) => page.request.post(url + "/api/rpc", { data: body });
  assert.equal((await post({ name: "getCollection" })).status(), 401);
  assert.equal((await page.request.get(url + "/api/backup")).status(), 401);
  for (const name of [
    "getMetadataOverview",
    "getMetadataCacheEntry",
    "purgeMetadataCache",
    "recrawlMetadata",
  ])
    assert.equal((await post({ name, arg: {} })).status(), 401);
  assert.equal((await page.request.get(url + coverPath)).status(), 401);
  assert.equal((await page.request.post(url + "/api/import")).status(), 401);
  await page.goto(url);
  await page.waitForURL("**/login");
  for (const path of ["/terms", "/privacy"])
    assert.equal(
      await page.locator(`.legal-links a[href="${path}"]`).count(),
      1,
    );
  assert.doesNotMatch(
    await page.locator("main").innerText(),
    /books stay private|sharing with book publishers/i,
  );
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  assert.equal(
    (
      await page.request.post(url + "/api/login", {
        data: { password: "obsolete-password" },
      })
    ).status(),
    410,
  );
  await mockGooglePage(page, owner);
  await page
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await page.waitForURL(url + "/");
  await page.waitForFunction(
    () => !document.getElementById("addButton").disabled,
  );
  for (const path of ["/terms", "/privacy"])
    assert.equal(
      await page.locator(`.footer .legal-links a[href="${path}"]`).count(),
      1,
    );
  const bookmarkContext = await browser.newContext();
  const bookmark = await bookmarkContext.newPage();
  const bookmarkedPath = seriesPath("Bookmarked title");
  await bookmark.goto(url + "/stats");
  await bookmark.waitForURL("**/login?returnTo=*");
  assert.equal(new URL(bookmark.url()).searchParams.get("returnTo"), "/stats");
  await bookmark.goto(url + "/missing");
  await bookmark.waitForURL("**/login?returnTo=*");
  assert.equal(
    new URL(bookmark.url()).searchParams.get("returnTo"),
    "/missing",
  );
  await bookmark.goto(url + bookmarkedPath);
  await bookmark.waitForURL("**/login?returnTo=*");
  assert.equal(
    new URL(bookmark.url()).searchParams.get("returnTo"),
    bookmarkedPath,
  );
  await mockGooglePage(bookmark, owner);
  await bookmark
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await bookmark.waitForURL(url + bookmarkedPath);
  assert.equal(
    await bookmark.locator("#seriesTitle").textContent(),
    "Bookmarked title",
  );
  await bookmarkContext.close();
  assert.equal((await post({ name: "getCollection" })).status(), 200);
  const cover = await page.request.get(url + coverPath);
  assert.equal(cover.status(), 200);
  assert.deepEqual(await cover.body(), coverBytes);
  assert.equal(cover.headers()["content-type"], "image/png");
  assert.match(cover.headers()["cache-control"], /^private, no-store$/);
  assert.equal(
    (
      await page.request.get(url + coverPath, {
        headers: { "If-None-Match": cover.headers().etag },
      })
    ).status(),
    304,
  );
  assert.equal(
    (
      await page.request.get(url + "/api/covers?url=https://127.0.0.1/private")
    ).status(),
    400,
  );
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
  for (const path of ["/terms", "/privacy"])
    assert.equal(
      await page.locator(`.data-footer .legal-links a[href="${path}"]`).count(),
      1,
    );
  await page
    .locator("#importFile")
    .setInputFiles(join(root, "tests/fixtures/collection.json"));
  await page.getByRole("button", { name: "Review import" }).click();
  await page.getByRole("heading", { name: "Ready to import" }).waitFor();
  await page.getByRole("button", { name: "Import this collection" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("link", { name: "Open your shelf" }).click();
  await page.waitForFunction(
    () => document.getElementById("addButton")?.disabled === false,
  );
  assert.equal(await page.locator("#bookCount").textContent(), "150");
  await page.locator("#search").fill("Bocchi");
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(await page.locator(".book-row").count(), 1);
  await page.locator("#backSeries").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  await page.locator("#series").fill("Next.js browser check");
  await page.locator("#type").selectOption("Light novel");
  await page.locator("#publisher").fill("PHOENIX Next");
  await page.locator("#status").selectOption("Read");
  await page.locator("#volume").fill("14.5");
  await page.locator("#price").fill("0");
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => !document.getElementById("bookDialog").open);
  const collectionResponse = await post({ name: "getCollection" });
  assert.equal(
    collectionResponse.status(),
    200,
    await collectionResponse.text(),
  );
  const collection = await collectionResponse.json();
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
  const publisherPage = "https://www.phoenixnext.com/browser-volume.html";
  const alternateCover =
    "https://www.phoenixnext.com/media/catalog/product/alternate-test.png";
  await page.route("**/api/covers/" + coverDigest(coverBytes), (route) =>
    route.fulfill({ body: coverBytes, contentType: "image/png" }),
  );
  await page.route("**/api/rpc", (route) => {
    const { name } = route.request().postDataJSON();
    if (name === "getBookCoverOptions")
      return route.fulfill({
        json: {
          covers: [alternateCover, coverSource].map((coverUrl) => ({
            coverUrl,
            coverId: coverDigest(coverBytes),
            source: "Publisher",
            publisherUrl: publisherPage,
            title: "Next.js browser check",
          })),
          warnings: [],
          publisherUrl: publisherPage,
        },
      });
    return route.fallback();
  });
  await page.locator("#search").fill("Next.js browser check");
  await page.locator(".series-row").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  const volumeCover = page.getByRole("button", {
    name: "Edit Next.js browser check, volume 14.5",
    exact: true,
  });
  await volumeCover.click();
  await page.locator("#pullPublisherCovers").click();
  await page.locator(".cover-choice").nth(1).waitFor();
  await page.locator(".cover-choice").first().click();
  await page.getByLabel("Pages", { exact: true }).fill("208");
  assert.equal(await page.locator("#coverUrl").inputValue(), alternateCover);
  assert.equal(
    await page.locator("#metadataPublisherLink").getAttribute("href"),
    publisherPage,
  );
  assert.equal(
    await page
      .locator("#bookDialog")
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    true,
  );
  await page.locator("#pageCount").evaluate((input) => {
    input.closest(".dialog-body").scrollTop -= 60;
  });
  await page.screenshot({
    path: join(root, "outputs", "next-metadata-phone.png"),
  });
  await page.locator("#cancelBook").click();
  assert.equal(
    (await (await post({ name: "getCollection" })).json()).books.find(
      (book) => book.row === added.row,
    ).coverUrl,
    "",
  );
  await volumeCover.click();
  await page.locator("#pullPublisherCovers").click();
  await page.locator(".cover-choice").nth(1).click();
  await page.locator("#note").fill("Selected publisher cover");
  await page.getByLabel("Pages", { exact: true }).fill("208");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#metadataManager").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(root, "outputs", "next-metadata-desktop.png"),
  });
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => !document.getElementById("bookDialog").open);
  await page.reload();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  const metadataResponse = await post({ name: "getCollection" });
  assert.equal(metadataResponse.status(), 200, await metadataResponse.text());
  const metadataBook = (await metadataResponse.json()).books.find(
    (book) => book.row === added.row,
  );
  assert.equal(metadataBook.coverUrl, coverSource);
  assert.equal(metadataBook.publisherUrl, publisherPage);
  assert.equal(metadataBook.note, "Selected publisher cover");
  assert.equal(metadataBook.pageCount, 208);
  await page.locator(".book-row img").waitFor();
  assert.equal(
    await page.locator(".book-row img").getAttribute("src"),
    coverPath,
  );
  await volumeCover.click();
  assert.equal(
    await page
      .getByRole("link", { name: "Open publisher site ↗", exact: true })
      .getAttribute("href"),
    publisherPage,
  );
  await page.keyboard.press("Escape");
  await page.locator("#backSeries").click();
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#search").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  console.log(
    "PASS volume cover details, publisher cover picker, cancellation, saved cover priority, publisher link and reload persistence",
  );
  const backup = await (await page.request.get(url + "/api/backup")).json();
  assert.equal(backup.books.length, 151);
  assert.equal(backup.format, "book-collection");
  assert.equal(
    backup.books.find((book) => book.title === added.series).note,
    "Selected publisher cover",
  );
  assert.equal(
    backup.books.some((book) => "coverUrl" in book || "row" in book),
    false,
  );
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
  assert.equal((await page.request.get(url + coverPath)).status(), 401);
  console.log(
    "PASS file import review, 150 migrated records, shelf gaps, save/reload persistence, JSON backup and logout",
  );
  await browser.close();
  browser = null;

  await runBrowserScenario(
    "library-data.browser.mjs",
    await start("metadata-maintenance", seedMetadataMaintenance),
  );
  const fixturesUrl = await start("ui-regressions");
  assert.deepEqual(
    Buffer.from(
      await (
        await fetch(fixturesUrl + coverPath, {
          headers: {
            Cookie:
              "book_collection_session=" + fixtureSessions.get(fixturesUrl),
          },
        })
      ).arrayBuffer(),
    ),
    coverBytes,
  );
  console.log(
    "PASS protected cover endpoint, private caching, ETags and image persistence across server processes",
  );
  await runBrowserScenario("statistics.browser.mjs", await start("statistics"));
  await runBrowserScenario("missing.browser.mjs", await start("missing"));
  await runBrowserScenario(
    "bulk-selection.browser.mjs",
    await start("bulk-selection"),
  );
  await runBrowserScenario(
    "merge-series.browser.mjs",
    await start("merge-series"),
  );
  await runBrowserScenario(
    "book-sources.browser.mjs",
    await start("book-sources"),
  );
  await runBrowserScenario(
    "publisher-isbn-search.browser.mjs",
    await start("publisher-isbn-search"),
  );
  await runBrowserScenario(
    "firstpage-lookup.browser.mjs",
    await start("firstpage-lookup"),
  );
  await runBrowserScenario(
    "missing-catalogs.browser.mjs",
    await start("missing-catalogs"),
  );
  for (const name of [
    "theme.browser.mjs",
    "collection-filters.browser.mjs",
    "pricing.browser.mjs",
    "price-finder.browser.mjs",
    "mobile-adding.browser.mjs",
    "series-entry.browser.mjs",
    "series-edit.browser.mjs",
    "title-details.browser.mjs",
    "series-missing.browser.mjs",
    "volume-editions.browser.mjs",
    "firstpage-series.browser.mjs",
    "firstpage-types.browser.mjs",
    "publishers.browser.mjs",
    "release-filters.browser.mjs",
    "kinokuniya.browser.mjs",
    "lilyhouse.browser.mjs",
    "navigation.browser.mjs",
  ])
    await runBrowserScenario(
      name,
      name === "publishers.browser.mjs"
        ? await start("publishers")
        : fixturesUrl,
    );
  await runBrowserScenario(
    "yenpress-publisher.browser.mjs",
    await start("yenpress-publisher"),
  );
  if (
    process.env.BOOKS_TEST_SCANNING === "true" ||
    process.argv.includes("--scan-photos")
  )
    await runBrowserScenario("scan-photos.browser.mjs", fixturesUrl);
  await runBrowserScenario(
    "infinite-scroll.browser.mjs",
    await start("infinite-scroll"),
  );
  await runBrowserScenario("anime.browser.mjs", await start("anime"));
  await runBrowserScenario("discovery.browser.mjs", await start("discovery"));
  console.log("PASS all standalone app browser checks");
} finally {
  if (browser) await browser.close();
  for (const child of launched) child.kill("SIGTERM");
}
