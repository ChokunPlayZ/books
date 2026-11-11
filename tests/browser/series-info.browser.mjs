import { testUrl as url } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { seriesPath } from "../../lib/domain/navigation.ts";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Published fixture titles and descriptions are synthetic test data.
  for (const [series, edition] of [
    ["Moon Library", "(EN)"],
    ["月の図書館", "(JP)"],
  ]) {
    const response = await page.request.post(url + "/api/rpc", {
      data: {
        name: "saveBook",
        arg: {
          requestId: crypto.randomUUID(),
          book: {
            series,
            edition,
            type: "Manga",
            publisher: "",
            status: "Read",
            volume: 1,
            isbn: "",
            price: "",
            date: "",
            source: "",
            note: "",
          },
        },
      },
    });
    assert.equal(response.ok(), true);
  }
  const source = "https://anilist.co/manga/42";
  const info = {
    series: "Moon Library",
    type: "Manga",
    workId: "anilist:42",
    titles: [
      { title: "Moon Library", language: "en", source: "AniList", url: source },
      { title: "月の図書館", language: "ja", source: "AniList", url: source },
      {
        title: "Tsuki no Toshokan",
        language: "ja-Latn",
        source: "AniList",
        url: source,
      },
    ],
    synopses: [
      {
        text: "The publisher’s full English story.\nA second paragraph from the publisher.",
        language: "en",
        source: "Yen Press",
        url: "https://yenpress.com/series/moon-library",
      },
      {
        text: "A bookstore description that must not replace the publisher.",
        language: "en",
        source: "Naiin",
        url: "https://www.naiin.com/product/detail/42",
      },
      {
        text: "A quiet library opens only beneath the moon. Its new keeper discovers that every borrowed book holds a memory of the town.",
        language: "en",
        source: "AniList",
        url: source,
      },
      {
        text: "月の光の下だけで開く図書館。新しい司書は、本に町の記憶が宿っていることを知る。",
        language: "ja",
        source: "Publisher",
        url: "https://www.kodansha.co.jp/book/products/0000000001",
      },
      {
        text: "ห้องสมุดที่เปิดเฉพาะใต้แสงจันทร์ บรรณารักษ์คนใหม่ได้พบความทรงจำของเมืองในหนังสือแต่ละเล่ม",
        language: "th",
        source: "Publisher",
        url: "https://www.phoenixnext.com/book.html",
      },
    ],
    editions: [
      { series: "Moon Library", type: "Manga", language: "en", count: 1 },
      { series: "月の図書館", type: "Manga", language: "ja", count: 1 },
    ],
    candidates: [],
    warnings: [],
  };
  let pulled = false;
  let automaticPulls = 0;
  let discoveryChecks = 0;
  let keepDiscoveryPending = false;
  let fail = false;
  await page.route("**/api/rpc", async (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getSeriesInfo")
      return route.fulfill({
        json: {
          ...info,
          series: arg.series,
          ...(pulled
            ? {}
            : {
                workId: "",
                titles: [],
                synopses: [],
                editions: info.editions.slice(0, 1),
              }),
        },
      });
    if (name === "pullSeriesInfo") {
      if (arg.automatic) automaticPulls++;
      if (fail)
        return route.fulfill({
          status: 503,
          json: { message: "AniList is unavailable. Please try again later." },
        });
      pulled = true;
      if (arg.automatic)
        return route.fulfill({
          json: {
            ...info,
            titles: [],
            synopses: [],
            discoveryJobId: "fixture-discovery",
          },
        });
      if (arg.search === "Moon" && !arg.mediaId)
        return route.fulfill({
          json: {
            ...info,
            candidates: [
              {
                id: 42,
                title: "Moon Library",
                titles: ["Moon Library", "月の図書館"],
                url: source,
              },
              {
                id: 43,
                title: "Moon Library: After Story",
                titles: ["Moon Library: After Story"],
                url: "https://anilist.co/manga/43",
              },
            ],
          },
        });
      return route.fulfill({ json: info });
    }
    if (name === "getSeriesDiscovery") {
      discoveryChecks++;
      return route.fulfill({
        json: {
          ...info,
          ...(keepDiscoveryPending
            ? { discoveryJobId: "fixture-discovery" }
            : {}),
        },
      });
    }
    if (name === "getAnimeAdaptations")
      return route.fulfill({
        json: { items: [], exactId: null, complete: true },
      });
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    return route.continue();
  });
  await page.goto(url + seriesPath("Moon Library"));
  await page.waitForFunction(
    () =>
      document.querySelector(".series-info")?.getAttribute("aria-busy") ===
      "false",
  );
  assert.equal(pulled, true, "Series details load without a button click");
  assert.equal(automaticPulls, 1);
  assert.equal(
    discoveryChecks,
    1,
    "Background results appear without keeping a lookup request open",
  );
  assert.equal(
    await page.locator(".series-synopsis-text").innerText(),
    info.synopses[0].text,
    "The publisher wins automatically over bookstores and AniList",
  );
  assert.equal(await page.locator(".series-synopsis a").count(), 0);
  assert.doesNotMatch(
    await page.getByLabel("Synopsis language").textContent(),
    /Publisher|AniList|Yen Press|Naiin/,
  );
  assert.equal(
    await page.getByLabel("Synopsis language").locator("option").count(),
    3,
  );
  await page.getByLabel("View series title in").selectOption("ja");
  await page.waitForFunction(
    () => document.getElementById("seriesTitle")?.textContent === "月の図書館",
  );
  await page.getByLabel("Synopsis language").selectOption("ja");
  assert.match(
    await page.locator(".series-synopsis-text").textContent(),
    /月の光/,
  );
  await page.getByLabel("Synopsis language").selectOption("th");
  assert.equal(
    await page.locator(".series-synopsis-text").innerText(),
    info.synopses.find((item) => item.language === "th").text,
    "Publisher text must be readable in the app, not only through its link",
  );
  await page.getByLabel("Synopsis language").selectOption("ja");
  await page.waitForFunction(
    () => document.querySelectorAll("#bookList .book-row").length === 1,
  );
  await page.getByText("Titles from sources", { exact: true }).click();
  await page.getByText("Find or change a series link", { exact: true }).click();
  await page
    .getByLabel("Title on AniList", { exact: true })
    .first()
    .fill("Moon");
  await page.getByRole("button", { name: "Find series", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".series-info-matching")?.open &&
      document.querySelector(".series-info-matching .series-info-candidates"),
  );
  for (const link of await page
    .locator('.series-info a[href^="https://"]')
    .all()) {
    assert.equal(
      new URL(await link.getAttribute("href")).searchParams.get("ref"),
      "meemai.ckl.moe",
    );
    assert.equal(await link.getAttribute("rel"), "noopener");
    assert.equal(
      await link.getAttribute("referrerpolicy"),
      "strict-origin-when-cross-origin",
    );
  }
  mkdirSync(".impeccable/review", { recursive: true });
  const capture = async (path) => {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForFunction(() => scrollY === 0);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({ path, fullPage: true });
  };
  await capture(".impeccable/review/synopsis-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await capture(".impeccable/review/synopsis-mobile.png");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await capture(".impeccable/review/synopsis-mobile-dark.png");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page
    .locator(".series-info-candidates")
    .getByRole("button", { name: "Use this series" })
    .first()
    .click();
  await page.locator(".series-info-candidates").waitFor({ state: "hidden" });
  await page
    .getByRole("navigation", { name: "Linked language editions" })
    .getByRole("link", { name: "月の図書館" })
    .click();
  await page.waitForFunction(
    () => document.getElementById("seriesTitle")?.textContent === "月の図書館",
  );
  assert.match(
    await page.locator(".series-synopsis-text").textContent(),
    /月の光/,
  );
  await page.waitForFunction(
    () => document.querySelectorAll("#bookList .book-row").length === 1,
  );
  await page.reload();
  await page.waitForFunction(() =>
    document
      .querySelector(".series-synopsis-text")
      ?.textContent.includes("月の光"),
  );
  fail = true;
  await page
    .getByRole("button", { name: "Refresh details", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "AniList is unavailable" })
    .waitFor();
  assert.match(
    await page.locator(".series-synopsis-text").textContent(),
    /月の光/,
  );
  await page.reload();
  await page
    .getByRole("alert")
    .filter({ hasText: "AniList is unavailable" })
    .waitFor();
  assert.match(
    await page.locator(".series-synopsis-text").textContent(),
    /月の光/,
    "An automatic refresh failure must not remove the saved synopsis",
  );
  fail = false;
  keepDiscoveryPending = true;
  const pendingResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/rpc") &&
      response.request().postDataJSON()?.name === "getSeriesDiscovery",
  );
  await page.reload();
  await pendingResponse;
  await page.goto(url + "/data");
  const checksAfterNavigation = discoveryChecks;
  await page.waitForTimeout(1800);
  assert.equal(
    discoveryChecks,
    checksAfterNavigation,
    "Leaving a series stops background-status requests",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Series info: automatic enrichment, publisher-first synopsis, hidden citations, languages, persistence, failures and phone layout passed.",
  );
} finally {
  await browser.close();
}
