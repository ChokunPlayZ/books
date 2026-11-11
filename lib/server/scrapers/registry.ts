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
import type {
  BookDetails,
  Scraper,
  ScraperContext,
  ScraperDefinition,
} from "./types.ts";
import { canonicalIsbn } from "../../domain/isbn.ts";
import { digest } from "../../domain/hash.ts";
import {
  htmlSeriesMetadata,
  mergeSeriesMetadata,
} from "../../domain/series-info.ts";
import { normalizeRecordTypes } from "../../domain/book-type.ts";
import { sourceBookFacts } from "../../domain/series-sources.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import {
  recordScrapeDiagnostic,
  recordScrapeError,
  withScrapeSource,
} from "../scrape-diagnostics.ts";

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
  source: Pick<ScraperDefinition, "isbnPrefixes" | "isbnExcludedPrefixes">,
  canonical: string,
) {
  return (
    (!source.isbnPrefixes ||
      source.isbnPrefixes.some((prefix) => canonical.startsWith(prefix))) &&
    !source.isbnExcludedPrefixes?.some((prefix) => canonical.startsWith(prefix))
  );
}

export function createScraperRegistry(
  context: ScraperContext,
  definitions: readonly ScraperDefinition[] = SCRAPER_SOURCES,
  onBooks?: (books: BookDetails[]) => Promise<unknown>,
) {
  const sources = new Map<string, RegisteredScraper>();
  const observers: ((books: BookDetails[]) => Promise<void>)[] = [];
  for (const definition of definitions) {
    if (sources.has(definition.id))
      throw new Error("Duplicate scraper source: " + definition.id);
    const { create, ...metadata } = definition;
    const scraper = create(context);
    const parseBook = scraper.reparseBook;
    const reparseBook = async (book) => {
      if (!book) return book;
      const raw = parseBook ? await parseBook(book) : book;
      if (!raw) return raw;
      const parsed = {
        ...raw,
        ...mergeSeriesMetadata(raw, { facts: sourceBookFacts(raw) }),
      };
      if (!parsed?.url) return parsed;
      try {
        const snapshot = JSON.parse(
          (await context.cache.get(
            "scrape:v1:" + digest("text:" + parsed.url),
          )) || "null",
        );
        if (typeof snapshot?.value !== "string") return parsed;
        const source = parsed.source || parsed.publisher || metadata.id;
        return {
          ...parsed,
          ...mergeSeriesMetadata(
            parsed,
            htmlSeriesMetadata(
              snapshot.value,
              source,
              parsed.url,
              canonicalIsbn(parsed.isbn),
            ),
          ),
        };
      } catch {
        return parsed;
      }
    };
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
    async function remember(book, isbn: string) {
      if (!verified(book, isbn)) return;
      const url = new URL(book.url).href;
      await context.cache.put("known-product:v1:" + url, isbn, Infinity);
      await context.scrapeCache.pin("text:" + url);
    }
    async function observe(
      books: BookDetails[],
      expected = "",
      exactLookup = false,
    ) {
      if (!onBooks) return;
      const matches: BookDetails[] = [];
      for (const book of books) {
        if (!book || book.special || book.bundle || book.isbnVerified === false)
          continue;
        let url: URL | undefined;
        if (book.url) {
          try {
            url = new URL(book.url);
          } catch {
            continue;
          }
          if (
            url.protocol !== "https:" ||
            !metadata.hosts.includes(url.hostname) ||
            url.username ||
            url.password ||
            url.port
          )
            continue;
        }
        const known =
          !exactLookup && !expected && book.isbnVerified !== true && url
            ? await context.cache.get("known-product:v1:" + url.href)
            : "";
        const isbn = canonicalIsbn(
          book.isbn || (exactLookup ? expected : known),
        );
        if (!isbn || (expected && isbn !== expected)) continue;
        if (book.isbn && canonicalIsbn(book.isbn) !== isbn) continue;
        if (known && known !== isbn) continue;
        if (!exactLookup && !book.url) continue;
        const confirmed =
          exactLookup ||
          (expected && verified(book, isbn)) ||
          book.isbnVerified === true ||
          known === isbn;
        if (confirmed) matches.push({ ...book, isbn, isbnVerified: true });
      }
      if (matches.length) await onBooks(matches);
    }
    observers.push((books) => observe(books));
    if (scraper.bookDetails) {
      const load = scraper.bookDetails;
      scraper.bookDetails = async (url, refresh = false) =>
        context.scrapeCache.get(
          `source-product:v1:${metadata.id}:${url}`,
          {
            maxAge: SCRAPE_TTL.product,
            refresh,
            permanent: (book) =>
              !!book?.isbnVerified && verified(book, canonicalIsbn(book?.isbn)),
          },
          async () => {
            const book = await load(url, refresh);
            const isbn = canonicalIsbn(book?.isbn);
            if (book?.isbnVerified && isbn && verified(book, isbn)) {
              await remember(book, isbn);
              // Title discovery becomes a reusable exact-ISBN source match,
              // without replaying this store's search endpoint later.
              await context.scrapeCache.remember(
                `source-book:v1:${metadata.id}:${isbn}`,
                normalizeRecordTypes({
                  ...book,
                  checkedAt: new Date().toISOString(),
                }),
                SCRAPE_TTL.isbn,
                true,
              );
            }
            return book ? normalizeRecordTypes(book) : null;
          },
        );
    }
    if (scraper.lookupIsbn) {
      const load = scraper.lookupIsbn;
      scraper.lookupIsbn = async (isbn, refresh = false) =>
        await context.scrapeCache.get(
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
                  (await context.cache.get("isbn:v15:" + isbn)) || "null",
                );
                const book =
                  legacy?.found && canonicalIsbn(legacy.isbn) === isbn
                    ? { ...legacy.details, isbn }
                    : null;
                if (verified(book, isbn)) {
                  await remember(book, isbn);
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
            await remember(book, isbn);
            if (refresh && verified(book, isbn)) {
              try {
                const key = "isbn:v15:" + isbn;
                const previous = JSON.parse(
                  (await context.cache.get(key)) || "null",
                );
                if (previous?.found && previous.details?.url === book.url)
                  await context.cache.put(
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
      scraper.searchIsbn = async (isbn, refresh = false) => {
        const result = await context.scrapeCache.get(
          `source-search:v1:${metadata.id}:${isbn}`,
          {
            maxAge: SCRAPE_TTL.isbn,
            refresh,
            permanent: (result) =>
              result.items.some((book) => verified(book, isbn)),
          },
          async () => {
            const result = await load(isbn, refresh);
            for (const book of result.items) await remember(book, isbn);
            return normalizeRecordTypes(result);
          },
        );
        if (scraper.reparseBook)
          result.items = await Promise.all(result.items.map(reparseBook));
        return result;
      };
    }
    scraper.reparseBook = reparseBook;
    {
      if (scraper.bookDetails) {
        const load = scraper.bookDetails;
        scraper.bookDetails = async (url, refresh) =>
          reparseBook(await load(url, refresh));
      }
      if (scraper.lookupIsbn) {
        const load = scraper.lookupIsbn;
        scraper.lookupIsbn = async (isbn, refresh) =>
          reparseBook(await load(isbn, refresh));
      }
    }
    // Observe results outside the response cache's loader: cache hits, parser
    // repairs, searches and unrelated release/gallery work all enrich metadata.
    if (scraper.lookupIsbn) {
      const load = scraper.lookupIsbn;
      scraper.lookupIsbn = async (isbn, refresh) => {
        const result = await load(isbn, refresh);
        await observe(result ? [result] : [], isbn, true);
        return result;
      };
    }
    if (scraper.bookDetails) {
      const load = scraper.bookDetails;
      scraper.bookDetails = async (...args) => {
        const result = await load(...args);
        await observe(result ? [result] : []);
        return result;
      };
    }
    if (scraper.searchIsbn) {
      const load = scraper.searchIsbn;
      scraper.searchIsbn = async (isbn, refresh) => {
        const result = await load(isbn, refresh);
        await observe(result.items, isbn);
        return result;
      };
    }
    if (scraper.catalog) {
      const load = scraper.catalog;
      scraper.catalog = async (...args) => {
        const result = await load(...args);
        await observe(result.items);
        return result;
      };
    }
    if (scraper.releases) {
      const load = scraper.releases;
      scraper.releases = async (...args) => {
        const result = await load(...args);
        await observe(result);
        return result;
      };
    }
    if (scraper.searchTitles) {
      const load = scraper.searchTitles;
      scraper.searchTitles = async (...args) => {
        const result = await load(...args);
        await observe(result.items);
        return result;
      };
    }
    if (scraper.gallery) {
      const load = scraper.gallery;
      scraper.gallery = async (...args) => {
        const result = await load(...args);
        await observe(result as BookDetails[]);
        return result;
      };
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
    if (scraper.coverOptions) {
      const load = scraper.coverOptions;
      scraper.coverOptions = async (...args) => {
        const result = await load(...args);
        await observe(
          result.map((option) => ({
            ...option,
            url: option.sourceUrl || option.url,
          })),
        );
        return result;
      };
    }
    // Keep diagnostics outside response caches and inside the calling job's
    // async context, including failures that a higher-level fallback catches.
    for (const operation of [
      "lookupIsbn",
      "searchIsbn",
      "searchTitles",
      "suggestTitles",
      "bookDetails",
      "catalog",
      "directory",
      "releases",
      "coverOptions",
      "gallery",
    ] as const) {
      const load = scraper[operation];
      if (!load) continue;
      (scraper as any)[operation] = (...args: any[]) =>
        withScrapeSource(definition.id, operation, async () => {
          try {
            const result = await (load as Function)(...args);
            if (
              (operation === "lookupIsbn" && !result) ||
              (["searchIsbn", "searchTitles"].includes(operation) &&
                result?.items?.length === 0 &&
                !result?.warnings?.length)
            )
              recordScrapeDiagnostic({
                kind: "not_found",
                message: `No matching result returned for ${JSON.stringify(args[0])}.`,
              });
            return result;
          } catch (error) {
            recordScrapeError(error);
            throw error;
          }
        });
    }
    sources.set(definition.id, { ...metadata, ...scraper });
  }
  return {
    async rememberBooks(books: BookDetails[]) {
      for (const observe of observers) await observe(books);
    },
    get: (id: string) => sources.get(id),
    titleProviders: [...sources.values()].filter(
      (source) =>
        source.titleLanguages && (source.searchTitles || source.catalog),
    ),
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
