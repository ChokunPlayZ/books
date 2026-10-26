import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

// Chrome disables installation in incognito contexts. Use a disposable profile.
const profile = mkdtempSync(join(tmpdir(), "book-collection-pwa-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 390, height: 844 },
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});

try {
  const page = await context.newPage();
  const get = (path) => page.request.get(new URL(path, testUrl).href);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Installation assets and worker registration must work before signing in.
  await page.goto(testUrl + "/login");
  const manifestLink = page.locator('link[rel="manifest"]');
  const response = await get(await manifestLink.getAttribute("href"));
  assert.equal(response.status(), 200);
  assert.match(
    response.headers()["content-type"],
    /application\/manifest\+json/,
  );
  const manifest = await response.json();
  assert.equal(manifest.name, "Book Collection");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));

  const appleIcon = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  for (const { src, sizes } of [
    ...manifest.icons,
    { src: appleIcon, sizes: "180x180" },
  ]) {
    const icon = await get(src);
    assert.equal(icon.status(), 200, src);
    assert.match(icon.headers()["content-type"], /image\/png/);
    const bytes = await icon.body();
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(
      `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,
      sizes,
      src,
    );
  }

  const worker = await get("/sw.js");
  assert.equal(worker.status(), 200);
  assert.match(worker.headers()["content-type"], /application\/javascript/);
  assert.match(worker.headers()["cache-control"], /no-store/);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    }),
    testUrl + "/",
  );

  const session = await context.newCDPSession(page);
  const browserManifest = await session.send("Page.getAppManifest");
  assert.deepEqual(browserManifest.errors, []);
  const installability = await session.send("Page.getInstallabilityErrors");
  assert.deepEqual(installability.installabilityErrors, []);

  await context.setOffline(true);
  const destination = testUrl + "/stats?period=year";
  await page.goto(destination);
  await page.getByRole("heading", { name: "You're offline" }).waitFor();
  assert.equal(page.url(), destination);
  await page.getByRole("link", { name: "Try again" }).click();
  await page.getByRole("heading", { name: "You're offline" }).waitFor();
  assert.equal(page.url(), destination);

  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `outputs/pwa-offline-${scheme}.png` });
  }

  // API failures must remain failures, including document-style downloads.
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "getCollection" }),
        });
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  const download = await context.newPage();
  await assert.rejects(download.goto(testUrl + "/api/backup"));
  await download.close();

  await context.setOffline(false);
  await page.getByRole("link", { name: "Try again" }).click();
  await page.waitForURL("**/login?returnTo=*");
  await page.getByRole("heading", { name: "Open your library" }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), "/stats");

  assert.deepEqual(
    await page.evaluate(async () => {
      const keys = await caches.keys();
      const urls = [];
      for (const key of keys) {
        const cache = await caches.open(key);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls;
    }),
    [testUrl + "/offline.html"],
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS PWA installation metadata, PNG icons, public worker, offline navigation, responsive fallback, API isolation and authenticated recovery",
  );
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
