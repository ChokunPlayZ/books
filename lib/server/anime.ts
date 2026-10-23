import { AppError, type Store } from "./store.ts";
import { createScrapeCache, SCRAPE_TTL } from "./scrape-cache.ts";
import { digest } from "../domain/hash.ts";
import {
  ANIME_SEASONS,
  currentAnimeSeason,
  animeTitleKey,
  bookAdaptations,
  seasonalBooks,
  type AnimeSeason,
  type AnimeFeed,
} from "../domain/anime.ts";

const fields = `id idMal type format status season seasonYear
  title { english romaji native } synonyms`;
const relations = `relations { edges { relationType node { ${fields} } } }`;
const searchQuery = `query ($search: String!, $formats: [MediaFormat]) {
  Page(page: 1, perPage: 8) {
    media(search: $search, type: MANGA, format_in: $formats, sort: SEARCH_MATCH) { ${fields} ${relations} }
  }
}`;
const seasonQuery = `query ($season: MediaSeason!, $year: Int!, $page: Int!) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC) { ${fields} ${relations} }
  }
}`;

function requestObject(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new AppError("Invalid anime request.");
  return value as Record<string, unknown>;
}

export function createAnimeService(
  store: Pick<Store, "cache">,
  fetchImpl = globalThis.fetch,
) {
  const cache = createScrapeCache(store.cache);

  async function query(document: string, variables: Record<string, unknown>) {
    if (Number(store.cache.get("anilist:cooldown")) > Date.now())
      throw new Error("AniList is busy. Please try again in a few minutes.");
    const response = await fetchImpl("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: document, variables }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (response.status === 429) {
      const seconds = Math.max(
        60,
        Math.min(900, Number(response.headers.get("retry-after")) || 60),
      );
      store.cache.put(
        "anilist:cooldown",
        String(Date.now() + seconds * 1000),
        seconds,
      );
      throw new Error(
        "AniList’s request limit was reached. Please try again in a few minutes.",
      );
    }
    if (!response.ok)
      throw new Error("AniList is unavailable. Please try again later.");
    const body = await response.json();
    if (
      !body ||
      body.errors?.length ||
      !Array.isArray(body.data?.Page?.media) ||
      body.data.Page.media.some((item) => !item || typeof item !== "object")
    )
      throw new Error(
        "AniList could not return complete results. Please try again later.",
      );
    return body.data.Page as {
      media: unknown[];
      pageInfo?: { hasNextPage?: boolean };
    };
  }

  async function cached<T extends AnimeFeed<unknown>>(
    key: string,
    refresh: boolean,
    maxAge: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const savedKey = "anilist:last:v1:" + digest(key);
    try {
      const result = await cache.get(
        "anilist:v1:" + key,
        { maxAge, refresh },
        load,
      );
      store.cache.put(savedKey, JSON.stringify(result), SCRAPE_TTL.retention);
      return result;
    } catch (error) {
      const saved = store.cache.get(savedKey);
      if (saved) {
        try {
          const previous = JSON.parse(saved) as T;
          if (Array.isArray(previous.items))
            return {
              ...previous,
              stale: true,
              warning: "AniList could not refresh. Showing the previous check.",
            };
        } catch {}
      }
      throw error;
    }
  }

  return {
    async getAnimeAdaptations(arg?: unknown) {
      const request = requestObject(arg);
      if (
        typeof request.search !== "string" ||
        request.search.trim().length < 2 ||
        request.search.length > 200
      )
        throw new AppError("Enter a title between 2 and 200 characters.");
      if (
        request.type != null &&
        !["", "Manga", "LN"].includes(String(request.type))
      )
        throw new AppError("Choose Manga or light novels.");
      const search = request.search.trim(),
        type = String(request.type || "");
      return cached(
        "search:" + JSON.stringify([search.toLocaleLowerCase(), type]),
        request.refresh === true,
        7 * 86400,
        async () => {
          const formats =
            type === "LN"
              ? ["NOVEL"]
              : type === "Manga"
                ? ["MANGA", "ONE_SHOT"]
                : ["MANGA", "ONE_SHOT", "NOVEL"];
          const result = await query(searchQuery, { search, formats });
          const items = bookAdaptations(result.media);
          const searchKey = animeTitleKey(search);
          const exact = items.filter(
            (item) =>
              searchKey &&
              item.book.titles.some(
                (title) => animeTitleKey(title) === searchKey,
              ),
          );
          return {
            items,
            exactId: exact.length === 1 ? exact[0].book.id : null,
            checkedAt: new Date().toISOString(),
            stale: false,
            complete: true,
          };
        },
      );
    },
    async getSeasonalAnimeBooks(arg?: unknown) {
      const request = requestObject(arg),
        current = currentAnimeSeason();
      const season = request.season ?? current.season,
        year = request.year ?? current.year;
      if (
        !ANIME_SEASONS.includes(season as AnimeSeason) ||
        !Number.isSafeInteger(year) ||
        Number(year) < 1940 ||
        Number(year) > current.year + 1
      )
        throw new AppError("Choose a valid anime season and year.");
      return cached(
        "season:" + season + ":" + year,
        request.refresh === true,
        6 * 3600,
        async () => {
          const media: unknown[] = [];
          let complete = false;
          for (let page = 1; page <= 10; page++) {
            const result = await query(seasonQuery, { season, year, page });
            if (typeof result.pageInfo?.hasNextPage !== "boolean")
              throw new Error(
                "AniList season information is incomplete. Please try again later.",
              );
            media.push(...result.media);
            if (!result.pageInfo.hasNextPage) {
              complete = true;
              break;
            }
            if (!result.media.length)
              throw new Error(
                "AniList season information is incomplete. Please try again later.",
              );
          }
          return {
            items: seasonalBooks(media),
            season: season as AnimeSeason,
            year: Number(year),
            checkedAt: new Date().toISOString(),
            stale: false,
            complete,
            ...(!complete
              ? { warning: "Showing the first 500 anime in this season." }
              : {}),
          };
        },
      );
    },
  };
}
