import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const captures = join(process.cwd(), ".impeccable", "review", "metadata");
mkdirSync(captures, { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(testUrl + "/data");
  await page.getByRole("heading", { name: "Metadata & cache" }).waitFor();
  assert.match(
    await page.locator(".metadata-summary").innerText(),
    /4\s+cached records/,
  );
  const search = page.getByLabel("Search records");
  await search.fill("9780316769488");
  await page.getByText("1 matching records", { exact: false }).waitFor();
  await page.locator(".metadata-record summary").click();
  await page.locator("pre[aria-label='Cached content']").waitFor();
  assert.match(await page.locator("pre").textContent(), /208/);
  await search.fill("");
  await page.getByText("4 matching records", { exact: false }).waitFor();

  let first = true,
    calls = 0,
    fillMissing;
  const started = Promise.withResolvers(),
    release = Promise.withResolvers();
  await page.route("**/api/rpc", async (route) => {
    const request = route.request().postDataJSON();
    if (request.name !== "recrawlMetadata") return route.continue();
    calls++;
    fillMissing = request.arg.fillMissing;
    if (first) {
      first = false;
      started.resolve();
      await release.promise;
    }
    await route.fulfill({
      json: {
        id: request.arg.id,
        filled: 0,
        status: calls === 1 ? "warning" : "failed",
        message:
          calls === 1
            ? "No exact ISBN match found. Try again later."
            : "Source unavailable. Previous metadata kept.",
      },
    });
  });
  await page.getByLabel("Fill missing book metadata").check();
  await page
    .getByRole("button", { name: "Re-crawl 2 sources", exact: true })
    .click();
  await started.promise;
  await page
    .getByRole("button", { name: "Stop after current source", exact: true })
    .click();
  release.resolve();
  await page
    .getByText("Stopped. Checked 1 of 2 sources.", { exact: true })
    .waitFor();
  assert.equal(calls, 1);
  assert.equal(fillMissing, true);
  await page.getByLabel("Source", { exact: true }).selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "Re-crawl source", exact: true })
    .click();
  await page
    .getByText("Re-crawl finished. Checked 1 of 1 sources.", { exact: true })
    .waitFor();
  assert.match(await page.locator(".metadata-results").innerText(), /1 failed/);
  await page.getByLabel("Source", { exact: true }).selectOption("all");
  await page.locator(".metadata-record details[open] summary").click();
  await page.evaluate(() => window.scrollTo(0, 0));
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
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await page.screenshot({
    path: join(captures, "mobile-dark.png"),
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "Purge expired", exact: true })
    .click();
  await page.getByText("Purged 1 cached record.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Purge filtered records", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.match(
    await page.locator(".metadata-summary").innerText(),
    /3\s+cached records/,
  );
  await search.fill("9780316769488");
  await page.getByText("1 matching records", { exact: false }).waitFor();
  await page.locator(".metadata-record summary").click();
  await page
    .getByRole("button", { name: "Purge this record", exact: true })
    .click();
  await page
    .getByText("No records match these filters.", { exact: false })
    .waitFor();
  await search.fill("");
  await page.getByText("2 matching records", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "Purge filtered records", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm purge", exact: true })
    .click();
  await page.getByText("1 matching records", { exact: false }).waitFor();
  assert.match(
    await page.locator(".metadata-records").innerText(),
    /Retry cooldowns/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Purge filtered records", exact: true })
      .isDisabled(),
    true,
  );
  const overview = await (
    await page.request.post(testUrl + "/api/rpc", {
      data: { name: "getMetadataOverview" },
    })
  ).json();
  assert.equal(overview.coverage.books, 2);
  assert.equal(overview.targets.length, 2);
  const rejected = await page.request.post(testUrl + "/api/rpc", {
    headers: { origin: "https://cross-origin.test" },
    data: { name: "purgeMetadataCache", arg: {} },
  });
  assert.equal(rejected.status(), 403);
  assert.deepEqual(errors, []);
  console.log(
    "PASS metadata inspection, scoped purges, cooldown protection, source queue, optional fill, cancellation and mobile themes",
  );
} finally {
  await browser.close();
}
