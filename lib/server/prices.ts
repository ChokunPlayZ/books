import { canonicalIsbn } from "../domain/isbn.ts";
import { priceAvailability, sortPriceOffers } from "../domain/prices.ts";
import type { PriceComparison, PriceOffer } from "../types.ts";
import type { createScraperRegistry } from "./scrapers/registry.ts";
import type { ScraperContext } from "./scrapers/types.ts";

export function createPriceFinder(
  providers: ReturnType<typeof createScraperRegistry>["priceProviders"],
  scrapeCache: ScraperContext["scrapeCache"],
) {
  return async function findLowestPrices(request: {
    isbn: string;
    refresh?: boolean;
  }): Promise<PriceComparison> {
    const isbn = canonicalIsbn(request?.isbn);
    if (!isbn)
      throw new Error("Enter a valid ISBN-10 or ISBN-13 to compare prices.");
    const results = await Promise.allSettled(
      providers.map((provider) =>
        scrapeCache.get(
          "book-price:v1:" + provider.id + ":" + isbn,
          { maxAge: 3600, refresh: request.refresh === true },
          async () => {
            // Price checks bypass the longer-lived book metadata/product cache.
            const book = await provider.lookupIsbn(isbn, true);
            const checkedAt = new Date().toISOString();
            if (!book || canonicalIsbn(book.isbn) !== isbn)
              return { offer: null, checkedAt };
            const url = new URL(book.url);
            if (
              url.protocol !== "https:" ||
              !provider.hosts.includes(url.hostname) ||
              url.username ||
              url.password ||
              url.port
            )
              throw new Error("Invalid shop product URL.");
            const rawPrice = book.price;
            const price =
              (typeof rawPrice === "number" ||
                (typeof rawPrice === "string" && rawPrice.trim() !== "")) &&
              Number.isFinite(Number(rawPrice)) &&
              Number(rawPrice) >= 0
                ? Number(rawPrice)
                : null;
            const currency = String(
              book.currency || provider.priceSource.currency,
            ).toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency))
              throw new Error("Shop currency could not be read.");
            const offer: PriceOffer = {
              shopId: provider.id,
              shop: provider.priceSource.name,
              isbn,
              title: book.title,
              url: url.href,
              price,
              currency,
              availability: priceAvailability(book.availability),
              checkedAt,
            };
            return { offer, checkedAt };
          },
        ),
      ),
    );
    const offers: PriceOffer[] = [];
    const sources: PriceComparison["sources"] = results.map((result, index) => {
      const provider = providers[index];
      if (result.status === "fulfilled" && result.value.offer)
        offers.push(result.value.offer);
      return {
        id: provider.id,
        name: provider.priceSource.name,
        searchUrl: provider.priceSource.searchUrl(isbn),
        status:
          result.status === "rejected"
            ? "unavailable"
            : result.value.offer
              ? "found"
              : "not_found",
        checkedAt:
          result.status === "fulfilled" ? result.value.checkedAt : null,
      };
    });
    return { isbn, offers: sortPriceOffers(offers), sources };
  };
}
