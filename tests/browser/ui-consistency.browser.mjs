// All page families, shared controls and overlays on an isolated test library.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { openTestStore, testDatabaseUrl } from "../helpers/database.mjs";
import { signInWithGoogle } from "../../lib/server/auth.ts";
import { seriesPath } from "../../lib/domain/navigation.ts";
import { googleTestEnvironment } from "../helpers/mock-google.mjs";

const key = "ui-consistency-" + crypto.randomUUID();
const store = await openTestStore(key);
const owner = await signInWithGoogle(
  store,
  { sub: key, email: "ui-owner@gmail.com", email_verified: true },
  "ui-owner@gmail.com",
);
const title = "เรื่องทดสอบ / A collector’s unusually long series title";
await store.forUser(owner.user, async () => {
  for (const volume of [1, 3])
    await store.api.saveBook({
      requestId: crypto.randomUUID(),
      book: {
        series: title,
        type: "Manga",
        publisher: "Test publisher with a long descriptive name",
        source: "ร้านหนังสือ / A bookshop with a long name",
        status: "Reading",
        volume,
        price: 120,
        date: "2026-11-01",
      },
    });
  await store.api.saveBook({
    requestId: crypto.randomUUID(),
    book: {
      series: "Another series",
      type: "Manga",
      status: "Read",
      volume: 1,
    },
  });
});
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
    DATABASE_URL: await testDatabaseUrl(key),
    BOOKS_APP_URL: url,
    ...googleTestEnvironment(),
    BOOKS_ADMIN_EMAIL: "ui-owner@gmail.com",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (chunk) => (logs = (logs + chunk).slice(-6000)));
server.stderr.on("data", (chunk) => (logs = (logs + chunk).slice(-6000)));
let browser;
const findings = [];
const screenshots = "outputs/ui-consistency";
const widths = [320, 390, 560, 760, 768, 1024, 1440];
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
  await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BOOKS_BROWSER_EXECUTABLE
      ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.addCookies([
    { name: "book_collection_session", value: owner.token, url },
  ]);
  const page = await context.newPage();
  // Safari supported popovers before checkVisibility; enhancement cannot
  // depend on the newer visibility API.
  await context.addInitScript(() => {
    Element.prototype.checkVisibility = undefined;
  });
  page.on("pageerror", (error) => findings.push({ error: error.message }));
  await context.route("**/api/rpc", (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    if (name === "lookupIsbn")
      return route.fulfill({ json: { isbn: arg, found: false, warnings: [] } });
    if (["getPublisherReleases", "getSeriesCatalog"].includes(name))
      return route.fulfill({ json: { items: [], complete: true } });
    if (name === "getPublisherDirectory")
      return route.fulfill({
        json: { url: arg.url, titles: [], items: [], complete: true },
      });
    if (name === "getSeasonalThaiBooks")
      return route.fulfill({
        json: { items: [], thaiSources: [], ...arg, checkedAt: Date.now() },
      });
    if (name === "getAnimeAdaptations")
      return route.fulfill({
        json: {
          items: [],
          exactId: null,
          checkedAt: new Date().toISOString(),
          stale: false,
          complete: true,
        },
      });
    return route.continue();
  });
  await context.route(/^https:\/\//, (route) => route.abort());

  async function inspect(label, { menus = true } = {}) {
    const result = await page.evaluate(() => {
      const visible = (el) =>
        el.getClientRects().length &&
        getComputedStyle(el).visibility === "visible";
      const root =
        [...document.querySelectorAll("dialog:modal")].at(-1) ?? document;
      const controls = [
        ...root.querySelectorAll("input, select, textarea, button"),
      ].filter(visible);
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        outside: controls
          .filter((el) => {
            if (el.closest(".tabs, .admin-table-scroll, .series-edit-scroll"))
              return false;
            const box = el.getBoundingClientRect();
            return box.left < -1 || box.right > innerWidth + 1;
          })
          .map((el) => el.id || el.className || el.outerHTML.slice(0, 120)),
        small: controls
          .filter((el) => {
            if (el.matches("input[type=checkbox], input[type=radio]"))
              return false;
            const target = el.closest("label.file") ?? el;
            return target.getBoundingClientRect().height < 43.5;
          })
          .map((el) => el.id || el.textContent.trim()),
        crowdedSelect: controls
          .filter(
            (el) =>
              el.matches("select") &&
              parseFloat(getComputedStyle(el).paddingInlineEnd) < 36,
          )
          .map((el) => el.id || el.getAttribute("aria-label") || el.name),
        smallText: controls
          .filter(
            (el) =>
              innerWidth <= 760 &&
              el.matches(
                "input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea",
              ) &&
              parseFloat(getComputedStyle(el).fontSize) < 16,
          )
          .map((el) => el.id || el.name),
        clippedFields: [
          ...root.querySelectorAll(".field, .import-picker, .dialog-body"),
        ]
          .filter(visible)
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.id || el.className),
        titleCollision: (() => {
          const title = root
            .querySelector("#seriesTitle")
            ?.getBoundingClientRect();
          const actions = root
            .querySelector(".series-header-actions")
            ?.getBoundingClientRect();
          return !!(
            title &&
            actions &&
            title.left < actions.right &&
            title.right > actions.left &&
            title.top < actions.bottom &&
            title.bottom > actions.top
          );
        })(),
      };
    });
    if (
      result.overflow ||
      result.outside.length ||
      result.small.length ||
      result.crowdedSelect.length ||
      result.smallText.length ||
      result.clippedFields.length ||
      result.titleCollision
    )
      findings.push({ label, width: page.viewportSize().width, ...result });
    if (!menus) return;
    const root = (await page.getByRole("dialog").count())
      ? page.getByRole("dialog").last()
      : page;
    for (const control of await root.locator("select:visible:enabled").all()) {
      await control.click();
      const menu = page.locator(".dropdown-menu:popover-open");
      await menu.waitFor();
      const box = await menu.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(box && box.width > 0 && box.height > 0, label);
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, label);
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, label);
      assert.equal(await control.getAttribute("aria-expanded"), "true", label);
      await page.keyboard.press("Escape");
      assert.equal(await menu.count(), 0, label);
    }
  }
  async function sizes(label, options) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await inspect(label, options);
      if ([390, 1440].includes(width)) {
        await page.evaluate(() => {
          scrollTo(0, 0);
          document.activeElement?.blur();
          [...document.querySelectorAll("dialog:modal")]
            .at(-1)
            ?.querySelector(".dialog-body")
            ?.scrollTo(0, 0);
        });
        await page.screenshot({
          path: `${screenshots}/${label}-${width}.png`,
          animations: "disabled",
          fullPage: !(await page.getByRole("dialog").count()),
        });
      }
    }
  }
  const paths = [
    "/",
    "/missing",
    "/releases",
    "/discover",
    "/search",
    "/stats",
    "/removed",
    "/settings",
    "/data",
    "/terms",
    "/privacy",
    seriesPath(title),
  ];
  for (const theme of ["light", "dark"]) {
    await context.request.patch(url + "/api/preferences", { data: { theme } });
    for (const path of paths) {
      await page.goto(url + path);
      if (await page.locator("#addButton").count())
        await page.waitForFunction(() => !!window.bookCollection?.state.data);
      await page.locator(".site-activity").waitFor({ state: "hidden" });
      await sizes(
        `${theme}-${path.startsWith("/series/") ? "series" : path.slice(1) || "shelf"}`,
      );
    }
  }

  await context.request.patch(url + "/api/preferences", {
    data: { theme: "light" },
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#collectionFilters > summary").click();
  await sizes("expanded-filters");
  await page.locator("#toggleSelection").click();
  await sizes("bulk-actions");
  await page.locator("#selectAllBooks").click();
  await page.locator("#mergeSeriesButton").click();
  await sizes("merge-series");
  await page.locator("#cancelMergeSeries").click();
  await page.locator("#bulkMoveBooks").click();
  await sizes("bulk-remove");
  await page.locator("#cancelBulkRemove").click();
  await page.locator("#toggleSelection").click();
  await page.locator("#addButton").click();
  await page.locator(".book-extras > summary").click();
  await sizes("book-entry");
  await page.locator("#scanButton").click();
  await sizes("scanner");
  await page.locator("#closeScan").click();
  await page.locator("#cancelBook").click();
  await page.locator("#checkBookButton").click();
  await page.locator("#checkSearch").fill("collector");
  await sizes("check-book");
  await page.locator("#checkIsbn").fill("9780316769488");
  await page.locator("#checkIsbnButton").click();
  await page
    .getByRole("button", { name: "Link this ISBN", exact: true })
    .first()
    .click();
  await sizes("link-isbn");
  await page.locator("#cancelIsbn").click();

  await page.goto(url + seriesPath(title));
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator(".book-card").first().click();
  await page.locator("#removeButton").click();
  await sizes("remove-book");
  await page.locator("#cancelRemove").click();
  await page.locator("#cancelBook").click();
  await page.locator("#editTitleButton").click();
  await sizes("title-details");
  await page.locator("#cancelTitle").click();
  await page.locator("#editVolumesButton").click();
  await page.locator(".series-edit-toggle").first().click();
  await sizes("volume-editor");

  for (const theme of ["light", "dark"]) {
    await context.request.patch(url + "/api/preferences", { data: { theme } });
    await page.goto(url + "/admin");
    await page
      .getByRole("heading", { name: "Scraping queue", exact: true })
      .waitFor();
    await page.getByLabel("Live updates", { exact: true }).uncheck();
    for (const section of [
      "Scraping queue",
      "Publisher crawls",
      "Scraper debugger",
      "Users",
      "Metadata & caches",
      "System records",
    ]) {
      await page.getByRole("button", { name: section, exact: true }).click();
      await sizes(
        `${theme}-admin-` + section.toLowerCase().replaceAll(/[^a-z]+/g, "-"),
      );
      if (section === "Users") {
        await page
          .getByRole("button", { name: "Manage account", exact: true })
          .first()
          .click();
        await sizes(`${theme}-account-management`);
      }
    }
  }
  await context.clearCookies();
  for (const path of [
    "/login",
    "/relink",
    "/relink#token=" + "a".repeat(64),
    "/terms",
    "/privacy",
    "/not-a-real-page",
  ]) {
    if (path.includes("#")) await page.goto(url + "/login");
    await page.goto(url + path);
    if (path.includes("#"))
      await page.locator("input[name=confirmed]").waitFor();
    await sizes(
      "public-" + (path.includes("#") ? "relink-invitation" : path.slice(1)),
    );
  }
  assert.deepEqual(findings, []);
  for (const scenario of [
    "controls.browser.mjs",
    "mobile-adding.browser.mjs",
    "series-edit.browser.mjs",
  ]) {
    const child = spawn(process.execPath, ["tests/browser/" + scenario], {
      env: {
        ...process.env,
        BOOKS_TEST_URL: url,
        BOOKS_TEST_SESSION: owner.token,
      },
      stdio: "inherit",
    });
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    assert.equal(code, 0, scenario);
  }
  console.log(
    "PASS page/control consistency at seven widths, light/dark libraries and admin, public states and entry overlays",
  );
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await mkdir(screenshots, { recursive: true });
  await writeFile(
    `${screenshots}/findings.json`,
    JSON.stringify(findings, null, 2),
  );
}
