import { kinokuniyaBook } from "../../domain/kinokuniya.ts";
import { canonicalIsbn } from "../../domain/isbn.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";

export const kinokuniya: ScraperDefinition = {
  id: "kinokuniya",
  hosts: ["kinokuniya.co.th"],
  isbnPriority: 70,
  isbnWarning: "Kinokuniya is unavailable right now.",
  coverPriority: 40,
  coverWarning: "Could not check Kinokuniya for this ISBN.",
  create({ scrapeCache, requestRemote }: ScraperContext) {
    async function lookupKinokuniya_(canonical: string, refresh = false) {
      return scrapeCache.get(
        "kinokuniya-isbn:v2:" + canonical,
        { maxAge: SCRAPE_TTL.isbn, refresh },
        async () => {
          const response = await requestRemote(
            "https://kinokuniya.co.th/products/" + canonical,
          );
          if (response.status === 404) return null;
          if (response.status !== 200)
            throw new Error("Kinokuniya unavailable.");
          return kinokuniyaBook(response.body, canonical);
        },
      );
    }

    return {
      lookupIsbn: lookupKinokuniya_,
      coverOptions: async (book, refresh) => {
        const isbn = canonicalIsbn(book.isbn);
        if (!isbn) return [];
        const item = await lookupKinokuniya_(isbn, refresh);
        return item?.coverUrl
          ? [
              {
                coverUrl: item.coverUrl,
                title: item.title,
                url: book.publisherUrl || "",
                source: "Kinokuniya",
                sourceUrl: item.url,
              },
            ]
          : [];
      },
    };
  },
};
