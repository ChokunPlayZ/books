import { safeCoverUrl } from "../../domain.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";
type OpenLibraryResponse = Record<
  string,
  {
    title?: string;
    publishers?: { name?: string }[];
    authors?: { name?: string }[];
    cover?: { medium?: string; large?: string; small?: string };
  }
>;

export const openLibrary: ScraperDefinition = {
  id: "open-library",
  hosts: ["openlibrary.org"],
  isbnPriority: 90,
  isbnWarning: "Open Library is unavailable right now.",
  create({ fetchJson: fetchJson_ }: ScraperContext) {
    return {
      lookupIsbn: async (canonical) => {
        const key = "ISBN:" + canonical;
        const data = await fetchJson_<OpenLibraryResponse>(
          "https://openlibrary.org/api/books?bibkeys=" +
            encodeURIComponent(key) +
            "&jscmd=data&format=json",
        );
        const v = data[key];
        if (!v) return null;
        return {
          title: v.title || "",
          publisher: (v.publishers || [])
            .map(function (p) {
              return p.name;
            })
            .join(", "),
          authors: (v.authors || [])
            .map(function (a) {
              return a.name;
            })
            .join(", "),
          source: "Open Library",
          coverUrl: safeCoverUrl(
            v.cover?.medium || v.cover?.large || v.cover?.small,
          ),
        };
      },
    };
  },
};
