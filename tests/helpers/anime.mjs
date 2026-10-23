import { bookAdaptations, seasonalBooks } from "../../lib/domain/anime.ts";
import { releaseItem } from "../../lib/domain/releases.ts";

export const manga = {
  id: 301,
  idMal: 401,
  type: "MANGA",
  format: "MANGA",
  status: "RELEASING",
  title: {
    english: "Moonlit Library",
    romaji: "Tsuki no Toshokan",
    native: "月の図書館",
  },
  synonyms: ["ห้องสมุดใต้แสงจันทร์"],
};
export const novel = {
  id: 302,
  idMal: 402,
  type: "MANGA",
  format: "NOVEL",
  status: "RELEASING",
  title: { english: "The Last Archivist", romaji: "Saigo no Shishokan" },
  synonyms: [],
};
export const comic = {
  ...manga,
  id: 303,
  idMal: null,
  title: { english: "The Last Archivist: Manga" },
  synonyms: [],
};
export const anime = {
  id: 101,
  idMal: 201,
  type: "ANIME",
  format: "TV",
  status: "RELEASING",
  season: "FALL",
  seasonYear: 2026,
  title: { english: "Moonlit Library", romaji: "Tsuki no Toshokan" },
  synonyms: [],
};
export const adaptation = {
  ...anime,
  id: 102,
  idMal: 202,
  status: "NOT_YET_RELEASED",
  title: { english: "The Last Archivist" },
};
export const edge = (relationType, node) => ({ relationType, node });
export const searchMedia = [
  {
    ...manga,
    relations: {
      edges: [edge("ADAPTATION", anime), edge("CHARACTER", adaptation)],
    },
  },
];
export const seasonMedia = [
  { ...anime, relations: { edges: [edge("SOURCE", manga)] } },
  {
    ...adaptation,
    relations: {
      edges: [
        edge("SOURCE", novel),
        edge("ADAPTATION", comic),
        edge("CHARACTER", manga),
      ],
    },
  },
];
export const checkedAt = "2026-10-23T05:00:00.000Z";
export const adaptationFeed = {
  items: bookAdaptations(searchMedia),
  exactId: manga.id,
  checkedAt,
  stale: false,
  complete: true,
};
export const seasonalFeed = {
  items: seasonalBooks(seasonMedia),
  season: "FALL",
  year: 2026,
  checkedAt,
  stale: false,
  complete: true,
};

export const thaiManga = releaseItem(
  "phoenix",
  "(มังงะ) ห้องสมุดใต้แสงจันทร์ เล่ม 2",
  "https://www.phoenixnext.com/moonlit-02.html",
  175,
  "9780140328721",
  "Manga (TH)",
);
thaiManga.availability = "In stock";
export const seasonalThaiFeed = {
  ...seasonalFeed,
  items: seasonalFeed.items.map((item, index) => ({
    ...item,
    thaiEditions:
      index === 0
        ? [
            {
              item: thaiManga,
              matchedTitle: "ห้องสมุดใต้แสงจันทร์",
              matchedBy: "title",
              checkedAt,
              stale: false,
            },
          ]
        : [],
  })),
  thaiSources: [
    {
      publisher: "Phoenix Next",
      url: "https://www.phoenixnext.com/book-series.html",
      checkedAt,
      stale: false,
      complete: true,
      error: "",
    },
    {
      publisher: "First Page Pro",
      url: "https://www.firstpagepro.com/",
      checkedAt: "",
      stale: false,
      complete: false,
      error: "The publisher directory could not be checked.",
    },
  ],
};
