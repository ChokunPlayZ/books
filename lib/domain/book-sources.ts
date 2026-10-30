import { canonicalIsbn, ISBN_GROUP_PREFIXES } from "./isbn.ts";
import { kinokuniyaSearchUrl } from "./urls.ts";

// Keep publisher choices and search links aligned with automatic ISBN routing.
// Unrestricted sources, including multilingual bookstores, need no entry.
export const BOOK_SOURCE_ISBN_PREFIXES: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  naiin: ISBN_GROUP_PREFIXES.thai,
  yaakz: ISBN_GROUP_PREFIXES.thai,
  firstpage: ISBN_GROUP_PREFIXES.thai,
  animag: ISBN_GROUP_PREFIXES.thai,
  dexpress: ISBN_GROUP_PREFIXES.thai,
  phoenix: ISBN_GROUP_PREFIXES.thai,
  luckpim: ISBN_GROUP_PREFIXES.thai,
  lilyhouse: [...ISBN_GROUP_PREFIXES.thai, ...ISBN_GROUP_PREFIXES.english],
  yenpress: ISBN_GROUP_PREFIXES.english,
  kodansha: ["978406"],
  hanmoto: ISBN_GROUP_PREFIXES.japanese,
});

export function bookSourceApplies(
  sourceId: string,
  book: { isbn?: string; type?: string },
) {
  const prefixes = Object.hasOwn(BOOK_SOURCE_ISBN_PREFIXES, sourceId)
    ? BOOK_SOURCE_ISBN_PREFIXES[sourceId]
    : undefined;
  if (!prefixes) return true;
  const language = /\((TH|EN|JP)\)/i.exec(book.type || "")?.[1].toUpperCase();
  const group = { TH: "thai", EN: "english", JP: "japanese" }[language];
  if (
    group &&
    !prefixes.some((prefix) =>
      ISBN_GROUP_PREFIXES[group].some(
        (groupPrefix: string) =>
          prefix.startsWith(groupPrefix) || groupPrefix.startsWith(prefix),
      ),
    )
  )
    return false;
  const isbn = canonicalIsbn(book.isbn);
  return !isbn || prefixes.some((prefix) => isbn.startsWith(prefix));
}

export function isbnSearchLinks(raw: string, type = "") {
  const isbn = canonicalIsbn(raw);
  if (!isbn) return [];
  return [
    {
      id: "naiin",
      name: "Naiin",
      url: "https://www.naiin.com/search-result?title=" + isbn,
    },
    {
      id: "phoenix",
      name: "Phoenix Next",
      url: "https://www.phoenixnext.com/catalogsearch/result/?q=" + isbn,
    },
    {
      id: "firstpage",
      name: "First Page Pro",
      url: "https://www.firstpagepro.com/search?q=" + isbn,
    },
    {
      id: "animag",
      name: "Animag",
      url: "https://www.animagshop.com/search?q=" + isbn,
    },
    {
      id: "dexpress",
      name: "DEXpress",
      url: "https://www.dexpress-shop.com/search?q=" + isbn,
    },
    { id: "kinokuniya", name: "Kinokuniya", url: kinokuniyaSearchUrl(isbn) },
  ].filter((source) => bookSourceApplies(source.id, { isbn, type }));
}
