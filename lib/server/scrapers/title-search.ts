import {
  catalogTotal,
  parseCatalog,
  splitFirstPageTitle,
  textHtml,
} from "../../domain.ts";
import type { Scraper, ScraperContext, ScraperDefinition } from "./types.ts";
import { ScrapeFailure } from "../scrape-diagnostics.ts";

type Source = Scraper & Pick<ScraperDefinition, "id" | "priceSource">;

export function supportsTitleSearch(source: Source) {
  return !!(
    source.searchTitles ||
    (source.catalog && (source.priceSource || source.searchSeriesUrl))
  );
}

// A bounded search, not a crawl of every publisher category. Shared by normal
// title discovery and the debugger so both exercise the same parser.
export async function searchSourceTitles(
  context: ScraperContext,
  source: Source,
  query: string,
) {
  if (source.searchTitles) return source.searchTitles(query);
  if (source.priceSource && source.catalog) {
    const url = source.priceSource.searchUrl(encodeURIComponent(query));
    const html = await context.fetchText(url);
    const items = parseCatalog(source.id, html, url)
      .slice(0, 48)
      .map((item) =>
        source.id === "firstpage"
          ? { ...item, ...splitFirstPageTitle(item.title) }
          : item,
      );
    const total = catalogTotal(source.id, html);
    if (
      !items.length &&
      total !== 0 &&
      !/ไม่พบสินค้า|ไม่พบข้อมูล|no results|no products|search found no/i.test(
        textHtml(html),
      )
    )
      throw new ScrapeFailure({
        kind: "parser",
        url,
        status: 200,
        message:
          "Title search markup unavailable; the page did not contain readable results or a recognized no-results message.",
      });
    return { items, complete: total !== null && total === items.length };
  }
  if (source.searchSeriesUrl && source.catalog)
    return source.catalog(source.searchSeriesUrl(query));
  throw new Error("This provider does not support title search.");
}
