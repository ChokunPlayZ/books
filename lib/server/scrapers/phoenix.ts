import { canonicalIsbn, parseSeriesCategories } from "../../domain.ts";
import { phoenixBook } from "../../domain/phoenix.ts";
import { createHtmlCatalog, htmlDirectory } from "./html-catalog.ts";
import { createIsbnSearch } from "./isbn-search.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import { ISBN_GROUP_PREFIXES } from "../../domain/isbn.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";

export const phoenix: ScraperDefinition = {
  id: "phoenix",
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
