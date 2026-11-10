import { canonicalIsbn } from "./isbn.ts";
import { bookEditionKey, normalizeBookType } from "./book-type.ts";
import { publisherKey } from "./urls.ts";
import { catalogSeriesKey } from "./title-normalization.ts";
import { coverPreference } from "./cover-preference.ts";

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
  msrp?: number | "";
  msrpCurrency?: string;
  url: string;
  coverId?: string;
  coverUrl?: string;
  coverBlurhash?: string;
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
  if (compact === target) return 1000;
  if (target.startsWith(compact)) return 800;
  if (target.includes(compact)) return 650;
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

function seriesKeys(item: SearchResult) {
  return [
    ...new Set([item.series, ...(item.aliases || [])].map(catalogSeriesKey)),
  ].filter(Boolean);
}

function compatibleEdition(a: SearchResult, b: SearchResult) {
  const language = (item: SearchResult) =>
    /\((TH|EN|JP)\)/i.exec(item.edition || item.type)?.[1].toUpperCase();
  return (
    (!a.type ||
      !b.type ||
      normalizeBookType(a.type) === normalizeBookType(b.type)) &&
    (!language(a) || !language(b) || language(a) === language(b))
  );
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
      compatibleEdition(a, b) &&
      (a.volume === "" || b.volume === "" || a.volume === b.volume) &&
      !!a.variant === !!b.variant
    );
  }
  // Never collapse different editions or a series directory into one volume.
  return (
    a.volume !== "" &&
    b.volume !== "" &&
    a.volume === b.volume &&
    (!a.publisher ||
      !b.publisher ||
      publisherKey(a.publisher) === publisherKey(b.publisher)) &&
    compatibleEdition(a, b) &&
    !!a.variant === !!b.variant &&
    seriesKeys(a).some((key) => seriesKeys(b).includes(key))
  );
}

function identityKeys(item: SearchResult) {
  const keys = [item.kind + ":id:" + item.id];
  if (item.kind !== "title") return keys;
  const isbn = canonicalIsbn(item.isbn);
  if (isbn) keys.push("isbn:" + isbn);
  if (item.url) keys.push("url:" + item.url);
  if (item.volume !== "")
    for (const series of seriesKeys(item))
      keys.push(
        "volume:" + JSON.stringify([series, item.volume, !!item.variant]),
      );
  return keys;
}

function mergeTitle(old: SearchResult, item: SearchResult): SearchResult {
  const publisherTitle = (result: SearchResult) =>
    result.sources.some(
      (source) =>
        source.id === publisherKey(result.publisher) &&
        !!source.url &&
        source.url === result.url,
    );
  const best =
    item.score > old.score ||
    (item.score === old.score && publisherTitle(item) && !publisherTitle(old))
      ? item
      : old;
  const other = best === item ? old : item;
  // A user's selected cover wins. Otherwise prefer non-Luckpim images,
  // independently of source response order and subsequent merges.
  const cover =
    [old, item].find((result) => result.owned && result.coverId) ||
    [best, other]
      .filter((result) => result.coverId || result.coverUrl)
      .sort((a, b) => coverPreference(a) - coverPreference(b))[0];
  const msrp = [best, other].find(
    (result) => result.msrp != null && result.msrp !== "",
  );
  return {
    ...other,
    ...best,
    id: old.id,
    isbn: best.isbn || other.isbn,
    series: best.series || other.series,
    publisher: best.publisher || other.publisher,
    type: best.type || other.type,
    edition: best.edition || other.edition,
    volume: best.volume === "" ? other.volume : best.volume,
    url: best.url || other.url,
    msrp: msrp?.msrp,
    msrpCurrency: msrp?.msrpCurrency,
    coverId: cover?.coverId,
    coverUrl: cover?.coverUrl,
    coverBlurhash: cover?.coverBlurhash,
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
}

export function mergeSearchResults(
  query: string,
  previous: SearchResult[],
  incoming: SearchResult[],
  limit = 100,
) {
  const results: (SearchResult | null)[] = [];
  const identities = new Map<string, Set<number>>();
  const refreshed = new Map<string, SearchResult[]>();
  for (const item of incoming) {
    if (item.kind !== "title" || item.known || !item.url || !item.publisher)
      continue;
    if (!refreshed.has(item.url)) refreshed.set(item.url, []);
    refreshed.get(item.url)!.push(item);
  }
  const remember = (index: number, keys: string[]) => {
    for (const key of keys) {
      if (!identities.has(key)) identities.set(key, new Set());
      identities.get(key)!.add(index);
    }
  };
  for (let candidate of [...previous, ...incoming]) {
    // Repair a cached storefront-as-publisher label before matching any other
    // stores, regardless of which source returned first. Never edit user data.
    const fresh =
      candidate.known && !candidate.owned
        ? refreshed
            .get(candidate.url)
            ?.find((item) => sameTitle(candidate, item))
        : undefined;
    if (fresh) candidate = { ...candidate, publisher: fresh.publisher };
    const score = searchScore(query, candidate);
    if (!score) continue;
    const item = { ...candidate, score };
    const keys = identityKeys(item);
    const possible = new Set(
      keys.flatMap((key) => [...(identities.get(key) || [])]),
    );
    const matches = [...possible].filter(
      (index) => results[index] && sameTitle(results[index]!, item),
    );
    // A listing without an ISBN/format cannot choose between conflicting
    // editions. A richer listing may, however, join earlier duplicate rows.
    const unambiguous = matches.every((a) =>
      matches.every((b) => sameTitle(results[a]!, results[b]!)),
    );
    const index = unambiguous ? matches[0] : undefined;
    if (index === undefined) {
      remember(results.length, keys);
      results.push(item);
      continue;
    }
    let merged = mergeTitle(results[index]!, item);
    for (const duplicate of matches.slice(1)) {
      merged = mergeTitle(merged, results[duplicate]!);
      remember(index, identityKeys(results[duplicate]!));
      results[duplicate] = null;
    }
    results[index] = merged;
    remember(index, [...keys, ...identityKeys(results[index])]);
  }
  return results
    .filter((item): item is SearchResult => item !== null)
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

export type SearchResultGroup = {
  id: string;
  title: string;
  items: SearchResult[];
};

// Group presentation only: never merge volumes or lose edition/source links.
export function groupSearchResults(
  results: SearchResult[],
): SearchResultGroup[] {
  const groups = new Map<string, SearchResultGroup>();
  for (const item of results) {
    const title = item.librarySeries || item.series || item.title;
    const id =
      item.kind === "title"
        ? JSON.stringify([
            catalogSeriesKey(title),
            publisherKey(item.publisher),
            bookEditionKey(item),
          ])
        : item.id;
    if (!groups.has(id)) groups.set(id, { id, title, items: [] });
    groups.get(id)!.items.push(item);
  }
  // Some stores omit the publisher/format, or omit the language suffix. Attach
  // those volumes only when there is no competing edition of the same series.
  const grouped = [...groups.values()];
  const compatible = (a: SearchResultGroup, b: SearchResultGroup) =>
    a.items.every((left) =>
      b.items.every(
        (right) =>
          left.kind === "title" &&
          right.kind === "title" &&
          catalogSeriesKey(a.title) === catalogSeriesKey(b.title) &&
          (!left.publisher ||
            !right.publisher ||
            publisherKey(left.publisher) === publisherKey(right.publisher)) &&
          compatibleEdition(left, right),
      ),
    );
  const removed = new Set<SearchResultGroup>();
  for (const group of grouped) {
    if (removed.has(group)) continue;
    const matches = grouped.filter(
      (other) =>
        other !== group &&
        !removed.has(other) &&
        compatible(group, other) &&
        grouped.every(
          (competing) =>
            removed.has(competing) ||
            !compatible(other, competing) ||
            compatible(group, competing),
        ),
    );
    if (!matches.every((a) => matches.every((b) => compatible(a, b)))) continue;
    for (const other of matches) {
      group.items.push(...other.items);
      removed.add(other);
    }
  }
  // Preserve relevance between groups, but put each series' volumes in order.
  const visible = grouped.filter((group) => !removed.has(group));
  for (const group of visible)
    group.items.sort(
      (a, b) =>
        (a.volume === "" ? Infinity : a.volume) -
        (b.volume === "" ? Infinity : b.volume),
    );
  return visible;
}
