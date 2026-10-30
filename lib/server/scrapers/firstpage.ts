import {
  parseSeriesCategories,
  splitFirstPageTitle,
  splitFirstPageTitles,
} from "../../domain.ts";
import { firstPageBook } from "../../domain/firstpage.ts";
import { publisherRedirectIdentity } from "./http.ts";
import { createHtmlCatalog, htmlDirectory } from "./html-catalog.ts";
import { createIsbnSearch } from "./isbn-search.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import { ISBN_GROUP_PREFIXES } from "../../domain/isbn.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";

export const firstpage: ScraperDefinition = {
  id: "firstpage",
  hosts: ["www.firstpagepro.com"],
  priceSource: {
    name: "First Page Pro",
    currency: "THB",
    searchUrl: (isbn) => "https://www.firstpagepro.com/search?q=" + isbn,
  },
  redirectIdentity: (url) => publisherRedirectIdentity("firstpage", url),
  isbnPriority: 30,
  isbnPrefixes: ISBN_GROUP_PREFIXES.thai,
  isbnWarning: "First Page Pro is unavailable right now.",
  create(context: ScraperContext) {
    const searchIsbn = createIsbnSearch(context, {
      id: "firstpage",
      url: (isbn) => "https://www.firstpagepro.com/search?q=" + isbn,
      normalize: (items) =>
        items.map((item) => {
          const parsed = splitFirstPageTitle(item.title);
          return { ...item, ...parsed, type: parsed.type || item.type };
        }),
      resolve: async (candidates, isbn, _refresh, total) => {
        // Search listings alone cannot verify a product's barcode.
        const items = candidates.slice(0, 24),
          warnings: string[] = [];
        if (items.length)
          warnings.push(
            "First Page Pro returned these books for ISBN " +
              isbn +
              ". These search results have not been checked against the product ISBN; check the book’s barcode before adding it.",
          );
        if (total !== null && total > items.length)
          warnings.push(
            "Showing the first " +
              items.length +
              " search results. Open the publisher search to see all results.",
          );
        return { items, warnings };
      },
    });
    async function lookupFirstPage_(canonical: string, refresh = false) {
      const result = await searchIsbn(canonical, refresh);
      let unavailable = false;
      for (const candidate of result.items.slice(0, 4)) {
        try {
          const html = await context.fetchText(
            candidate.url,
            refresh,
            SCRAPE_TTL.product,
          );
          const book = firstPageBook(html, canonical, candidate.url);
          if (book) return book;
        } catch {
          unavailable = true;
        }
      }
      if (unavailable)
        throw new Error("First Page Pro product details are unavailable.");
      return null;
    }

    return {
      ...createHtmlCatalog(context, {
        id: "firstpage",
        pagination: "tskp",
        releaseUrl: "https://www.firstpagepro.com/showroom/new",
        releaseLimit: 40,
      }),
      searchIsbn,
      lookupIsbn: lookupFirstPage_,
      normalizeDirectory: splitFirstPageTitles,
      directory: (url, refresh) =>
        htmlDirectory(
          context,
          "firstpage",
          url,
          "First Page Pro titles",
          refresh,
        ),
      seriesDirectory: {
        url: "https://www.firstpagepro.com/",
        load: async (refresh) =>
          parseSeriesCategories(
            "firstpage",
            await context.fetchText(
              "https://www.firstpagepro.com/",
              refresh,
              SCRAPE_TTL.directory,
            ),
          ),
      },
    };
  },
};
