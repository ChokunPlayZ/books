import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const captures = join(process.cwd(), "outputs", "library-data");
mkdirSync(captures, { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith("/api/rpc"))
      requests.push(request.postDataJSON());
  });
  await page.goto(testUrl + "/data");
  await page
    .getByRole("heading", { name: "Export your books", exact: true })
    .waitFor();
  assert.equal(await page.locator("#metadata-maintenance").count(), 0);
  assert.doesNotMatch(
    await page.locator("main").innerText(),
    /cache|re-crawl|purge/i,
  );
  assert.ok(!(await page.content()).includes("Maintenance cached metadata"));
  assert.equal(await page.locator(".data-sections a").count(), 2);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export library", exact: true }).click(),
  ]);
  const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.equal(exported.books.length, 2);
  assert.deepEqual(Object.keys(exported).sort(), [
    "books",
    "format",
    "version",
  ]);
  for (const book of exported.books) {
    assert.deepEqual(Object.keys(book).sort(), [
      "date",
      "edition",
      "isbn",
      "note",
      "price",
      "source",
      "status",
      "title",
      "type",
      "volume",
    ]);
  }
  await page.screenshot({
    path: join(captures, "desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: join(captures, "mobile.png"), fullPage: true });
  await page.getByLabel("Appearance", { exact: true }).selectOption("dark");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.screenshot({
    path: join(captures, "mobile-dark.png"),
    fullPage: true,
  });
  assert.ok(!requests.some(({ name }) => /Metadata|Cache/.test(name)));
  assert.deepEqual(errors, []);
  console.log(
    "PASS library settings omit internal maintenance and download only personal book fields on desktop and mobile",
  );
} finally {
  await browser.close();
}
