import { canonicalIsbn, digest, parseSeriesCategories } from "../../domain.ts";
import { phoenixBook } from "../../domain/phoenix.ts";
import { originalCoverUrl, safeProductUrl } from "../../domain/urls.ts";
import { createHtmlCatalog, htmlDirectory } from "./html-catalog.ts";
import { createIsbnSearch } from "./isbn-search.ts";
import { cachedJson } from "./cache.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import { ISBN_GROUP_PREFIXES } from "../../domain/isbn.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";
import { phoenixSuggestions } from "./suggestions.ts";

export const phoenix: ScraperDefinition = {
  id: "phoenix",
  titleLanguages: ["th", "en"],
  hosts: ["www.phoenixnext.com"],
  priceSource: {
    name: "Phoenix Next",
    currency: "THB",
    searchUrl: (isbn) =>
      "https://www.phoenixnext.com/catalogsearch/result/?q=" + isbn,
  },
  isbnPriority: 50,
  isbnPrefixes: ISBN_GROUP_PREFIXES.thai,
  isbnWarning: "Phoenix Next is unavailable right now.",
  create(context: ScraperContext) {
    const searchIsbn = createIsbnSearch(context, {
      id: "phoenix",
      url: (isbn) =>
        "https://www.phoenixnext.com/catalogsearch/result/?q=" + isbn,
      resolve: async (candidates, isbn, refresh) => {
        candidates.sort(
          (a, b) => Number(b.isbn === isbn) - Number(a.isbn === isbn),
        );
        for (const candidate of candidates.slice(0, 4)) {
          const book = phoenixBook(
            await context.fetchText(candidate.url, refresh, SCRAPE_TTL.product),
            isbn,
            candidate.url,
          );
          if (book)
            return {
              items: [
                {
                  ...candidate,
                  ...book,
                  coverUrl: book.coverUrl || candidate.coverUrl,
                },
              ],
              warnings: [],
            };
        }
        return { items: [], warnings: [] };
      },
    });
    return {
      suggestTitles: phoenixSuggestions(context),
      reparseBook: async (book) => {
        const url = safeProductUrl(book.url, "phoenix");
        if (!url) return book;
        const normalized = {
          ...book,
          coverUrl: originalCoverUrl(book.coverUrl),
        };
        // Confirmed source and aggregate records are permanent. Reuse the pinned
        // product HTML, not another remote request or a cache-version reset.
        const cached = await cachedJson(
          context.cache,
          "scrape:v1:" + digest("text:" + url),
        );
        if (canonicalIsbn(book.isbn) && typeof cached?.value === "string") {
          try {
            const parsed = phoenixBook(cached.value, book.isbn!, url);
            if (parsed) {
              normalized.coverUrl = parsed.coverUrl || normalized.coverUrl;
              if (
                parsed.msrp !== "" &&
                (book.msrp === "" || book.msrp == null)
              ) {
                normalized.msrp = parsed.msrp;
                normalized.msrpCurrency = parsed.msrpCurrency;
              }
            }
          } catch {
            // Old/incomplete HTML must not hide otherwise usable cached metadata.
          }
        }
        return normalized;
      },
      bookDetails: async (url, refresh) =>
        phoenixBook(
          await context.fetchText(url, refresh, SCRAPE_TTL.product),
          "",
          url,
        ),
      ...createHtmlCatalog(context, {
        id: "phoenix",
        pagination: "p",
        releaseUrl: "https://www.phoenixnext.com/new-release.html",
        releaseLimit: 72,
      }),
      searchIsbn,
      lookupIsbn: async (isbn, refresh) => {
        const result = await searchIsbn(isbn, refresh);
        const item = result.items.find(
          (item) => canonicalIsbn(item.isbn) === isbn,
        );
        return item ? { ...item, source: "Phoenix Next" } : null;
      },
      directory: (url, refresh) =>
        htmlDirectory(
          context,
          "phoenix",
          url,
          url.endsWith("gl.html")
            ? "Phoenix Next · Girl’s Love"
            : "Phoenix Next titles",
          refresh,
        ),
      seriesDirectory: {
        url: "https://www.phoenixnext.com/book-series.html",
        load: async (refresh) =>
          parseSeriesCategories(
            "phoenix",
            await context.fetchText(
              "https://www.phoenixnext.com/book-series.html",
              refresh,
              SCRAPE_TTL.directory,
            ),
          ),
      },
    };
  },
};
