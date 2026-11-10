import { catalogTotal, parseCatalog, textHtml } from "../../domain.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import {
  recordScrapeDiagnostic,
  ScrapeFailure,
} from "../scrape-diagnostics.ts";
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
      "publisher-isbn:v2:" + options.id + ":" + isbn,
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
          throw new ScrapeFailure({
            kind: "parser",
            url,
            status: 200,
            message:
              "The publisher’s search could not be read: no readable product listings or recognized no-results message were present.",
          });
        const resolved = await options.resolve(
          candidates,
          isbn,
          refresh,
          total,
        );
        if (!resolved.items.length && !resolved.warnings.length)
          recordScrapeDiagnostic({
            kind: "not_found",
            url,
            status: 200,
            message: candidates.length
              ? `Search returned ${candidates.length} candidate(s), but none produced a verified match for ISBN ${isbn}.`
              : `Publisher search explicitly returned no results for ISBN ${isbn}.`,
          });
        return {
          publisherId: options.id,
          isbn,
          url,
          ...resolved,
        };
      },
    );
    if (options.normalize) result.items = options.normalize(result.items);
    return result;
  };
}
