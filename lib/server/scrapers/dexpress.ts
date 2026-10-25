import { canonicalIsbn, safeSeriesCatalogUrl } from "../../domain.ts";
import { dexpressProduct } from "../../domain/dexpress.ts";
import type { Release } from "../../types.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import { createHtmlCatalog } from "./html-catalog.ts";
import { publisherRedirectIdentity } from "./http.ts";
import { createIsbnSearch } from "./isbn-search.ts";
import type { CatalogResult, ScraperDefinition } from "./types.ts";

const base = "https://www.dexpress-shop.com";

export const dexpress: ScraperDefinition = {
  id: "dexpress",
  hosts: ["www.dexpress-shop.com"],
  priceSource: {
    name: "DEXpress",
    currency: "THB",
    searchUrl: (isbn) => base + "/search?q=" + isbn,
  },
  redirectIdentity: (url) => publisherRedirectIdentity("dexpress", url),
  isbnPriority: 45,
  isbnWarning: "DEXpress is unavailable right now.",
  create(context) {
    const readProduct = async (url: string, refresh = false) =>
      dexpressProduct(
        await context.fetchText(url, refresh, SCRAPE_TTL.product),
        url,
      );
    const searchIsbn = createIsbnSearch(context, {
      id: "dexpress",
      url: (isbn) => base + "/search?q=" + isbn,
      resolve: async (candidates, isbn, refresh) => {
        let unavailable = false;
        for (const candidate of candidates
          .filter((item) => !item.special && !item.bundle)
          .slice(0, 4)) {
          try {
            const { item, data } = await readProduct(candidate.url, refresh);
            const codes = [data.barcode, data.isbn].map(canonicalIsbn);
            if (!codes.some(Boolean))
              throw new Error("DEXpress product ISBN details are unavailable.");
            if (
              codes.includes(isbn) &&
              item.isbn === isbn &&
              !item.bundle &&
              !item.special
            )
              return { items: [{ ...item, source: "DEXpress" }], warnings: [] };
          } catch {
            unavailable = true;
          }
        }
        if (unavailable)
          throw new Error("DEXpress product ISBN details are unavailable.");
        return { items: [], warnings: [] };
      },
    });

    const options = {
      id: "dexpress",
      pagination: "tskp",
      releaseUrl: base + "/showroom/new",
      releaseLimit: 60,
    };
    const html = createHtmlCatalog(context, options);
    const recent = createHtmlCatalog(context, {
      ...options,
      expand: async (items: Release[], refresh: boolean) => {
        const expanded: Release[] = [];
        // Most manga cards state their format; only unlabeled listings need a
        // detail request. Unknown and selectable editions stay under review.
        for (let start = 0; start < items.length; start += 3) {
          expanded.push(
            ...(await Promise.all(
              items.slice(start, start + 3).map(async (item) => {
                if (
                  item.type ||
                  item.special ||
                  item.bundle ||
                  item.variantGroup
                )
                  return item;
                try {
                  const detail = await readProduct(item.url, refresh);
                  return { ...item, ...detail.item };
                } catch {
                  return item;
                }
              }),
            )),
          );
        }
        return expanded;
      },
    });
    async function catalog(
      raw: string,
      refresh = false,
    ): Promise<CatalogResult> {
      const url = safeSeriesCatalogUrl(raw, "dexpress");
      if (!url && raw !== base + "/")
        throw new Error("Invalid DEXpress catalog URL.");
      const page = new URL(url || raw);
      if (page.pathname.startsWith("/category/"))
        return html.catalog(url, refresh);
      // DEXpress has format categories, so search both independently instead
      // of guessing that an unlabeled book is a novel.
      const catalogs = await Promise.all(
        ["2", "3"].map((category) => {
          const endpoint = new URL(
            page.pathname === "/search" ? url : base + "/category/" + category,
          );
          if (page.pathname === "/search")
            endpoint.searchParams.set("category_id", category);
          return html.catalog(endpoint.href, refresh);
        }),
      );
      return {
        items: [
          ...new Map(
            catalogs
              .flatMap((catalog) => catalog.items)
              .map((item) => [item.id, item]),
          ).values(),
        ],
        total: catalogs.every((catalog) => catalog.total !== null)
          ? catalogs.reduce((sum, catalog) => sum + catalog.total, 0)
          : null,
        pages: catalogs.reduce((sum, catalog) => sum + catalog.pages, 0),
        complete: catalogs.every((catalog) => catalog.complete),
        title: page.searchParams.get("q") || "DEXpress titles",
        search: page.pathname === "/search",
      };
    }
    return {
      releases: recent.releases,
      catalog,
      searchIsbn,
      lookupIsbn: async (isbn, refresh) =>
        (await searchIsbn(isbn, refresh)).items[0] || null,
      searchSeriesUrl: (series) =>
        base + "/search?q=" + encodeURIComponent(series),
      preserveCompleteSeries: true,
      coverFromSeries: true,
    };
  },
};
