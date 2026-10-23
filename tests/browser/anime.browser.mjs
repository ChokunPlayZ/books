import { testUrl as url } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { seriesPath } from "../../lib/domain/navigation.ts";
import { currentAnimeSeason } from "../../lib/domain/anime.ts";
import { adaptationFeed, seasonalFeed, novel } from "../helpers/anime.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
    seasonCalls = [],
    adaptationCalls = [];
  let failSeason = false,
    failAdaptation = false,
    stale = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/rpc", async (route) => {
    const request = route.request().postDataJSON();
    if (request.name === "getSeasonalAnimeBooks") {
      seasonCalls.push(request.arg);
      if (failSeason)
        return route.fulfill({
          status: 503,
          json: { message: "AniList is temporarily unavailable." },
        });
      return route.fulfill({
        json: {
          ...seasonalFeed,
          season: request.arg.season,
          year: request.arg.year,
          stale,
          ...(stale ? { warning: "Showing the previous check." } : {}),
        },
      });
    }
    if (request.name === "getAnimeAdaptations") {
      adaptationCalls.push(request.arg);
      if (failAdaptation)
        return route.fulfill({
          status: 503,
          json: { message: "AniList is temporarily unavailable." },
        });
      if (request.arg.search === "Missing title")
        return route.fulfill({
          json: { ...adaptationFeed, exactId: null, items: [] },
        });
      if (request.arg.type === "LN")
        return route.fulfill({
          json: {
            ...adaptationFeed,
            exactId: novel.id,
            items: [{ book: seasonalFeed.items[1].book, anime: [] }],
          },
        });
      return route.fulfill({
        json: {
          ...adaptationFeed,
          exactId:
            request.arg.search === "Moon" ? null : adaptationFeed.exactId,
        },
      });
    }
    if (request.name === "getPublisherDirectory")
      return route.fulfill({
        json: {
          titles: [],
          items: [],
          complete: true,
          checkedAt: adaptationFeed.checkedAt,
          url: request.arg.url,
        },
      });
    if (request.name === "getSeriesCatalog")
      return route.fulfill({
        json: {
          items: [],
          complete: true,
          checkedAt: adaptationFeed.checkedAt,
        },
      });
    if (request.name === "getBookCover")
      return route.fulfill({ json: { row: request.arg.row, coverId: "" } });
    return route.continue();
  });
  await page.request.post(url + "/api/rpc", {
    data: {
      name: "saveBook",
      arg: {
        requestId: crypto.randomUUID(),
        book: {
          series: "ห้องสมุดใต้แสงจันทร์",
          type: "Manga (TH)",
          publisher: "Test press",
          volume: 1,
          isbn: "",
          status: "Read",
          source: "Test shop",
          price: "",
          date: "2026-10-23",
          note: "",
        },
      },
    },
  });
  await page.goto(url + "/discover");
  await page.waitForFunction(() => !!window.bookCollection?.state.data);
  assert.equal(await page.locator("#publisherDiscovery").isVisible(), true);
  assert.equal(
    seasonCalls.length,
    0,
    "season loads only after choosing the menu",
  );
  await page.locator("#discoveryMode").selectOption("anime");
  await page.locator("#animeSeasonList .anime-card").first().waitFor();
  assert.equal(await page.locator("#publisherDiscovery").isVisible(), false);
  assert.equal(await page.locator("#refreshDiscovery").isVisible(), false);
  assert.equal(await page.locator("#animeSeasonList .anime-card").count(), 3);
  const current = currentAnimeSeason();
  assert.equal(seasonCalls[0].season, current.season);
  assert.equal(seasonCalls[0].year, current.year);
  assert.equal(
    await page
      .getByRole("link", { name: "On your shelf · View series" })
      .getAttribute("href"),
    seriesPath("ห้องสมุดใต้แสงจันทร์"),
  );
  assert.equal(
    await page
      .locator("#animeSeasonList")
      .getByText("Source material", { exact: true })
      .count(),
    2,
  );
  assert.equal(
    await page
      .locator("#animeSeasonList")
      .getByText("Manga adaptation", { exact: true })
      .count(),
    1,
  );
  await page.locator("#animeAiring").selectOption("RELEASING");
  assert.equal(await page.locator("#animeSeasonList .anime-card").count(), 1);
  await page.locator("#animeAiring").selectOption("");
  await page.locator("#animeBookType").selectOption("LN");
  assert.equal(await page.locator("#animeSeasonList .anime-card").count(), 1);
  await page.getByRole("button", { name: "Pick this book" }).click();
  await page.locator("#bookDialog").waitFor();
  assert.equal(
    await page.locator("#series").inputValue(),
    "The Last Archivist",
  );
  assert.equal(await page.locator("#type").inputValue(), "LN (TH)");
  assert.equal(await page.locator("#isbn").inputValue(), "");
  await page.locator("#volume").fill("1");
  await page.locator("#publisher").fill("Test press");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !document.getElementById("saveButton").disabled,
  );
  await page
    .getByRole("link", { name: "On your shelf · View series" })
    .waitFor();
  await page.locator("#animeBookType").selectOption("");
  await page.locator("#animeSeasonSearch").fill("Tsuki");
  assert.equal(await page.locator("#animeSeasonList .anime-card").count(), 1);
  await page.locator("#animeSeasonSearch").fill("No match");
  assert.match(
    await page.locator("#animeSeasonList").textContent(),
    /No linked books match/,
  );
  await page.locator("#animeSeasonSearch").fill("");
  failSeason = true;
  await page.locator("#refreshAnimeSeason").click();
  await page.locator("#animeSeasonError").waitFor();
  failSeason = false;
  stale = true;
  await page.locator("#refreshAnimeSeason").click();
  await page.waitForFunction(
    () => !document.getElementById("refreshAnimeSeason").disabled,
  );
  assert.match(
    await page.locator("#animeSeasonStatus").textContent(),
    /Previous check/,
  );
  assert.equal(await page.locator("#animeSeasonError").isVisible(), false);
  await page.locator("#discoveryMode").selectOption("publisher");
  assert.equal(await page.locator("#publisherDiscovery").isVisible(), true);
  await page.locator("#discoveryMode").selectOption("anime");
  await page.reload();
  await page.locator("#animeSeasonList .anime-card").first().waitFor();
  assert.equal(await page.locator("#discoveryMode").inputValue(), "anime");
  mkdirSync("outputs", { recursive: true });
  await page.screenshot({
    path: "outputs/anime-season-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.goto(url + seriesPath("ห้องสมุดใต้แสงจันทร์"));
  await page.locator("#adaptationPanel > summary").click();
  await page.locator("#adaptationList .anime-card").waitFor();
  assert.equal(adaptationCalls.at(-1).type, "Manga");
  assert.match(
    await page.locator("#adaptationSummary").textContent(),
    /1 linked anime/,
  );
  assert.match(
    await page.locator("#adaptationList").textContent(),
    /Airing now/,
  );
  assert.equal(
    await page
      .locator("#adaptationList a[href='https://myanimelist.net/anime/201']")
      .count(),
    1,
  );
  await page.locator("#adaptationSearch").fill("Moon");
  await page.locator("#findAdaptations").click();
  await page.waitForFunction(
    () => !document.getElementById("findAdaptations").disabled,
  );
  assert.match(
    await page.locator("#adaptationSummary").textContent(),
    /possible matches/,
  );
  await page.locator("#adaptationType").selectOption("LN");
  await page.locator("#findAdaptations").click();
  await page.waitForFunction(
    () => !document.getElementById("findAdaptations").disabled,
  );
  assert.match(
    await page.locator("#adaptationList").textContent(),
    /no directly linked anime/,
  );
  failAdaptation = true;
  await page.locator("#findAdaptations").click();
  await page.locator("#adaptationError").waitFor();
  failAdaptation = false;
  await page.locator("#adaptationSearch").fill("Missing title");
  await page.locator("#findAdaptations").click();
  await page.waitForFunction(
    () => !document.getElementById("findAdaptations").disabled,
  );
  assert.match(
    await page.locator("#adaptationStatus").textContent(),
    /No matching book/,
  );
  assert.equal(await page.locator("#adaptationError").isVisible(), false);
  await page.locator("#adaptationType").selectOption("Manga");
  await page.locator("#adaptationSearch").fill("Moonlit Library");
  await page.locator("#findAdaptations").click();
  await page.waitForFunction(
    () => !document.getElementById("findAdaptations").disabled,
  );
  await page.screenshot({
    path: "outputs/anime-adaptations-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: "outputs/anime-adaptations-desktop.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS seasonal manga/LN selection, shelf matches, picking and saving books, adaptation details, ambiguity, outages and mobile layout",
  );
} finally {
  await browser.close();
}
