import { catalogTotal, parseCatalog, textHtml } from "../../domain.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { Release } from "../../types.ts";
import type { IsbnSearchResult, ScraperContext } from "./types.ts";

type SearchOptions = {
  id: string;
  url(isbn: string): string;
  resolve(
    candidates: Release[],
    isbn: string,
    refresh: boolean,
    total: number | null,
  ): Promise<{ items: Release[]; warnings: string[] }>;
  normalize?(items: Release[]): Release[];
};

export function createIsbnSearch(
  context: ScraperContext,
  options: SearchOptions,
) {
  return async (isbn: string, refresh = false): Promise<IsbnSearchResult> => {
    const url = options.url(isbn);
    const result = await context.scrapeCache.get(
      "publisher-isbn:v1:" + options.id + ":" + isbn,
      { maxAge: SCRAPE_TTL.isbn, refresh },
      async () => {
        const html = await context.fetchText(url, refresh, SCRAPE_TTL.isbn);
        const candidates = [
          ...new Map(
            parseCatalog(options.id, html).map((item) => [item.url, item]),
          ).values(),
        ];
        const total = catalogTotal(options.id, html);
        if (
          !candidates.length &&
          total !== 0 &&
          !/search found no results|ไม่พบสินค้า|ไม่พบข้อมูล/i.test(
            textHtml(html),
          )
        )
          throw new Error(
            "The publisher’s search could not be read. Try again later.",
          );
        return {
          publisherId: options.id,
          isbn,
          url,
          ...(await options.resolve(candidates, isbn, refresh, total)),
        };
      },
    );
    if (options.normalize) result.items = options.normalize(result.items);
    return result;
  };
}
