import { canonicalIsbn } from "./isbn.ts";
import { searchKey, searchScore, type SearchResult } from "./search.ts";

export const SUGGESTION_LIMIT = 8;
export const SUFFICIENT_SUGGESTIONS = 6;
export type SearchSuggestion = { value: string; label: string; known: boolean };
export type QuerySuggestions = {
  query: string;
  suggestions: SearchSuggestion[];
  sources: { id: string; name: string }[];
  unavailable?: boolean;
};

export function canSuggest(query: string) {
  return (
    query.trim().length >= 2 &&
    query.length <= 200 &&
    !!searchKey(query) &&
    !/^(?:ISBN[\s:-]*)?[\d\s-]+[\dXx]?$/i.test(query.trim()) &&
    !canonicalIsbn(query)
  );
}

export function mergeSuggestions(query: string, items: SearchSuggestion[]) {
  const ranked = items
    .flatMap((item) => {
      if (!item || typeof item.value !== "string" || item.value.length > 200)
        return [];
      const score = searchScore(query, {
        title: item.value,
        series: "",
        publisher: "",
        isbn: "",
      } as SearchResult);
      // Fuzzy matches are useful in full search, but not as query completions.
      return score >= 500 ? [{ ...item, score }] : [];
    })
    .sort((a, b) => b.score - a.score || Number(b.known) - Number(a.known));
  const unique = new Map<string, SearchSuggestion>();
  for (const { score: _score, ...item } of ranked) {
    const key = searchKey(item.value);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, SUGGESTION_LIMIT);
}

export function resultSuggestions(query: string, results: SearchResult[]) {
  return mergeSuggestions(
    query,
    results.flatMap((item) => {
      const candidates =
        item.kind === "title"
          ? [
              item.librarySeries,
              item.series,
              ...(item.aliases || []),
              item.title,
            ]
          : [item.title];
      const matches = mergeSuggestions(
        query,
        candidates
          .filter((value): value is string => !!value)
          .map((value) => ({
            value,
            label: item.owned
              ? "Your library"
              : item.sources[0]?.name || "Previously found",
            known: item.known,
          })),
      );
      // Prefer the series to a particular volume when both match equally well.
      return matches.slice(0, 1);
    }),
  );
}
