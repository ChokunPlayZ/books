import { digest } from "../domain/hash.ts";
import {
  searchKey,
  searchLanguage,
  type SearchResult,
  type SearchSource,
} from "../domain/search.ts";
import {
  canSuggest,
  mergeSuggestions,
  resultSuggestions,
  SUFFICIENT_SUGGESTIONS,
  type QuerySuggestions,
} from "../domain/search-suggestions.ts";
import { AppError, type Store } from "./store.ts";
import { SCRAPE_TTL } from "./scrape-cache.ts";
import type {
  Scraper,
  ScraperContext,
  ScraperDefinition,
} from "./scrapers/types.ts";

type Source = Scraper & Omit<ScraperDefinition, "create">;
const preferred = [
  "phoenix",
  "luckpim",
  "naiin",
  "firstpage",
  "animag",
  "dexpress",
];

export function createSearchSuggestions({
  store,
  context,
  queryFrom,
  knownResults,
  sources,
  describe,
}: {
  store: Store;
  context: ScraperContext;
  queryFrom: (request: unknown) => string;
  knownResults: (query: string) => Promise<SearchResult[]>;
  sources: Source[];
  describe: (source: Source) => SearchSource;
}) {
  const keyFor = (source: Source, query: string) =>
    "search-suggestions:v1:" + source.id + ":" + digest(searchKey(query));
  const applicable = (query: string) =>
    canSuggest(query)
      ? sources
          .filter(
            (source) =>
              source.suggestTitles &&
              source.titleLanguages?.includes(searchLanguage(query)),
          )
          .sort((a, b) => preferred.indexOf(a.id) - preferred.indexOf(b.id))
      : [];
  async function snapshot(source: Source, query: string) {
    try {
      const value = JSON.parse(
        (await store.cache.get(keyFor(source, query))) || "null",
      );
      if (
        value?.version === 1 &&
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            item && typeof item.title === "string" && item.title.length <= 200,
        )
      )
        return value as { items: { title: string }[]; checkedAt: number };
    } catch {
      /* Disposable cache corruption must not prevent completion. */
    }
    return null;
  }
  const fresh = (value: Awaited<ReturnType<typeof snapshot>>) =>
    !!value && Date.now() - value.checkedAt < SCRAPE_TTL.catalog * 1000;
  const response = (
    source: Source,
    query: string,
    value: NonNullable<Awaited<ReturnType<typeof snapshot>>>,
  ) => ({
    query,
    suggestions: mergeSuggestions(
      query,
      value.items.map((item) => ({
        value: item.title,
        label: describe(source).name,
        known: true,
      })),
    ),
    sources: [],
  });
  function sourceFrom(request: unknown, query: string) {
    const id = (request as { sourceId?: unknown })?.sourceId;
    const source = applicable(query).find((source) => source.id === id);
    if (!source) throw new AppError("Choose an applicable search source.");
    return source;
  }
  async function cachedSearchSuggestions(
    request: unknown,
  ): Promise<QuerySuggestions | null> {
    const query = queryFrom(request);
    const source = sourceFrom(request, query);
    const previous = await snapshot(source, query);
    return fresh(previous) ? response(source, query, previous!) : null;
  }
  async function searchKnownSuggestions(
    request: unknown,
  ): Promise<QuerySuggestions> {
    const query = queryFrom(request);
    if (!canSuggest(query)) return { query, suggestions: [], sources: [] };
    const suggestions = resultSuggestions(query, await knownResults(query));
    const remote: SearchSource[] = [];
    if (suggestions.length < SUFFICIENT_SUGGESTIONS) {
      for (const source of applicable(query)) {
        // Successful empty responses count too. Never repeat an exact miss on
        // every keypress, or treat a truncated prefix response as exhaustive.
        if (!fresh(await snapshot(source, query)))
          remote.push(describe(source));
      }
    }
    return { query, suggestions, sources: remote };
  }
  async function searchExternalSuggestions(
    request: unknown,
  ): Promise<QuerySuggestions> {
    const query = queryFrom(request);
    const source = sourceFrom(request, query);
    const previous = await snapshot(source, query);
    if (fresh(previous)) return response(source, query, previous!);
    try {
      const loaded = await context.scrapeCache.get(
        "query-suggestions:v1:" + source.id + ":" + digest(searchKey(query)),
        { maxAge: SCRAPE_TTL.catalog },
        async () => {
          const titles = await source.suggestTitles!(query);
          if (
            !Array.isArray(titles) ||
            titles.some((title) => typeof title !== "string")
          )
            throw new Error("Query completion data changed.");
          return {
            items: [
              ...new Set(
                titles
                  .map((title) => title.trim())
                  .filter((title) => title && title.length <= 200),
              ),
            ].slice(0, 100),
            checkedAt: Date.now(),
          };
        },
      );
      // Only public provider titles enter shared storage, never a private shelf,
      // local alias, query history, authentication token or publisher cookie.
      const saved = {
        version: 1,
        sourceId: source.id,
        items: loaded.items.map((title) => ({ title })),
        checkedAt: loaded.checkedAt,
      };
      await store.cache.put(
        keyFor(source, query),
        JSON.stringify(saved),
        SCRAPE_TTL.retention,
      );
      return response(source, query, saved);
    } catch {
      // Optional completion failures must not block free-text/full searches.
      return {
        ...(previous
          ? response(source, query, previous)
          : { query, suggestions: [], sources: [] }),
        unavailable: true,
      };
    }
  }
  return {
    searchKnownSuggestions,
    searchExternalSuggestions,
    cachedSearchSuggestions,
  };
}
