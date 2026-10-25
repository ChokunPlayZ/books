import { parseCatalog, safeSeriesCatalogUrl, textHtml } from "../../domain.ts";
import {
  LILY_HOUSE,
  lilyHousePage,
  lilyHousePageUrl,
  lilyHousePagination,
  lilyHouseTotal,
} from "../../domain/lilyhouse.ts";
import type { Release } from "../../types.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import { createIsbnSearch } from "./isbn-search.ts";
import type { CatalogResult, ScraperDefinition } from "./types.ts";

export const lilyhouse: ScraperDefinition = {
  id: "lilyhouse",
  hosts: ["lily-house.com"],
  // WooCommerce adds a trailing slash; a redirect cannot change the resource,
  // search, sorting or pagination parameters.
  redirectIdentity: (url) =>
    url.origin + url.pathname.replace(/\/$/, "") + url.search,
  create(context) {
    async function catalog(
      raw: string,
      refresh = false,
    ): Promise<CatalogResult> {
      const url = safeSeriesCatalogUrl(raw, "lilyhouse");
      if (!url) throw new Error("Invalid Lily House catalog URL.");
      const items = new Map<string, Release>(),
        listings = new Set<string>();
      let pages = 0,
        total: number | null = null,
        complete = false,
        title = "Lily House titles";
      for (let page = 1; page <= 20; page++) {
        try {
          const html = await context.fetchText(
            lilyHousePageUrl(url, page),
            refresh,
          );
          const parsed = lilyHousePage(html);
          if (!parsed.valid && !parsed.empty)
            throw new Error("Lily House catalog markup changed.");
          if (page === 1) {
            total = lilyHouseTotal(html);
            const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
            title =
              new URL(url).searchParams.get("s") ||
              (heading ? textHtml(heading[1]) : title);
          }
          pages++;
          if (parsed.empty) {
            complete = page === 1;
            break;
          }
          const before = listings.size;
          parsed.items.forEach((item) => listings.add(item.url));
          parseCatalog("lilyhouse", html).forEach((item) =>
            items.set(item.id, item),
          );
          if (listings.size === before) break;
          const pagination = lilyHousePagination(html, url, page);
          if (pagination.terminal) {
            complete = total === null || total === listings.size;
            if (complete) total ??= listings.size;
            break;
          }
          if (!pagination.next) break;
        } catch (error) {
          if (!pages) throw error;
          break;
        }
      }
      return {
        items: [...items.values()],
        total,
        pages,
        complete,
        title,
        search: new URL(url).searchParams.has("s"),
      };
    }

    return {
      catalog,
      releases: async (refresh = false) => {
        const url = LILY_HOUSE + "/shop-2/?orderby=date";
        const items = new Map<string, Release>();
        for (let page = 1; page <= 2; page++) {
          const html = await context.fetchText(
            lilyHousePageUrl(url, page),
            refresh,
            SCRAPE_TTL.releases,
          );
          const parsed = lilyHousePage(html);
          if (!parsed.valid)
            throw new Error("Lily House releases could not be read.");
          parseCatalog("lilyhouse", html).forEach((item) =>
            items.set(item.id, item),
          );
          if (lilyHousePagination(html, url, page).terminal) break;
        }
        return [...items.values()].slice(0, 48);
      },
      searchSeriesUrl: (series) =>
        LILY_HOUSE + "/?s=" + encodeURIComponent(series) + "&post_type=product",
      searchIsbn: createIsbnSearch(context, {
        id: "lilyhouse",
        url: (isbn) => LILY_HOUSE + "/?s=" + isbn + "&post_type=product",
        resolve: async (candidates) => ({
          items: candidates.slice(0, 24),
          warnings: candidates.length
            ? [
                "These Lily House search results are unverified. Check the book’s barcode and edition before adding it.",
              ]
            : [],
        }),
      }),
      preserveCompleteSeries: true,
      coverFromSeries: true,
    };
  },
};
