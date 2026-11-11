import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";
import { seriesPath } from "../../lib/domain/navigation.ts";

const coverId = "a".repeat(64);
const lazyId = "b".repeat(64);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
  "base64",
);
const result = (id, series, volume, extra = {}) => ({
  id,
  kind: "title",
  title: `${series}, volume ${volume}`,
  series,
  publisher: "Phoenix Next",
  type: "Manga",
  volume,
  isbn: "",
  url: "https://www.phoenixnext.com/" + id + ".html",
  known: true,
  owned: false,
  sources: [],
  score: 0,
  ...extra,
});
const results = [
  result("owned-1", "Moon Library", 1, {
    owned: true,
    librarySeries: "Moon Library",
    coverId,
  }),
  result("owned-2", "Moon Library", 2, {
    owned: true,
    librarySeries: "Moon Library",
    coverId,
  }),
  result("online-3", "Moon Library", 3, {
    coverUrl: "https://www.phoenixnext.com/media/catalog/product/moon.png",
    sources: [
      {
        id: "phoenix",
        name: "Phoenix Next",
        url: "https://www.phoenixnext.com/online-3.html",
      },
    ],
  }),
  result("no-cover", "Moon Garden", 1),
  result("broken-cover", "Moon Station", 1, { coverId: "c".repeat(64) }),
  result("novel", "Moon Library", 1, { type: "Light novel", coverId }),
  result("publisher", "Moon Press", "", {
    kind: "publisher",
    title: "Moon Press",
    series: "",
  }),
];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const errors = [];
  const coverRequests = [];
  const completionRequests = [];
  const searches = [];
  const slowStarted = Promise.withResolvers();
  const slowRelease = Promise.withResolvers();
  const completionRelease = Promise.withResolvers();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/covers/*", (route) =>
    route.request().url().endsWith("c".repeat(64))
      ? route.abort()
      : route.fulfill({ body: png, contentType: "image/png" }),
  );
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "searchKnownSuggestions") {
      completionRequests.push({ name, query: arg.query });
      if (arg.query === "Slow") {
        slowStarted.resolve();
        await slowRelease.promise;
        return route
          .fulfill({
            json: {
              query: arg.query,
              suggestions: [
                {
                  value: "Slow stale name",
                  label: "Previously found",
                  known: true,
                },
              ],
              sources: [],
            },
          })
          .catch(() => {});
      }
      if (arg.query === "Failure")
        return route.fulfill({ status: 503, json: {} });
      const values = arg.query.startsWith("ดอก")
        ? [
            "ดอกรักผลิบานที่กลางใจ",
            "ดอกรักผลิบานที่กลางใจ ฉบับทดสอบชื่อที่ยาวมากเพื่อยืนยันว่าคำแนะนำตัดบรรทัดได้โดยไม่ล้นหน้าจอบนโทรศัพท์",
            "ดอกไม้ในสวน",
            "ดอกไม้ใต้แสงจันทร์",
            "ดอกไม้หลังฝน",
            "ดอกไม้แห่งวันพรุ่งนี้",
            "ดอกไม้บนชั้นหนังสือ",
            "ดอกไม้ยามเช้า",
          ]
        : arg.query === "Empty"
          ? []
          : ["Moon Library"];
      return route.fulfill({
        json: {
          query: arg.query,
          suggestions: values.map((value) => ({
            value,
            label: "Your library",
            known: true,
          })),
          sources:
            arg.query === "Mo" ? [{ id: "phoenix", name: "Phoenix Next" }] : [],
        },
      });
    }
    if (name === "searchExternalSuggestions") {
      completionRequests.push({ name, query: arg.query });
      await completionRelease.promise;
      return route.fulfill({
        json: {
          query: arg.query,
          suggestions: [
            { value: "Mo", label: "Phoenix Next", known: false },
            { value: "Moon Garden", label: "Phoenix Next", known: false },
          ],
          sources: [],
        },
      });
    }
    if (name === "searchKnownEntities") {
      searches.push(arg.query);
      return route.fulfill({
        json: {
          query: arg.query,
          results: arg.query === "Nothing" ? [] : results,
          sources: [],
        },
      });
    }
    if (name === "getSearchCover") {
      coverRequests.push(arg);
      return route.fulfill({ json: { coverId: lazyId } });
    }
    return route.continue();
  });
  await page.goto(testUrl + "/search?q=Moon");
  const cards = page.locator("#universalSearchResults > li");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#universalSearchResults > li").length === 5,
  );
  const group = page.getByRole("button", { name: "Group series", exact: true });
  assert.equal(await group.getAttribute("aria-pressed"), "true");
  await group.click();
  assert.equal(await cards.count(), 7);
  await page.locator(`img[src="/api/covers/${lazyId}"]`).waitFor();
  assert.ok(
    coverRequests.some(
      (request) => request.id === "online-3" && request.query === "Moon",
    ),
  );
  assert.equal(
    await cards.first().locator(".universal-search-book").getAttribute("href"),
    seriesPath("Moon Library"),
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".universal-search-result .cover-placeholder")
        .length === 2,
  );
  assert.equal(
    await page.locator(".universal-search-result .cover-placeholder").count(),
    2,
  );
  const boxes = await cards.evaluateAll((items) =>
    items.map((item) => {
      const { x, y } = item.getBoundingClientRect();
      return { x, y };
    }),
  );
  assert.ok(boxes.filter((box) => box.y === boxes[0].y).length >= 4);
  const searchWidth = await page
    .locator(".universal-search")
    .evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(searchWidth > 1000, "desktop search uses the full content width");
  if (process.env.BOOKS_TEST_SCREENSHOT_DIR)
    await page.screenshot({
      path: process.env.BOOKS_TEST_SCREENSHOT_DIR + "/search-desktop.png",
      fullPage: true,
    });
  await group.click();
  assert.equal(await group.getAttribute("aria-pressed"), "true");
  assert.equal(await cards.count(), 5);
  if (process.env.BOOKS_TEST_SCREENSHOT_DIR)
    await page.screenshot({
      path: process.env.BOOKS_TEST_SCREENSHOT_DIR + "/search-grouped.png",
      fullPage: true,
    });
  const series = page.locator(".universal-search-series");
  await series.locator("summary").click();
  assert.equal(await series.locator("details").getAttribute("open"), "");
  if (process.env.BOOKS_TEST_SCREENSHOT_DIR)
    await page.screenshot({
      path: process.env.BOOKS_TEST_SCREENSHOT_DIR + "/search-expanded.png",
      fullPage: true,
    });
  assert.equal(await series.locator(".universal-search-volume").count(), 3);
  assert.match(
    await series.locator("ol").innerText(),
    /Volume 1[\s\S]*Volume 2[\s\S]*Volume 3/,
  );
  assert.equal(
    await series
      .getByRole("link", { name: "Phoenix Next ↗", exact: true })
      .getAttribute("href"),
    "https://www.phoenixnext.com/online-3.html?ref=meemai.ckl.moe",
  );
  await page.keyboard.press("Enter");
  assert.equal(await series.locator("details").getAttribute("open"), null);
  await group.click();
  assert.equal(await cards.count(), 7);
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  assert.equal(await group.isVisible(), true);
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "light"),
  );
  for (const width of [1440, 1000, 760, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `no overflow at ${width}px`,
    );
    if (width <= 760) {
      const columns = await page
        .locator(".universal-search-results")
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        );
      assert.equal(columns, width < 560 ? 2 : 3);
    }
    if (width === 390 && process.env.BOOKS_TEST_SCREENSHOT_DIR)
      await page.screenshot({
        path: process.env.BOOKS_TEST_SCREENSHOT_DIR + "/search-phone.png",
        fullPage: true,
      });
  }
  await page.locator("#universalSearchQuery").fill("Nothing");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("heading", { name: "No matching titles found" })
    .waitFor();
  assert.equal(await cards.count(), 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content:
      "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  // Typing completes a query without running a full catalog search.
  const input = page.getByRole("combobox", {
    name: "Title, publisher or ISBN",
  });
  const list = page.getByRole("listbox", { name: "Search suggestions" });
  const beforeSearch = searches.length;
  await input.fill("Mo");
  await page
    .getByRole("option", { name: "Moon Library Your library" })
    .waitFor();
  await input.press("ArrowDown");
  completionRelease.resolve();
  // A late exact match sorts ahead of the highlighted library name. Enter must
  // still choose that name rather than its former array position.
  await page
    .getByRole("option", { name: "Moon Garden Phoenix Next" })
    .waitFor();
  assert.equal(searches.length, beforeSearch);
  assert.equal(await input.getAttribute("aria-expanded"), "true");
  assert.ok(await input.getAttribute("aria-activedescendant"));
  assert.match(
    await page
      .locator("#" + (await input.getAttribute("aria-activedescendant")))
      .innerText(),
    /Moon Library/,
  );
  await input.press("Enter");
  assert.equal(await input.inputValue(), "Moon Library");
  assert.equal(await list.count(), 0);
  assert.equal(
    searches.length,
    beforeSearch,
    "choosing a query never submits it",
  );
  await input.press("Enter");
  await page.waitForFunction(() =>
    document
      .querySelector(".universal-search-status")
      ?.textContent.includes("Search complete"),
  );
  assert.equal(searches.at(-1), "Moon Library");
  const beforeReuse = completionRequests.length;
  await input.fill("Mo");
  await list.waitFor();
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  // The 180ms effect replays the exact browser-cache answer. It must not clear
  // a choice made immediately from the already-visible cached options.
  await page.waitForTimeout(250);
  const searchesBeforeReplay = searches.length;
  await input.press("Enter");
  assert.equal(await input.inputValue(), "Moon Library");
  assert.equal(searches.length, searchesBeforeReplay);
  await input.fill("Mo");
  await list.waitFor();
  await input.press("Escape");
  assert.equal(await input.inputValue(), "Mo");
  assert.equal(await list.count(), 0);
  assert.equal(
    completionRequests.length,
    beforeReuse,
    "cached completions appear immediately without another RPC",
  );
  await input.fill("Slow");
  await slowStarted.promise;
  await input.fill("Moon");
  slowRelease.resolve();
  await list.waitFor();
  assert.doesNotMatch(await list.innerText(), /Slow/);
  await input.press("Tab");
  assert.equal(await list.count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Search", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  for (const query of ["978616", "Empty", "Failure"]) {
    await input.fill(query);
    // Wait past both debounce intervals to prove an optional failure/miss stays quiet.
    await page.waitForTimeout(600);
    assert.equal(await list.count(), 0);
    assert.equal(await input.inputValue(), query);
  }
  assert.ok(!completionRequests.some((request) => request.query === "978616"));
  const beforeComposition = completionRequests.length;
  await input.dispatchEvent("compositionstart");
  await input.fill("Compose");
  await page.waitForTimeout(600);
  assert.equal(completionRequests.length, beforeComposition);
  await input.dispatchEvent("compositionend");
  await input.fill("ดอก");
  await list.waitFor();
  assert.equal(await list.getByRole("option").count(), 8);
  await input.press("ArrowDown");
  for (const [width, theme] of [
    [1440, "light"],
    [390, "light"],
    [390, "dark"],
    [320, "dark"],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      theme,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      JSON.stringify(
        await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll("body *")]
            .filter(
              (element) =>
                !element.closest(".tabs") &&
                element.getBoundingClientRect().right > innerWidth,
            )
            .slice(0, 20)
            .map((element) => ({
              tag: element.tagName,
              class: element.className,
              right: element.getBoundingClientRect().right,
              width: element.getBoundingClientRect().width,
            })),
        })),
      ),
    );
    const bounds = await list.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y + bounds.height <= 844,
    );
    assert.ok(
      await list
        .getByRole("option")
        .first()
        .evaluate((element) => element.getBoundingClientRect().height >= 44),
    );
    if (process.env.BOOKS_TEST_SCREENSHOT_DIR && width !== 320)
      await page.screenshot({
        path: `${process.env.BOOKS_TEST_SCREENSHOT_DIR}/search-completion-${width}-${theme}.png`,
        fullPage: true,
      });
  }
  await list.getByRole("option").first().click();
  assert.equal(await input.inputValue(), "ดอกรักผลิบานที่กลางใจ");
  assert.equal(await list.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS search covers, grouping, cache-first completion, keyboard/pointer/IME controls, cancellation, optional failures and responsive themes",
  );
} finally {
  await browser.close();
}
