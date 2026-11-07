import { canonicalIsbn } from "./isbn.ts";
import { bookEditionKey } from "./book-type.ts";
import { publisherKey } from "./urls.ts";

export type SearchLanguage = "th" | "en" | "ja";
export type SearchSource = { id: string; name: string };
export type SearchResult = {
  id: string;
  kind: "title" | "publisher" | "store";
  title: string;
  series: string;
  publisher: string;
  type: string;
  edition?: string;
  aliases?: string[];
  volume: number | "";
  isbn: string;
  url: string;
  variant?: boolean;
  librarySeries?: string;
  known: boolean;
  owned: boolean;
  sources: (SearchSource & { url: string })[];
  score: number;
};
export type KnownSearch = {
  query: string;
  results: SearchResult[];
  sources: SearchSource[];
};
export type ExternalSearch = {
  source: SearchSource;
  results: SearchResult[];
  status: "complete" | "partial" | "unavailable";
};

// Preserve Thai vowel/tone marks. Removing combining marks changes the title.
export function searchKey(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function searchLanguage(query: string): SearchLanguage {
  if (/\p{Script=Thai}/u.test(query)) return "th";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(query))
    return "ja";
  return "en";
}

function textScore(query: string, value: string) {
  const key = searchKey(value);
  if (!key) return 0;
  if (key === query) return 1000;
  if (key.startsWith(query)) return 800;
  if (key.includes(query)) return 650;
  const tokens = query.split(" ");
  if (tokens.length > 1 && tokens.every((token) => key.includes(token)))
    return 500;
  // A small typo can still find related titles, but never outranks an exact match.
  const compact = query.replaceAll(" ", "");
  const target = key.replaceAll(" ", "");
  if (compact.length < 4) return 0;
  const grams = new Set(
    Array.from({ length: compact.length - 1 }, (_, i) =>
      compact.slice(i, i + 2),
    ),
  );
  const matched = [...grams].filter((gram) => target.includes(gram)).length;
  const overlap = matched / Math.max(grams.size, target.length - 1);
  return overlap >= 0.6 ? Math.round(250 * overlap) : 0;
}

export function searchScore(query: string, result: SearchResult) {
  const isbn = canonicalIsbn(query);
  if (isbn) return canonicalIsbn(result.isbn) === isbn ? 1200 : 0;
  const key = searchKey(query);
  if (!key) return 0;
  const title = Math.max(
    textScore(key, result.title),
    textScore(key, result.series),
    ...(result.aliases || []).map((alias) => textScore(key, alias)),
  );
  return Math.max(title, Math.min(350, textScore(key, result.publisher)));
}

function sameTitle(a: SearchResult, b: SearchResult) {
  if (a.kind !== b.kind) return false;
  if (a.kind !== "title") return a.id === b.id;
  const ai = canonicalIsbn(a.isbn),
    bi = canonicalIsbn(b.isbn);
  if (ai && bi) return ai === bi;
  if (
    a.id === b.id &&
    a.title === b.title &&
    a.volume === b.volume &&
    a.publisher === b.publisher &&
    a.type === b.type &&
    a.edition === b.edition &&
    !!a.variant === !!b.variant
  )
    return true;
  if (a.url && a.url === b.url) {
    return (
      (!a.type || !b.type || bookEditionKey(a) === bookEditionKey(b)) &&
      (a.volume === "" || b.volume === "" || a.volume === b.volume) &&
      !!a.variant === !!b.variant
    );
  }
  // Never collapse different editions or a series directory into one volume.
  return (
    a.volume !== "" &&
    b.volume !== "" &&
    a.volume === b.volume &&
    !!a.publisher &&
    !!b.publisher &&
    publisherKey(a.publisher) === publisherKey(b.publisher) &&
    !!a.type &&
    !!b.type &&
    bookEditionKey(a) === bookEditionKey(b) &&
    !!a.variant === !!b.variant &&
    searchKey(a.series) === searchKey(b.series)
  );
}

function identityKeys(item: SearchResult) {
  const keys = [item.kind + ":id:" + item.id];
  if (item.kind !== "title") return keys;
  const isbn = canonicalIsbn(item.isbn);
  if (isbn) keys.push("isbn:" + isbn);
  if (item.url) keys.push("url:" + item.url);
  if (item.volume !== "" && item.publisher && item.type && item.series)
    keys.push(
      "edition:" +
        JSON.stringify([
          searchKey(item.series),
          publisherKey(item.publisher),
          bookEditionKey(item),
          item.volume,
          !!item.variant,
        ]),
    );
  return keys;
}

export function mergeSearchResults(
  query: string,
  previous: SearchResult[],
  incoming: SearchResult[],
  limit = 100,
) {
  const results: SearchResult[] = [];
  const identities = new Map<string, Set<number>>();
  const remember = (index: number, keys: string[]) => {
    for (const key of keys) {
      if (!identities.has(key)) identities.set(key, new Set());
      identities.get(key)!.add(index);
    }
  };
  for (const candidate of [...previous, ...incoming]) {
    const score = searchScore(query, candidate);
    if (!score) continue;
    const item = { ...candidate, score };
    const keys = identityKeys(item);
    const possible = new Set(
      keys.flatMap((key) => [...(identities.get(key) || [])]),
    );
    const index = [...possible].find((index) =>
      sameTitle(results[index], item),
    );
    if (index === undefined) {
      remember(results.length, keys);
      results.push(item);
      continue;
    }
    const old = results[index];
    const best = item.score > old.score ? item : old;
    const other = best === item ? old : item;
    results[index] = {
      ...other,
      ...best,
      id: old.id,
      isbn: best.isbn || other.isbn,
      publisher: best.publisher || other.publisher,
      type: best.type || other.type,
      edition: best.edition || other.edition,
      volume: best.volume === "" ? other.volume : best.volume,
      url: best.url || other.url,
      aliases: [...new Set([...(old.aliases || []), ...(item.aliases || [])])],
      librarySeries: old.librarySeries || item.librarySeries,
      known: old.known || item.known,
      owned: old.owned || item.owned,
      sources: [
        ...new Map(
          [...old.sources, ...item.sources].map((source) => [
            source.id + ":" + source.url,
            source,
          ]),
        ).values(),
      ],
    };
    remember(index, [...keys, ...identityKeys(results[index])]);
  }
  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.owned) - Number(a.owned) ||
        Number(b.known) - Number(a.known) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
