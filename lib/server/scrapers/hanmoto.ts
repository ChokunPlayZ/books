import { hanmotoBook } from "../../domain/hanmoto.ts";
import { canonicalIsbn } from "../../domain/isbn.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";

export const hanmoto: ScraperDefinition = {
  id: "hanmoto",
  hosts: ["www.hanmoto.com"],
  isbnPriority: 75,
  isbnWarning: "Hanmoto is unavailable right now.",
  coverPriority: 45,
  coverWarning: "Could not check Hanmoto for this ISBN.",
  create({ scrapeCache, requestRemote }: ScraperContext) {
    async function lookupHanmoto(raw: string, refresh = false) {
      const isbn = canonicalIsbn(raw);
      // This catalog covers Japanese ISBNs. Other editions need no request.
      if (!isbn.startsWith("9784")) return null;
      return scrapeCache.get(
        "hanmoto-isbn:v1:" + isbn,
        { maxAge: SCRAPE_TTL.isbn, refresh },
        async () => {
          const response = await requestRemote(
            "https://www.hanmoto.com/bd/isbn/" + isbn,
          );
          if (response.status === 404) return null;
          if (response.status !== 200) throw new Error("Hanmoto unavailable.");
          return hanmotoBook(response.body, isbn);
        },
      );
    }
    return {
      lookupIsbn: lookupHanmoto,
      coverOptions: async (book, refresh) => {
        const item = await lookupHanmoto(book.isbn, refresh);
        return item?.coverUrl
          ? [
              {
                coverUrl: item.coverUrl,
                title: item.title,
                url: book.publisherUrl || "",
                source: item.source,
                sourceUrl: item.url,
              },
            ]
          : [];
      },
    };
  },
};
