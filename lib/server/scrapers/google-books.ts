import {
  canonicalIsbn,
  safeCoverUrl,
  parsePageCount,
  splitBookTitle,
  splitKodanshaTitle,
  specialSet,
  releaseBundle,
} from "../../domain.ts";
import { searchLanguage } from "../../domain/search.ts";
import { ISBN_GROUP_PREFIXES } from "../../domain/isbn.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";
type GoogleBooksResponse = {
  items?: {
    id?: string;
    volumeInfo?: {
      title?: string;
      language?: string;
      categories?: string[];
      publisher?: string;
      authors?: string[];
      pageCount?: number;
      industryIdentifiers?: { identifier?: string }[];
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    };
  }[];
};
const excludedIsbnPrefixes = [
  ...ISBN_GROUP_PREFIXES.thai,
  ...ISBN_GROUP_PREFIXES.japanese,
];

export const googleBooks: ScraperDefinition = {
  id: "google-books",
  hosts: ["www.googleapis.com", "books.google.com"],
  titleLanguages: ["en"],
  isbnExcludedPrefixes: excludedIsbnPrefixes,
  isbnPriority: 80,
  isbnWarning: "Google Books is unavailable right now.",
  create({ fetchJson: fetchJson_ }: ScraperContext) {
    return {
      searchTitles: async (query) => {
        if (searchLanguage(query) !== "en")
          return { items: [], complete: true };
        const data = await fetchJson_<GoogleBooksResponse>(
          "https://www.googleapis.com/books/v1/volumes?q=" +
            encodeURIComponent(query) +
            "&maxResults=24&printType=books&langRestrict=en",
        );
        if (data.items && !Array.isArray(data.items))
          throw new Error("Google Books search changed.");
        return {
          items: (data.items || []).flatMap((item) => {
            const v = item.volumeInfo;
            if (!v?.title || !/^[\w-]+$/.test(item.id || "")) return [];
            const title = v.title.normalize("NFKC");
            const language = { th: "TH", en: "EN", ja: "JP" }[
              v.language || searchLanguage(title)
            ];
            const parsed = splitBookTitle(title);
            const japanese =
              language === "JP" ? splitKodanshaTitle(title) : null;
            if (japanese && japanese.volume !== "") {
              parsed.series = japanese.series;
              parsed.volume = japanese.volume;
            }
            const isbn =
              (v.industryIdentifiers || [])
                .map((id) => canonicalIsbn(id.identifier))
                .find(Boolean) || "";
            const type = /light\s*novel|ไลท์โนเวล|\(LN\)/i.test(title)
              ? "Light novel"
              : /comics|graphic novels|manga|มังงะ|การ์ตูน/i.test(
                    [title, ...(v.categories || [])].join(" "),
                  )
                ? "Manga"
                : "";
            return [
              {
                title: v.title,
                series: parsed.series,
                volume: parsed.volume,
                type,
                edition: language ? `(${language})` : "",
                publisher: v.publisher || "",
                isbn,
                isbnVerified: !!isbn,
                special: specialSet(title),
                bundle: releaseBundle(title),
                url: "https://books.google.com/books?id=" + item.id,
                authors: (v.authors || []).join(", "),
                pageCount: parsePageCount(v.pageCount),
                coverUrl: safeCoverUrl(
                  v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail,
                ),
                source: "Google Books",
              },
            ];
          }),
          complete: false,
        };
      },
      lookupIsbn: async (raw, refresh = false) => {
        const canonical = canonicalIsbn(raw);
        if (
          !canonical ||
          excludedIsbnPrefixes.some((prefix) => canonical.startsWith(prefix))
        )
          return null;
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
