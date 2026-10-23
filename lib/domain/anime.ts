import type { Release } from "../types.ts";
import { bookSeriesTitle, seriesCategoryTitle } from "./title-normalization.ts";

export const ANIME_SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
export type AnimeSeason = (typeof ANIME_SEASONS)[number];

export type AnimeMedia = {
  id: number;
  malId: number | null;
  title: string;
  titles: string[];
  kind: "anime" | "Manga" | "LN";
  format: string;
  status: string;
  season: AnimeSeason | null;
  year: number | null;
  url: string;
  malUrl: string;
};
export type AnimeAdaptation = { book: AnimeMedia; anime: AnimeMedia[] };
export type SeasonalBook = {
  book: AnimeMedia;
  appearances: { anime: AnimeMedia; relation: "SOURCE" | "ADAPTATION" }[];
};
export type AnimeFeed<T> = {
  items: T[];
  checkedAt: string;
  stale: boolean;
  complete: boolean;
  warning?: string;
};
export type AdaptationFeed = AnimeFeed<AnimeAdaptation> & {
  exactId: number | null;
};
export type SeasonalFeed = AnimeFeed<SeasonalBook> & {
  season: AnimeSeason;
  year: number;
};
export type ThaiAnimeEdition = {
  item: Release;
  matchedTitle: string;
  matchedBy: "title" | "catalog URL";
  checkedAt: string;
  stale: boolean;
};
export type SeasonalThaiBook = SeasonalBook & {
  thaiEditions: ThaiAnimeEdition[];
};
export type SeasonalThaiFeed = Omit<SeasonalFeed, "items"> & {
  items: SeasonalThaiBook[];
  thaiSources: {
    publisher: string;
    url: string;
    checkedAt: string;
    stale: boolean;
    complete: boolean;
    error: string;
  }[];
};

export function currentAnimeSeason(date = new Date()) {
  return {
    season: ANIME_SEASONS[Math.floor(date.getUTCMonth() / 3)],
    year: date.getUTCFullYear(),
  };
}

export function animeSeasonLabel(season: AnimeSeason, year: number) {
  const names = {
    WINTER: "Winter",
    SPRING: "Spring",
    SUMMER: "Summer",
    FALL: "Fall",
  };
  return `${names[season]} ${year}`;
}

export function animeTitleKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

// Compare whole aliases, including bilingual publisher labels. Never use a
// substring match: sequels, spin-offs and similarly named books stay separate.
export function animeCatalogTitleKeys(value: string) {
  const title = seriesCategoryTitle(bookSeriesTitle(value))
    .replace(/\s*\((?:light\s*novel|novel|manga|comic|LN|Mg)\)\s*$/i, "")
    .trim();
  const parts = [title];
  const brackets = /[（(\[]([^）)\]]+)[）)\]]/g;
  const scripts = (text: string) =>
    [
      /[A-Za-z]/,
      /\p{Script=Thai}/u,
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
    ].flatMap((pattern, index) => (pattern.test(text) ? [index] : []));
  const outside = title.replace(brackets, " ");
  const outsideScripts = scripts(outside);
  const aliases = [...title.matchAll(brackets)].filter((match) => {
    const insideScripts = scripts(match[1]);
    return (
      insideScripts.length &&
      outsideScripts.length &&
      insideScripts.every((script) => !outsideScripts.includes(script))
    );
  });
  if (aliases.length) {
    parts.push(...aliases.map((match) => match[1]));
    parts.push(
      title.replace(brackets, (match, contents) =>
        aliases.some((alias) => alias[1] === contents) ? " " : match,
      ),
    );
  }
  // Thai directories often put the English/romaji name beside the Thai name.
  if (/\p{Script=Thai}/u.test(title))
    parts.push(
      ...[...title.matchAll(/[A-Za-z][A-Za-z0-9\s\p{P}]*[A-Za-z0-9]/gu)].map(
        (match) => match[0],
      ),
    );
  return new Set(parts.map(animeTitleKey).filter((key) => key.length >= 2));
}

export function matchAnimeCatalogTitle(
  book: AnimeMedia,
  entry: { series: string; title?: string; type: string; url: string },
): { matchedTitle: string; matchedBy: "title" | "catalog URL" } | null {
  if (
    entry.type &&
    entry.type !== (book.kind === "LN" ? "LN (TH)" : "Manga (TH)")
  )
    return null;
  const keys = new Set(
    book.titles.flatMap((title) => [...animeCatalogTitleKeys(title)]),
  );
  for (const title of [entry.series, entry.title || ""]) {
    if ([...animeCatalogTitleKeys(title)].some((key) => keys.has(key)))
      return { matchedTitle: title, matchedBy: "title" };
  }
  try {
    const slug = decodeURIComponent(
      new URL(entry.url).pathname.split("/").pop() || "",
    )
      .replace(/\.html$/, "")
      .replace(/-(?:manga|light-novel|novel|comic|ln)$/i, "");
    if (/[\p{L}]/u.test(slug) && keys.has(animeTitleKey(slug)))
      return { matchedTitle: slug, matchedBy: "catalog URL" };
  } catch {}
  return null;
}

export function animeStatus(status: string) {
  return (
    {
      RELEASING: "Airing now",
      FINISHED: "Finished",
      NOT_YET_RELEASED: "Upcoming",
      CANCELLED: "Cancelled",
      HIATUS: "On hiatus",
    }[status] || "Status unknown"
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Construct links from validated IDs. Never trust links or HTML from a source.
export function parseAnimeMedia(value: unknown): AnimeMedia | null {
  const media = record(value),
    title = record(media.title);
  if (!Number.isSafeInteger(media.id) || Number(media.id) <= 0) return null;
  const kind =
    media.type === "ANIME"
      ? "anime"
      : media.type === "MANGA" && media.format === "NOVEL"
        ? "LN"
        : media.type === "MANGA" &&
            ["MANGA", "ONE_SHOT"].includes(String(media.format))
          ? "Manga"
          : null;
  const titles = [
    ...new Set(
      [
        title.english,
        title.romaji,
        title.native,
        ...(Array.isArray(media.synonyms) ? media.synonyms : []),
      ]
        .filter(
          (name): name is string => typeof name === "string" && !!name.trim(),
        )
        .map((name) => name.trim().slice(0, 500)),
    ),
  ];
  if (!kind || !titles.length) return null;
  const id = Number(media.id),
    malId =
      Number.isSafeInteger(media.idMal) && Number(media.idMal) > 0
        ? Number(media.idMal)
        : null;
  const category = kind === "anime" ? "anime" : "manga";
  return {
    id,
    malId,
    title: titles[0],
    titles,
    kind,
    format: typeof media.format === "string" ? media.format : "",
    status: typeof media.status === "string" ? media.status : "",
    season: ANIME_SEASONS.includes(media.season as AnimeSeason)
      ? (media.season as AnimeSeason)
      : null,
    year: Number.isSafeInteger(media.seasonYear)
      ? Number(media.seasonYear)
      : null,
    url: `https://anilist.co/${category}/${id}`,
    malUrl: malId ? `https://myanimelist.net/${category}/${malId}` : "",
  };
}

function relations(value: unknown) {
  const edges = record(record(value).relations).edges;
  if (!Array.isArray(edges)) return [];
  return edges
    .map((edge) => {
      const data = record(edge);
      return { relation: data.relationType, media: parseAnimeMedia(data.node) };
    })
    .filter((edge) => edge.media !== null);
}

export function bookAdaptations(values: unknown[]): AnimeAdaptation[] {
  return values.flatMap((value) => {
    const book = parseAnimeMedia(value);
    if (!book || book.kind === "anime") return [];
    const anime = new Map<number, AnimeMedia>();
    for (const edge of relations(value)) {
      if (edge.relation === "ADAPTATION" && edge.media.kind === "anime")
        anime.set(edge.media.id, edge.media);
    }
    return [{ book, anime: [...anime.values()] }];
  });
}

export function seasonalBooks(values: unknown[]): SeasonalBook[] {
  const books = new Map<number, SeasonalBook>();
  for (const value of values) {
    const anime = parseAnimeMedia(value);
    if (!anime || anime.kind !== "anime") continue;
    for (const edge of relations(value)) {
      if (
        edge.media.kind === "anime" ||
        (edge.relation !== "SOURCE" && edge.relation !== "ADAPTATION")
      )
        continue;
      const item = books.get(edge.media.id) || {
        book: edge.media,
        appearances: [],
      };
      if (
        !item.appearances.some(
          (entry) =>
            entry.anime.id === anime.id && entry.relation === edge.relation,
        )
      )
        item.appearances.push({ anime, relation: edge.relation });
      books.set(item.book.id, item);
    }
  }
  return [...books.values()];
}
