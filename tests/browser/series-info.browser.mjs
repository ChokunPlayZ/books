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
      if (fail)
        return route.fulfill({
          status: 503,
          json: { message: "AniList is unavailable. Please try again later." },
        });
      pulled = true;
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
    if (name === "getAnimeAdaptations")
      return route.fulfill({
        json: { items: [], exactId: null, complete: true },
      });
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    return route.continue();
  });
  await page.goto(url + seriesPath("Moon Library"));
  await page
    .getByRole("button", { name: "Pull series details", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document.querySelector(".series-info")?.getAttribute("aria-busy") ===
      "false",
  );
  assert.match(
    await page.locator(".series-info").textContent(),
    /No synopsis saved/,
  );
  await page
    .getByRole("button", { name: "Pull series details", exact: true })
    .click();
  await page.getByLabel("View series title in").selectOption("ja");
  await page.waitForFunction(
    () => document.getElementById("seriesTitle")?.textContent === "月の図書館",
  );
  await page
    .getByLabel("Synopsis · language & source")
    .selectOption({ label: "Japanese · Publisher · 2" });
  assert.match(
    await page.locator(".series-synopsis-text").textContent(),
    /月の光/,
  );
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
  await capture(".impeccable/review/desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await capture(".impeccable/review/mobile.png");
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
    .getByRole("button", { name: "Pull series details", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "AniList is unavailable" })
    .waitFor();
  assert.match(
    await page.locator(".series-synopsis-text").textContent(),
    /月の光/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Series info: title/synopsis language selection, edition navigation, persistence, failures and phone layout passed.",
  );
} finally {
  await browser.close();
}
