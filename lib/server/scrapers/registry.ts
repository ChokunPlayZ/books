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
import { canonicalIsbn } from "../../domain/isbn.ts";
import { normalizeRecordTypes } from "../../domain/book-type.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";

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
    const scraper = create(context);
    const verified = (book, isbn: string) => {
      if (!book?.url || canonicalIsbn(book.isbn) !== isbn) return false;
      try {
        const url = new URL(book.url);
        return (
          url.protocol === "https:" &&
          metadata.hosts.includes(url.hostname) &&
          !url.username &&
          !url.password &&
          !url.port
        );
      } catch {
        return false;
      }
    };
    function remember(book, isbn: string) {
      if (!verified(book, isbn)) return;
      const url = new URL(book.url).href;
      context.cache.put("known-product:v1:" + url, isbn, Infinity);
      context.scrapeCache.pin("text:" + url);
    }
    if (scraper.lookupIsbn) {
      const load = scraper.lookupIsbn;
      scraper.lookupIsbn = (isbn, refresh = false) =>
        context.scrapeCache.get(
          `source-book:v1:${metadata.id}:${isbn}`,
          {
            maxAge: SCRAPE_TTL.isbn,
            refresh,
            permanent: (book) => verified(book, isbn),
          },
          async () => {
            if (!refresh) {
              try {
                const legacy = JSON.parse(
                  context.cache.get("isbn:v15:" + isbn) || "null",
                );
                const book =
                  legacy?.found && canonicalIsbn(legacy.isbn) === isbn
                    ? { ...legacy.details, isbn }
                    : null;
                if (verified(book, isbn)) {
                  remember(book, isbn);
                  return normalizeRecordTypes({
                    ...book,
                    checkedAt: legacy.checkedAt ?? "",
                  });
                }
              } catch {
                /* Old cache formats do not block a new lookup. */
              }
            }
            const book = await load(isbn, refresh);
            remember(book, isbn);
            if (refresh && verified(book, isbn)) {
              try {
                const key = "isbn:v15:" + isbn;
                const previous = JSON.parse(context.cache.get(key) || "null");
                if (previous?.found && previous.details?.url === book.url)
                  context.cache.put(
                    key,
                    JSON.stringify({
                      ...previous,
                      details: normalizeRecordTypes({
                        ...previous.details,
                        ...book,
                      }),
                      checkedAt: new Date().toISOString(),
                    }),
                    Infinity,
                  );
              } catch {
                /* No aggregate snapshot needs updating. */
              }
            }
            // Only independently verified public metadata belongs in this shared cache.
            return book
              ? normalizeRecordTypes({
                  ...book,
                  checkedAt: new Date().toISOString(),
                })
              : null;
          },
        );
    }
    if (scraper.searchIsbn) {
      const load = scraper.searchIsbn;
      scraper.searchIsbn = (isbn, refresh = false) =>
        context.scrapeCache.get(
          `source-search:v1:${metadata.id}:${isbn}`,
          {
            maxAge: SCRAPE_TTL.isbn,
            refresh,
            permanent: (result) =>
              result.items.some((book) => verified(book, isbn)),
          },
          async () => {
            const result = await load(isbn, refresh);
            for (const book of result.items) remember(book, isbn);
            return normalizeRecordTypes(result);
          },
        );
    }
    if (scraper.coverOptions && scraper.lookupIsbn) {
      const load = scraper.coverOptions;
      scraper.coverOptions = async (book, refresh = false) => {
        const isbn = canonicalIsbn(book.isbn);
        if (isbn) {
          const details = await scraper.lookupIsbn(isbn, refresh);
          if (details?.coverUrl)
            return [
              {
                coverUrl: details.coverUrl,
                title: details.title,
                url: book.publisherUrl || details.url || "",
                source: details.source,
                sourceUrl: details.url,
              },
            ];
          return [];
        }
        return load({ ...book, type: book.edition || book.type }, refresh);
      };
    }
    sources.set(definition.id, { ...metadata, ...scraper });
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
