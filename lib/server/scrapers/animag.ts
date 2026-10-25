import {
  canonicalIsbn,
  animagVariants,
  releaseItem,
  names,
  safeCoverUrl,
  safeProductUrl,
  textHtml,
} from "../../domain.ts";
import { animagProducts } from "../../domain/animag.ts";
import type { Release } from "../../types.ts";
import { publisherRedirectIdentity } from "./http.ts";
import { createHtmlCatalog, htmlDirectory } from "./html-catalog.ts";
import { createIsbnSearch } from "./isbn-search.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";

export const animag: ScraperDefinition = {
  id: "animag",
  hosts: ["www.animagshop.com"],
  priceSource: {
    name: "Animag",
    currency: "THB",
    searchUrl: (isbn) => "https://www.animagshop.com/search?q=" + isbn,
  },
  redirectIdentity: (url) => publisherRedirectIdentity("animag", url),
  isbnPriority: 40,
  isbnWarning: "Animag is unavailable right now.",
  create(context: ScraperContext) {
    async function expandAnimag_(items: Release[], refresh: boolean) {
      const expanded: Release[] = [];
      for (let start = 0; start < items.length; start += 3) {
        const batch = await Promise.all(
          items.slice(start, start + 3).map(async (item) => {
            if (!item.variantGroup) return [item];
            const variants = animagVariants(
              await context.fetchText(item.url, refresh, SCRAPE_TTL.product),
              item.url,
            );
            if (!variants.length)
              throw new Error("Animag product variants could not be read.");
            return variants;
          }),
        );
        expanded.push(...batch.flat());
      }
      return expanded;
    }

    const searchIsbn = createIsbnSearch(context, {
      id: "animag",
      url: (isbn) => "https://www.animagshop.com/search?q=" + isbn,
      resolve: async (candidates, isbn, refresh) => {
        candidates.sort(
          (a, b) => Number(b.isbn === isbn) - Number(a.isbn === isbn),
        );
        for (const candidate of candidates
          .filter((item) => !item.special && !item.bundle)
          .slice(0, 4)) {
          const page = await context.fetchText(
            candidate.url,
            refresh,
            SCRAPE_TTL.product,
          );
          if (candidate.variantGroup) {
            const variants = animagVariants(page, candidate.url);
            if (!variants.length)
              throw new Error("Animag product variants could not be read.");
            const item = variants.find(
              (variant) =>
                variant.isbn === isbn && !variant.special && !variant.bundle,
            );
            if (item)
              return { items: [{ ...item, source: "Animag" }], warnings: [] };
            continue;
          }
          const product = animagProducts(page).find(
            (product) =>
              safeProductUrl(product.url, "animag") === candidate.url,
          );
          if (
            !product ||
            ![product.isbn, product.gtin13, product.gtin, product.sku].some(
              (code) => canonicalIsbn(code),
            )
          )
            throw new Error("Animag product ISBN details are unavailable.");
          if (!textHtml(product.name || ""))
            throw new Error("Animag product details changed.");
          if (
            ![product.isbn, product.gtin13, product.gtin, product.sku].some(
              (code) => canonicalIsbn(code) === isbn,
            )
          )
            continue;
          const offer = Array.isArray(product.offers)
            ? product.offers[0]
            : product.offers;
          const item = {
            ...releaseItem(
              "animag",
              product.name,
              candidate.url,
              offer?.price,
              isbn,
            ),
            coverUrl: safeCoverUrl(
              Array.isArray(product.image) ? product.image[0] : product.image,
              candidate.url,
            ),
            source: "Animag",
            authors: names(product.author),
            currency: offer?.priceCurrency || "THB",
            availability: offer?.availability || candidate.availability,
          };
          if (!item.isbn || item.bundle) continue;
          return {
            items: [
              {
                ...candidate,
                ...item,
                coverUrl: item.coverUrl || candidate.coverUrl,
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
        id: "animag",
        pagination: "tskp",
        releaseUrl: "https://www.animagshop.com/category?sortby=new",
        releaseLimit: 100,
        headingPrefix: /^[•\s]+/,
        expand: expandAnimag_,
      }),
      searchIsbn,
      lookupIsbn: async (isbn, refresh) =>
        (await searchIsbn(isbn, refresh)).items[0] || null,
      directory: (url, refresh) =>
        htmlDirectory(
          context,
          "animag",
          url,
          "Animag titles",
          refresh,
          "https://www.animagshop.com/search",
        ),
      seriesDirectory: {
        url: "https://www.animagshop.com/",
        fromPublisherDirectory: true,
      },
      preserveCompleteSeries: true,
      coverFromSeries: true,
    };
  },
};
