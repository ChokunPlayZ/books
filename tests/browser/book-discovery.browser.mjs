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
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [],
    requests = [];
  const gate = Promise.withResolvers(),
    started = Promise.withResolvers();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name !== "lookupBook") return route.continue();
    requests.push(arg);
    if (arg.volume === "9") {
      started.resolve();
      await gate.promise;
    }
    return route.fulfill({
      json: {
        found: true,
        isbn: "9786165998840",
        warnings: [],
        details: {
          series: "ดอกรักผลิบานที่กลางใจ",
          title: "ดอกรักผลิบานที่กลางใจ เล่ม " + arg.volume,
          volume: Number(arg.volume),
          type: "Manga",
          edition: "Manga (TH)",
          publisher: "Phoenix Next",
          source: "Naiin",
          isbn: "9786165998840",
          isbnVerified: true,
          pageCount: 192,
        },
      },
    });
  });
  await page.goto(testUrl);
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  await page.locator("#addButton").click();
  await page.locator("#series").fill("ดอกรักผลิบานที่กลางใจ");
  await page.locator("#volume").fill("8");
  assert.equal(await page.locator("#isbn").inputValue(), "");
  await page.locator("#lookupButton").click();
  await page.waitForFunction(
    () => document.querySelector("#isbn").value === "9786165998840",
  );
  assert.equal(await page.locator("#publisher").inputValue(), "Phoenix Next");
  assert.equal(await page.locator("#pageCount").inputValue(), "192");
  assert.equal(requests[0].series, "ดอกรักผลิบานที่กลางใจ");
  assert.equal(requests[0].volume, "8");
  await page.locator("#closeBook").click();
  await page.locator("#addButton").click();
  await page.locator("#series").fill("ดอกรักผลิบานที่กลางใจ");
  await page.locator("#volume").fill("9");
  await page.locator("#lookupButton").click();
  await started.promise;
  await page.locator("#volume").fill("10");
  gate.resolve();
  await page.locator("#isbnLookupStatus").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#isbn").inputValue(),
    "",
    "A late result cannot fill the wrong volume",
  );
  assert.equal(await page.locator("#volume").inputValue(), "10");
  assert.deepEqual(errors, []);
  console.log(
    "Name-and-volume lookup fills verified metadata and ignores superseded volumes.",
  );
} finally {
  await browser.close();
}
