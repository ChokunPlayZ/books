import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { canonicalIsbn } from "../../lib/domain/isbn.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const thaiPublishers = [
    "Phoenix Next",
    "First Page Pro",
    "Animag",
    "DEXpress",
    "Luckpim",
    "Siam Inter Comics (Yaakz)",
  ];
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [],
      searches = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/rpc", async (route) => {
      const { name, arg } = route.request().postDataJSON();
      if (name === "getCollection") {
        const response = await route.fetch();
        const data = await response.json();
        data.options.publisher = [
          "Yen Press",
          "Ize Press",
          ...thaiPublishers,
          "Kodansha JP",
          "Lily House",
          "Unlisted publisher",
        ];
        return route.fulfill({ json: data });
      }
      if (name === "lookupIsbn")
        return route.fulfill({
          json: { isbn: canonicalIsbn(arg), found: false, warnings: [] },
        });
      if (name === "getPublisherDirectory")
        return route.fulfill({
          json: { url: arg.url, titles: [], items: [], complete: true },
        });
      if (name === "getPublisherReleases")
        return route.fulfill({ json: { items: [], complete: true } });
      if (name === "searchPublisherIsbn") {
        searches.push(arg);
        return route.fulfill({ json: { ...arg, items: [], warnings: [] } });
      }
      return route.continue();
    });
    await page.goto(testUrl);
    await page.waitForFunction(() => !!window.bookCollection?.state.data);
    await page.locator("#addButton").click();
    const suggestions = () =>
      page
        .locator("#publisherOptions option")
        .evaluateAll((options) => options.map((option) => option.value));
    for (const type of ["Manga (JP)", "Manga (TH)", "LN (TH)"]) {
      await page.locator("#type").selectOption(type);
      assert.equal((await suggestions()).includes("Yen Press"), false);
      assert.equal((await suggestions()).includes("Ize Press"), false);
      assert.equal(
        (await suggestions()).includes("Kodansha JP"),
        type.includes("(JP)"),
      );
      for (const publisher of thaiPublishers)
        assert.equal(
          (await suggestions()).includes(publisher),
          type.includes("(TH)"),
        );
    }
    await page.locator("#type").selectOption("Manga (EN)");
    assert.equal((await suggestions()).includes("Yen Press"), true);
    assert.equal((await suggestions()).includes("Kodansha JP"), false);
    for (const publisher of thaiPublishers)
      assert.equal((await suggestions()).includes(publisher), false);
    await page.locator("#type").selectOption("Manga (JP)");
    assert.equal((await suggestions()).includes("Kodansha JP"), true);
    assert.equal((await suggestions()).includes("Lily House"), false);
    await page.locator("#isbn").fill("0140328726");
    assert.equal((await suggestions()).includes("Yen Press"), false);
    assert.equal((await suggestions()).includes("Kodansha JP"), false);
    await page.locator("#type").selectOption("Manga (EN)");
    assert.equal((await suggestions()).includes("Yen Press"), true);
    assert.equal((await suggestions()).includes("Phoenix Next"), false);
    await page.locator("#lookupButton").click();
    await page.locator("#lookupResult").waitFor();
    assert.deepEqual(await page.locator("#lookupResult a").allTextContents(), [
      "Search this ISBN at Kinokuniya ↗",
    ]);
    await page.locator("#isbn").fill("4063951375");
    assert.equal((await suggestions()).includes("Kodansha JP"), false);
    await page.locator("#type").selectOption("Manga (JP)");
    assert.equal((await suggestions()).includes("Kodansha JP"), true);
    await page.locator("#lookupButton").click();
    await page.locator("#lookupResult").waitFor();
    assert.equal((await suggestions()).includes("Yen Press"), false);
    assert.deepEqual(await page.locator("#lookupResult a").allTextContents(), [
      "Search this ISBN at Kinokuniya ↗",
    ]);
    assert.equal(
      await page
        .locator("#bookDialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
      true,
    );
    await page.screenshot({
      path: fileURLToPath(
        new URL(`../../outputs/book-sources-${width}.png`, import.meta.url),
      ),
    });
    await page.locator("#isbn").fill("9786166247275");
    await page.locator("#lookupButton").click();
    await page.locator("#lookupResult").waitFor();
    assert.equal(await page.locator("#lookupResult a").count(), 1);
    await page.locator("#type").selectOption("Manga (TH)");
    assert.equal(await page.locator("#lookupResult a").count(), 6);
    await page.locator("#type").selectOption("Manga (EN)");
    assert.equal(await page.locator("#lookupResult a").count(), 1);
    await page.locator("#type").selectOption("Manga (JP)");
    assert.equal(await page.locator("#lookupResult a").count(), 1);
    await page.locator("#isbn").fill("");
    assert.equal((await suggestions()).includes("Kodansha JP"), true);
    await page.locator("#cancelBook").click();

    await page.goto(testUrl + "/releases");
    await page.waitForFunction(() => !!window.bookCollection?.state.data);
    await page.locator("#releaseSearch").fill("4063951375");
    assert.equal(
      await page
        .locator('#releasePublisher option[value="yenpress"]')
        .evaluate((option) => option.hidden && option.disabled),
      true,
    );
    assert.doesNotMatch(
      await page.locator("#publisherSources").textContent(),
      /Yen Press|Phoenix Next|Lily House/,
    );
    await page.locator("#releaseSearch").fill("0140328726");
    assert.equal(
      await page
        .locator('#releasePublisher option[value="yenpress"]')
        .evaluate((option) => option.hidden || option.disabled),
      false,
    );
    await page.locator("#releaseSearch").fill("");
    assert.equal(
      await page
        .locator('#releasePublisher option[value="phoenix"]')
        .evaluate((option) => option.hidden || option.disabled),
      false,
    );

    await page.goto(testUrl + "/discover");
    await page.waitForFunction(
      () =>
        !!window.bookCollection?.state.data &&
        !window.bookCollection.state.discoveryLoading,
    );
    await page.locator("#discoverySearch").fill("4063951375");
    await page.waitForFunction(
      () =>
        document
          .getElementById("discoveryPreset")
          .value.includes("kodansha.co.jp") &&
        !window.bookCollection.state.discoveryLoading,
    );
    assert.equal(
      await page
        .locator('#discoveryPreset option[value="https://yenpress.com/"]')
        .evaluate((option) => option.hidden && option.disabled),
      true,
    );
    await page.waitForFunction(() =>
      document
        .getElementById("discoveryCount")
        .textContent.includes("0 books for ISBN"),
    );
    assert.ok(searches.some((request) => request.publisherId === "kodansha"));
    assert.ok(searches.every((request) => request.publisherId === "kodansha"));
    await page.locator("#discoverySearch").fill("0140328726");
    await page.waitForFunction(
      () =>
        document.getElementById("discoveryPreset").value ===
          "https://yenpress.com/" &&
        !window.bookCollection.state.discoveryLoading,
    );
    assert.equal(
      await page
        .locator('#discoveryPreset option[value="https://yenpress.com/"]')
        .evaluate((option) => option.hidden || option.disabled),
      false,
    );
    await page.locator("#discoverySearch").fill("");
    assert.equal(
      await page
        .locator(
          '#discoveryPreset option[value="https://www.phoenixnext.com/gl.html"]',
        )
        .evaluate((option) => option.hidden || option.disabled),
      false,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS applicable publisher choices, ISBN links, release sources and discovery searches on phone and desktop",
  );
} finally {
  await browser.close();
}
