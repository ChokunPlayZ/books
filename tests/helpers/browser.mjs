import { chromium } from "playwright";

export const testUrl = process.env.BOOKS_TEST_URL;
if (!testUrl)
  throw new Error(
    "Run browser scenarios through npm run test:e2e so they use an isolated test database.",
  );

// UI scenarios receive a real, pre-seeded session instead of a production auth
// bypass. The authentication scenarios deliberately do not use this fixture.
if (process.env.BOOKS_TEST_SESSION) {
  const url = new URL(testUrl);
  const storageState = {
    cookies: [
      {
        name: "book_collection_session",
        value: process.env.BOOKS_TEST_SESSION,
        domain: url.hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    const newPage = browser.newPage.bind(browser);
    browser.newContext = (options) => newContext({ storageState, ...options });
    browser.newPage = (options) => newPage({ storageState, ...options });
    return browser;
  };
}
