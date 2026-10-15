import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});

async function expectTheme(page, theme) {
  await page.waitForFunction(
    (expected) =>
      document.documentElement.dataset.theme === expected &&
      document.querySelector(".theme-toggle")?.getAttribute("aria-pressed") ===
        String(expected === "dark"),
    theme,
  );
  assert.equal(
    await page
      .locator("html")
      .evaluate((html) => getComputedStyle(html).colorScheme),
    theme,
  );
}

async function expectNoOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Dark theme" }).isVisible(),
    true,
  );
}

try {
  const context = await browser.newContext({
    colorScheme: "light",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(testUrl);
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");

  // An explicit choice overrides the system and survives a full navigation.
  const toggle = page.getByRole("button", { name: "Dark theme" });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expectTheme(page, "light");
  await page.reload();
  await expectTheme(page, "light");
  await toggle.click();
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "dark");

  // Other tabs share the preference, including when it is cleared.
  const otherPage = await context.newPage();
  await otherPage.goto(testUrl + "/data");
  await expectTheme(otherPage, "dark");
  await otherPage.getByRole("button", { name: "Dark theme" }).click();
  await expectTheme(page, "light");
  await otherPage.evaluate(() => localStorage.removeItem("books-theme"));
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  await toggle.click();
  await toggle.click();
  await otherPage.close();

  for (const path of ["/", "/data", "/login"]) {
    await page.goto(testUrl + path);
    await expectTheme(page, "dark");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page);
    }
  }
  await page.goto(testUrl);
  await page.locator("#addButton").click();
  await page.locator("#bookDialog[open]").waitFor();
  assert.equal(
    await page.locator("#bookDialog").evaluate((dialog) => {
      const background = getComputedStyle(dialog).backgroundColor;
      return (
        background !== "rgb(255, 255, 255)" && background !== "rgba(0, 0, 0, 0)"
      );
    }),
    true,
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  await context.close();

  // The saved theme is applied even before the React bundles can hydrate.
  const beforeHydration = await browser.newContext({ colorScheme: "light" });
  await beforeHydration.addInitScript(() => {
    localStorage.setItem("books-theme", "dark");
  });
  const unhydrated = await beforeHydration.newPage();
  await unhydrated.route("**/_next/**/*.js", (route) => route.abort());
  await unhydrated.goto(testUrl + "/login", { waitUntil: "domcontentloaded" });
  assert.equal(
    await unhydrated.locator("html").getAttribute("data-theme"),
    "dark",
  );
  assert.equal(
    await unhydrated
      .locator("body")
      .evaluate((body) => getComputedStyle(body).backgroundColor),
    "rgb(21, 28, 24)",
  );
  await beforeHydration.close();

  // Browsers that deny storage still follow the system and allow switching.
  const noStorage = await browser.newContext({ colorScheme: "dark" });
  await noStorage.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    });
  });
  const privatePage = await noStorage.newPage();
  await privatePage.goto(testUrl + "/login");
  await expectTheme(privatePage, "dark");
  await privatePage.getByRole("button", { name: "Dark theme" }).click();
  await expectTheme(privatePage, "light");
  await noStorage.close();

  console.log(
    "PASS system theme, accessible toggle, persistence, cross-tab sync, responsive pages, dark dialogs, pre-hydration theme and unavailable storage",
  );
} finally {
  await browser.close();
}
