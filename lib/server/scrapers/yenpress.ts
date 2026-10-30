import { canonicalIsbn, ISBN_GROUP_PREFIXES } from "../../domain/isbn.ts";
import {
  yenPressBook,
  yenPressCandidates,
  yenPressSearchKey,
} from "../../domain/yenpress.ts";
import {
  yenPressSearchPage,
  yenPressDirectoryTitles,
  yenPressSeriesCatalog,
  yenPressSeriesPage,
  yenPressSeriesComplete,
  yenPressCalendar,
  yenPressPrintReleases,
} from "../../domain/yenpress-catalogs.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type {
  CatalogResult,
  ScraperContext,
  ScraperDefinition,
} from "./types.ts";

export const yenpress: ScraperDefinition = {
  id: "yenpress",
  hosts: ["yenpress.com", "enterprise-search.yenpress.com"],
  isbnPriority: 60,
  isbnPrefixes: ISBN_GROUP_PREFIXES.english,
  isbnWarning: "Yen Press is unavailable right now.",
  coverPriority: 30,
  coverWarning: "Could not check Yen Press for this ISBN.",
  create({
    scrapeCache,
    requestRemote,
    fetchText: fetchText_,
  }: ScraperContext) {
    async function lookupYenPress_(canonical: string, refresh = false) {
      return scrapeCache.get(
        "yenpress-isbn:v1:" + canonical,
        { maxAge: SCRAPE_TTL.isbn, refresh },
        async () => {
          const data = await searchYenPress_(await yenPressKey_(), {
            query: canonical,
            page: { size: 4 },
            search_fields: { isbn: {} },
            result_fields: { isbn: { raw: {} }, url: { raw: {} } },
          });
          for (const url of yenPressCandidates(data, canonical)) {
            const book = yenPressBook(
              await fetchText_(url, refresh, SCRAPE_TTL.product),
              canonical,
              url,
            );
            if (book) return book;
          }
          return null;
        },
      );
    }

    async function yenPressKey_() {
      // The site's public key is held only for this operation, never persisted.
      const bootstrap = await requestRemote("https://yenpress.com/search");
      if (bootstrap.status !== 200)
        throw new Error("Yen Press search unavailable.");
      return yenPressSearchKey(bootstrap.body);
    }

    async function searchYenPress_(
      key: string,
      query: Record<string, unknown>,
    ) {
      const response = await requestRemote(
        "https://enterprise-search.yenpress.com/api/as/v1/engines/yenpress/search",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            Origin: "https://yenpress.com",
            Referer: "https://yenpress.com/",
          },
          body: JSON.stringify(query),
        },
      );
      if (response.status !== 200)
        throw new Error("Yen Press search unavailable.");
      return JSON.parse(response.body) as unknown;
    }

    async function fetchYenPressDirectory_(refresh = false) {
      return scrapeCache.get(
        "yenpress-directory:v1",
        { maxAge: SCRAPE_TTL.directory, refresh },
        async () => {
          const key = await yenPressKey_(),
            records: unknown[] = [],
            seen = new Set<string>();
          let expected: number | null = null;
          for (let current = 1; current <= 20; current++) {
            const page = yenPressSearchPage(
              await searchYenPress_(key, {
                query: "",
                filters: {
                  all: [{ type: "series" }],
                  none: [{ imprint_id: "3" }],
                },
                page: { size: 1000, current },
                result_fields: {
                  title: { raw: {} },
                  url: { raw: {} },
                  imprint_id: { raw: {} },
                },
              }),
            );
            if (
              page.current !== current ||
              (expected !== null && expected !== page.total)
            )
              throw new Error("Yen Press directory changed while loading.");
            expected = page.total;
            for (const [index, record] of page.records.entries()) {
              const id = page.ids[index];
              if (!seen.has(id)) {
                seen.add(id);
                records.push(record);
              }
            }
            if (current >= page.pages) {
              if (records.length !== expected)
                throw new Error("Yen Press directory is incomplete.");
              return yenPressDirectoryTitles(records);
            }
            if (!page.records.length) break;
          }
          throw new Error("Yen Press directory is incomplete.");
        },
      );
    }

    async function fetchYenPressReleases_(refresh = false) {
      return scrapeCache.get(
        "yenpress-releases:v1",
        { maxAge: SCRAPE_TTL.releases, refresh },
        async () => {
          const calendar = yenPressCalendar(
            await fetchText_(
              "https://yenpress.com/calendar",
              refresh,
              SCRAPE_TTL.releases,
            ),
          );
          if (!calendar.length) return [];
          const data = await searchYenPress_(await yenPressKey_(), {
            query: "",
            filters: {
              all: [
                { isbn: calendar.map((book) => book.lookupIsbn) },
                { type: ["books-manga", "books-comics", "books-light-novels"] },
              ],
            },
            page: { size: 1000 },
            result_fields: {
              isbn: { raw: {} },
              url: { raw: {} },
              type: { raw: {} },
            },
          });
          return yenPressPrintReleases(data, calendar);
        },
      );
    }

    async function fetchYenPressSeries_(
      url: string,
      refresh = false,
    ): Promise<CatalogResult> {
      const first = yenPressSeriesCatalog(await fetchText_(url, refresh), url);
      const items = new Map(first.items.map((item) => [item.url, item]));
      const visited = new Set<string>();
      let nextUrl = first.nextUrl,
        pages = 1;
      while (nextUrl && pages < 20 && !visited.has(nextUrl)) {
        visited.add(nextUrl);
        try {
          const page = yenPressSeriesPage(
            await fetchText_(nextUrl, refresh, SCRAPE_TTL.catalog, {
              headers: { "X-Requested-With": "XMLHttpRequest", Referer: url },
            }),
            url,
            first.title,
            first.type,
          );
          const before = items.size;
          for (const item of page.items) items.set(item.url, item);
          pages++;
          nextUrl = page.nextUrl;
          if (items.size === before) break;
        } catch {
          break;
        }
      }
      return {
        title: first.title,
        items: [...items.values()],
        total: first.total,
        complete: yenPressSeriesComplete(
          [...items.values()],
          first.total,
          nextUrl,
        ),
        pages,
      };
    }

    return {
      catalog: fetchYenPressSeries_,
      releases: fetchYenPressReleases_,
      lookupIsbn: lookupYenPress_,
      coverOptions: async (book, refresh) => {
        const isbn = canonicalIsbn(book.isbn);
        if (!isbn || /\(TH\)/.test(book.type)) return [];
        const item = await lookupYenPress_(isbn, refresh);
        return item?.coverUrl ? [{ ...item, coverUrl: item.coverUrl }] : [];
      },
      directory: async (_url, refresh) => ({
        titles: await fetchYenPressDirectory_(refresh),
        title: "Yen Press titles",
      }),
      directoryAsCatalog: (url) => url !== "https://yenpress.com/",
      seriesDirectory: {
        url: "https://yenpress.com/",
        fromPublisherDirectory: true,
      },
      preserveParsedSeries: true,
      preserveCompleteSeries: true,
      coverFromSeries: true,
      gallery: async (item, book, refresh) => {
        const html = await fetchText_(item.url, refresh, SCRAPE_TTL.product);
        const isbn =
          canonicalIsbn(book.isbn) || /\/titles\/(\d{13})-/.exec(item.url)?.[1];
        const details = yenPressBook(html, isbn, item.url);
        return details &&
          (canonicalIsbn(book.isbn) ||
            (book.volume !== "" &&
              details.volume !== "" &&
              Number(details.volume) === Number(book.volume) &&
              details.type === book.type))
          ? [{ ...item, url: details.url, coverUrl: details.coverUrl }]
          : [];
      },
    };
  },
};
