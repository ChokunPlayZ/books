import { canonicalIsbn, safeCoverUrl, parsePageCount } from "../../domain.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";
type GoogleBooksResponse = {
  items?: {
    volumeInfo?: {
      title?: string;
      publisher?: string;
      authors?: string[];
      pageCount?: number;
      industryIdentifiers?: { identifier?: string }[];
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    };
  }[];
};

export const googleBooks: ScraperDefinition = {
  id: "google-books",
  hosts: ["www.googleapis.com"],
  isbnPriority: 80,
  isbnWarning: "Google Books is unavailable right now.",
  create({ fetchJson: fetchJson_ }: ScraperContext) {
    return {
      lookupIsbn: async (canonical, refresh = false) => {
        const data = await fetchJson_<GoogleBooksResponse>(
          "https://www.googleapis.com/books/v1/volumes?q=isbn:" +
            encodeURIComponent(canonical) +
            "&maxResults=5",
          refresh,
        );
        const found = (data.items || []).find(function (item) {
          return ((item.volumeInfo || {}).industryIdentifiers || []).some(
            function (id) {
              return canonicalIsbn(id.identifier) === canonical;
            },
          );
        });
        if (!found) return null;
        const v = found.volumeInfo;
        return {
          title: v.title || "",
          publisher: v.publisher || "",
          authors: (v.authors || []).join(", "),
          pageCount: parsePageCount(v.pageCount),
          source: "Google Books",
          coverUrl: safeCoverUrl(
            v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail,
          ),
        };
      },
    };
  },
};
