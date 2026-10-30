import { animag } from "./animag.ts";
import { dexpress } from "./dexpress.ts";
import { firstpage } from "./firstpage.ts";
import { googleBooks } from "./google-books.ts";
import { hanmoto } from "./hanmoto.ts";
import { kinokuniya } from "./kinokuniya.ts";
import { kodansha } from "./kodansha.ts";
import { luckpim } from "./luckpim.ts";
import { lilyhouse } from "./lilyhouse.ts";
import { naiin } from "./naiin.ts";
import { openLibrary } from "./open-library.ts";
import { phoenix } from "./phoenix.ts";
import { yaakz } from "./yaakz.ts";
import { yenpress } from "./yenpress.ts";
import type { Scraper, ScraperContext, ScraperDefinition } from "./types.ts";

// Register or remove a source here. Its capabilities and allowed hosts travel
// together; the catalog service does not need a new source-selection branch.
export const SCRAPER_SOURCES: readonly ScraperDefinition[] = Object.freeze([
  animag,
  dexpress,
  firstpage,
  googleBooks,
  hanmoto,
  kinokuniya,
  kodansha,
  luckpim,
  lilyhouse,
  naiin,
  openLibrary,
  phoenix,
  yaakz,
  yenpress,
]);

type RegisteredScraper = Scraper & Omit<ScraperDefinition, "create">;

export function supportsIsbn(
  source: Pick<ScraperDefinition, "isbnPrefixes">,
  canonical: string,
) {
  return (
    !source.isbnPrefixes ||
    source.isbnPrefixes.some((prefix) => canonical.startsWith(prefix))
  );
}

export function createScraperRegistry(
  context: ScraperContext,
  definitions: readonly ScraperDefinition[] = SCRAPER_SOURCES,
) {
  const sources = new Map<string, RegisteredScraper>();
  for (const definition of definitions) {
    if (sources.has(definition.id))
      throw new Error("Duplicate scraper source: " + definition.id);
    const { create, ...metadata } = definition;
    sources.set(definition.id, { ...metadata, ...create(context) });
  }
  return {
    get: (id: string) => sources.get(id),
    require(id: string) {
      const source = sources.get(id);
      if (!source) throw new Error("Choose a supported publisher.");
      return source;
    },
    isbnSearchProviders: [...sources.values()].filter(
      (source) => source.searchIsbn,
    ),
    priceProviders: [...sources.values()].filter(
      (source) => source.priceSource && source.lookupIsbn,
    ),
    coverProviders: [...sources.values()]
      .filter((source) => source.coverOptions)
      .sort(
        (a, b) => (a.coverPriority ?? Infinity) - (b.coverPriority ?? Infinity),
      ),
    isbnProviders: [...sources.values()]
      .filter((source) => source.lookupIsbn)
      .sort(
        (a, b) => (a.isbnPriority ?? Infinity) - (b.isbnPriority ?? Infinity),
      ),
  };
}
