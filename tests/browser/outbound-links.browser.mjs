import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});

try {
  // Public links exercise the production renderer without database fixtures.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const source =
    testUrl + "/privacy?private=collection-search#storage-and-providers";
  const requests = [];
  await context.route("https://policies.google.com/**", async (route) => {
    requests.push(route.request());
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>External destination</title><p>Destination</p>",
    });
  });
  const response = await page.goto(source);
  assert.equal(response.status(), 200);
  assert.match(
    await response.text(),
    /https:\/\/policies\.google\.com\/privacy\?ref=meemai\.ckl\.moe/,
    "Attribution must already exist in server-rendered links",
  );
  const external = page.locator('main a[href^="https://"]');
  assert.equal(await external.count(), 2);
  for (const link of await external.all()) {
    const href = new URL(await link.getAttribute("href"));
    assert.equal(href.searchParams.get("ref"), "meemai.ckl.moe");
    assert.equal(await link.getAttribute("rel"), "noopener");
    assert.equal(
      await link.getAttribute("referrerpolicy"),
      "strict-origin-when-cross-origin",
    );
  }
  assert.equal(
    await page.locator('main a[href^="mailto:"]').getAttribute("href"),
    "mailto:chokunplayz@ckl.moe",
  );
  assert.equal(
    await page.locator('main a[href="/terms"]').getAttribute("href"),
    "/terms",
  );

  const google = page.locator('main a[href^="https://policies.google.com/"]');
  // Keyboard navigation uses the same attributed href, not a click handler.
  await google.focus();
  await google.press("Enter");
  await page.waitForURL(
    "https://policies.google.com/privacy?ref=meemai.ckl.moe",
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers().referer, new URL(testUrl).origin + "/");
  console.log(
    "PASS outbound attribution: rendered URLs, keyboard navigation, safe link attributes and origin-only referrers",
  );
} finally {
  await browser.close();
}
