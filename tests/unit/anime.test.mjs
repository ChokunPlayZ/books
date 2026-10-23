import test from "node:test";
import assert from "node:assert/strict";
import {
  currentAnimeSeason,
  animeTitleKey,
  parseAnimeMedia,
  bookAdaptations,
  seasonalBooks,
  matchAnimeCatalogTitle,
} from "../../lib/domain/anime.ts";
import {
  manga,
  novel,
  anime,
  adaptation,
  edge,
  seasonMedia,
} from "../helpers/anime.mjs";

test("anime seasons roll over on quarter and year boundaries", () => {
  for (const [date, season, year] of [
    ["2026-01-01", "WINTER", 2026],
    ["2026-03-31", "WINTER", 2026],
    ["2026-04-01", "SPRING", 2026],
    ["2026-07-01", "SUMMER", 2026],
    ["2026-10-01", "FALL", 2026],
    ["2027-01-01", "WINTER", 2027],
  ])
    assert.deepEqual(currentAnimeSeason(new Date(date)), { season, year });
});

test("Thai catalog matching uses whole multilingual aliases, format and catalog slugs without merging sequels", () => {
  const book = parseAnimeMedia(manga);
  const entry = {
    series: "ห้องสมุดใต้แสงจันทร์",
    type: "Manga (TH)",
    url: "https://www.phoenixnext.com/book-series/moonlit-library.html",
  };
  assert.equal(matchAnimeCatalogTitle(book, entry).matchedBy, "title");
  assert.equal(
    matchAnimeCatalogTitle(book, { ...entry, type: "LN (TH)" }),
    null,
  );
  assert.equal(
    matchAnimeCatalogTitle(book, { ...entry, type: "Manga (EN)" }),
    null,
  );
  for (const series of [
    "ห้องสมุด Moonlit Library",
    "ห้องสมุด (Moonlit Library)",
    "(มังงะ) Moonlit Library เล่ม 1",
    "Ｍoonlit: Library!",
  ])
    assert.equal(
      matchAnimeCatalogTitle(book, { ...entry, series }).matchedBy,
      "title",
    );
  assert.equal(
    matchAnimeCatalogTitle(book, { ...entry, series: "ชื่อไทยที่ต่างออกไป" })
      .matchedBy,
    "catalog URL",
  );
  for (const series of [
    "Moonlit Library 2",
    "Moonlit Library: Side Story",
    "Moonlit Library (Side Story)",
    "A Moonlit Library Adventure",
  ])
    assert.equal(
      matchAnimeCatalogTitle(book, {
        ...entry,
        series,
        url: "https://www.firstpagepro.com/category/123",
      }),
      null,
    );
  assert.ok(
    matchAnimeCatalogTitle(
      { ...book, titles: ["86"] },
      { ...entry, series: "86" },
    ),
  );
});

test("media preserves multilingual aliases and builds safe AniList/MAL URLs", () => {
  const book = parseAnimeMedia({
    ...novel,
    siteUrl: "javascript:alert(1)",
    idMal: -4,
  });
  assert.equal(book.kind, "LN");
  assert.equal(book.url, "https://anilist.co/manga/302");
  assert.equal(book.malUrl, "");
  assert.equal(
    parseAnimeMedia(manga).malUrl,
    "https://myanimelist.net/manga/401",
  );
  assert.ok(parseAnimeMedia(manga).titles.includes("ห้องสมุดใต้แสงจันทร์"));
  for (const value of [
    null,
    {},
    { ...manga, id: "301" },
    { ...manga, id: 0 },
    { ...manga, format: "TV" },
    { ...manga, title: null, synonyms: [] },
  ])
    assert.equal(parseAnimeMedia(value), null);
  assert.equal(
    animeTitleKey("Ｍoonlit: Library!"),
    animeTitleKey("Moonlit Library"),
  );
  assert.notEqual(
    animeTitleKey("Moonlit Library 2"),
    animeTitleKey("Moonlit Library"),
  );
});

test("adaptation detection requires explicit links and deduplicates anime", () => {
  const [book] = bookAdaptations([
    {
      ...manga,
      relations: {
        edges: [
          edge("ADAPTATION", anime),
          edge("ADAPTATION", anime),
          edge("CHARACTER", adaptation),
          edge("SOURCE", novel),
          edge("ADAPTATION", null),
        ],
      },
    },
  ]);
  assert.deepEqual(
    book.anime.map((item) => item.id),
    [anime.id],
  );
  assert.equal(bookAdaptations([anime, null]).length, 0);
  assert.equal(bookAdaptations([manga])[0].anime.length, 0);
});

test("seasonal books keep source and adaptation relationships separate, merge seasons and ignore unrelated media", () => {
  const sequel = { ...seasonMedia[0], id: 103 };
  const result = seasonalBooks([...seasonMedia, seasonMedia[0], sequel]);
  assert.equal(result.length, 3);
  const source = result.find((item) => item.book.id === manga.id);
  assert.deepEqual(
    source.appearances.map((item) => item.anime.id),
    [101, 103],
  );
  assert.equal(
    result.find((item) => item.book.kind === "LN").appearances[0].relation,
    "SOURCE",
  );
  assert.equal(
    result.find((item) => item.book.id === 303).appearances[0].relation,
    "ADAPTATION",
  );
});
