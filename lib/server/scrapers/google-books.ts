import { canonicalIsbn, safeCoverUrl, parsePageCount } from "../../domain.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";
type GoogleBooksResponse = {
  items?: {
    id?: string;
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
  hosts: ["www.googleapis.com", "books.google.com"],
  titleLanguages: ["th", "en", "ja"],
  isbnPriority: 80,
  isbnWarning: "Google Books is unavailable right now.",
  create({ fetchJson: fetchJson_ }: ScraperContext) {
    return {
      searchTitles: async (query) => {
        const data = await fetchJson_<GoogleBooksResponse>(
          "https://www.googleapis.com/books/v1/volumes?q=" +
            encodeURIComponent(query) +
            "&maxResults=24&printType=books",
        );
        if (data.items && !Array.isArray(data.items))
          throw new Error("Google Books search changed.");
        return {
          items: (data.items || []).flatMap((item) => {
            const v = item.volumeInfo;
            if (!v?.title || !/^[\w-]+$/.test(item.id || "")) return [];
            return [
              {
                title: v.title,
                publisher: v.publisher || "",
                isbn:
                  (v.industryIdentifiers || [])
                    .map((id) => canonicalIsbn(id.identifier))
                    .find(Boolean) || "",
                url: "https://books.google.com/books?id=" + item.id,
              },
            ];
          }),
          complete: false,
        };
      },
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
