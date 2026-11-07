import "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.BOOKS_TEST_URL;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});

try {
  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"]) {
      // Deliberately ignore the signed-in fixture: policies must be public.
      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        viewport: { width, height: 844 },
        colorScheme,
      });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        for (const [path, title] of [
          ["/terms", "Terms of Service"],
          ["/privacy", "Privacy Policy"],
        ]) {
          const response = await page.goto(url + path);
          assert.equal(response.status(), 200);
          assert.equal(new URL(page.url()).pathname, path);
          assert.equal(await page.title(), title + " · meemai");
          assert.equal(
            await page.getByRole("heading", { level: 1 }).textContent(),
            title,
          );
          assert.equal(await page.locator("main").getAttribute("lang"), "en");
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
            true,
            `${path}: no overflow at ${width}px in ${colorScheme} mode`,
          );
          const legal = page.getByRole("navigation", { name: "Legal" });
          assert.equal(
            await legal
              .getByRole("link", { name: "Terms of Service", exact: true })
              .getAttribute("href"),
            "/terms",
          );
          assert.equal(
            await legal
              .getByRole("link", { name: "Privacy Policy", exact: true })
              .getAttribute("href"),
            "/privacy",
          );
          const text = await page.locator("main").innerText();
          assert.match(text, /CKLabs/);
          const contacts = page.locator(
            'main a[href="mailto:chokunplayz@ckl.moe"]',
          );
          assert.ok(await contacts.count(), `${path}: public CKLabs contact`);
          assert.equal(
            await contacts.first().textContent(),
            "chokunplayz@ckl.moe",
          );
          if (path === "/terms") {
            assert.match(text, /free of charge/);
            assert.match(text, /terminate any\s+account/);
            assert.match(text, /upstream services/);
            assert.match(text, /exploiting bugs, security vulnerabilities/);
          } else {
            assert.match(text, /store where you bought them, purchase dates/);
            assert.match(text, /share users’ book and purchase data/);
            assert.match(text, /stored entirely in Thailand/);
            assert.match(text, /Google OAuth/);
            assert.match(text, /Cloudflare, Inc\./);
            assert.match(text, /outside Thailand/);
          }
        }
        await page
          .getByRole("navigation", { name: "Legal" })
          .getByRole("link", { name: "Terms of Service", exact: true })
          .click();
        await page.waitForURL(url + "/terms");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  }
  console.log(
    "PASS public legal pages, policy content, responsive layout and links",
  );
} finally {
  await browser.close();
}
