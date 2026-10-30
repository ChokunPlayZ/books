import { canonicalIsbn } from "../../domain/isbn.ts";
import {
  KODANSHA,
  KODANSHA_RELEASES,
  kodanshaBook,
  kodanshaListings,
  kodanshaSeriesHeading,
  kodanshaSeriesPage,
} from "../../domain/kodansha.ts";
import { safeProductUrl, safeSeriesCatalogUrl } from "../../domain/urls.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { CatalogResult, ScraperDefinition } from "./types.ts";
import type { Release } from "../../types.ts";

export const kodansha: ScraperDefinition = {
  id: "kodansha",
  hosts: ["www.kodansha.co.jp"],
  isbnPriority: 65,
  isbnPrefixes: ["978406"],
  isbnWarning: "Kodansha JP is unavailable right now.",
  create(context) {
    const searchUrl = (isbn: string) =>
      KODANSHA + "/products/search?keywords=" + isbn;
    async function search(raw: string, refresh = false) {
      const isbn = canonicalIsbn(raw);
      return context.scrapeCache.get(
        "kodansha-isbn:v1:" + isbn,
        { maxAge: SCRAPE_TTL.isbn, refresh },
        async () => {
          const response = await context.requestRemote(searchUrl(isbn));
          if (response.status === 404) return null;
          if (response.status !== 200)
            throw new Error("Kodansha search unavailable.");
          const candidates = kodanshaListings(response.body).items.slice(0, 4);
          let failure: unknown;
          for (const candidate of candidates) {
            try {
              const book = kodanshaBook(
                await context.fetchText(
                  candidate.url,
                  refresh,
                  SCRAPE_TTL.product,
                ),
                isbn,
                candidate.url,
              );
              if (book) return book;
            } catch (error) {
              failure = error;
            }
          }
          if (failure) throw failure;
          return null;
        },
      );
    }
    async function recent(refresh = false) {
      const items = new Map<string, Release>();
      let pages = 0;
      for (let page = 1; page <= 2; page++) {
        const parsed = kodanshaListings(
          await context.fetchText(
            KODANSHA_RELEASES + (page === 1 ? "" : "?page=" + page),
            refresh,
            SCRAPE_TTL.releases,
          ),
        );
        const before = items.size;
        pages++;
        parsed.items.forEach((item) => items.set(item.url, item));
        if (items.size === before && parsed.cards)
          throw new Error("Kodansha repeated a release page.");
        if (parsed.cards < 20) break;
      }
      return { items: [...items.values()].slice(0, 40), pages };
    }
    async function catalog(
      raw: string,
      refresh = false,
    ): Promise<CatalogResult> {
      const url = safeSeriesCatalogUrl(raw, "kodansha");
      if (!url) throw new Error("Choose a Kodansha JP series URL.");
      if (url === KODANSHA_RELEASES)
        return {
          ...(await recent(refresh)),
          total: null,
          complete: false,
          title: "Kodansha JP recent print comics",
        };
      const heading = kodanshaSeriesHeading(
        await context.fetchText(url, refresh),
      );
      const items = new Map<string, Release>(),
        seen = new Set<string>();
      let pages = 0,
        complete = false;
      for (let count = 0; count < 20; count++) {
        try {
          const page = kodanshaSeriesPage(
            await context.fetchJson(url + "/api?count=" + count, refresh),
          );
          if (
            new Set(page.ids).size !== page.ids.length ||
            page.ids.some((id) => seen.has(id))
          )
            break;
          page.ids.forEach((id) => seen.add(id));
          page.items.forEach((item) => items.set(item.url, item));
          pages++;
          if (!page.more) {
            complete = seen.size === heading.total;
            break;
          }
          if (!page.ids.length || seen.size >= heading.total) break;
        } catch (error) {
          if (!pages) throw error;
          break;
        }
      }
      return { ...heading, items: [...items.values()], pages, complete };
    }
    return {
      releases: async (refresh) => (await recent(refresh)).items,
      catalog,
      // The public series URLs are stable; Japanese and translated shelf names
      // require an explicit selection rather than guessing a translation.
      seriesDirectory: {
        url: KODANSHA + "/comic",
        manual: true,
      },
      preserveParsedSeries: true,
      preserveCompleteSeries: true,
      coverFromSeries: true,
      lookupIsbn: (isbn, refresh) =>
        isbn.startsWith("978406")
          ? search(isbn, refresh)
          : Promise.resolve(null),
      searchIsbn: async (raw, refresh) => {
        const isbn = canonicalIsbn(raw);
        const book = await search(isbn, refresh);
        return {
          publisherId: "kodansha",
          isbn,
          url: searchUrl(isbn),
          items: book ? [book] : [],
          warnings: [],
        };
      },
      gallery: async (item, book, refresh) => {
        const url = safeProductUrl(item.url, "kodansha");
        if (!url) return [];
        const details = kodanshaBook(
          await context.fetchText(url, refresh, SCRAPE_TTL.product),
          canonicalIsbn(book.isbn),
          url,
        );
        if (
          !details ||
          (!book.isbn &&
            (book.volume === "" ||
              details.special ||
              details.bundle ||
              details.volume !== book.volume ||
              details.type !== book.type))
        )
          return [];
        return details.coverUrl ? [details] : [];
      },
    };
  },
};
