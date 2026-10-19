import { canonicalIsbn as canonical } from "../domain/isbn.ts";
import type { Book, Release } from "../types.ts";

export type MatchBook = Pick<
  Book,
  "series" | "publisher" | "type" | "volume" | "isbn"
>;
type MatchRelease = Pick<
  Release,
  "series" | "publisherId" | "type" | "volume" | "title"
> &
  Partial<Release>;
type CatalogAlias = { publisherId: string; series: string; title: string };

export function releaseSeriesKey(title: string) {
  return String(title || "")
    .replace(/\s*\((?:light\s*novel|novel|manga|comic)\)\s*$/i, "")
    .replace(/^\[PRE-ORDER\]\s*/i, "")
    .replace(/^(?:\(LN\)|\(มังงะ\)|\(นิยาย\)|นิยาย|การ์ตูน)\s*/i, "")
    .replace(
      /^(?:(?:special|complete|ultimate|limited)(?:\s+combo)?\s+(?:set|edition)|box\s+set)\s+(?:[AB]\s+)?(?:\(Exclusive Pre-order Period\)\s*)?/i,
      "",
    )
    .replace(/\s*\((?:ฉบับพิเศษ|ปกพิเศษ)\)\s*$/i, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/@comic/gi, "")
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

export function matchingBookType(type: string) {
  return String(type || "")
    .replace(/\s*\(colou?r\)/gi, "")
    .trim();
}

export function releaseSingleVolume(item: MatchRelease) {
  if (
    item.volume === "" ||
    item.volume == null ||
    !Number.isFinite(Number(item.volume))
  )
    return false;
  if (
    item.bundle ||
    /box\s*set|ครบชุด|ยกชุด|(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*\d+(?:\.\d+)?\s*(?:[-–—~]|ถึง)\s*\d/i.test(
      item.title,
    )
  )
    return false;
  // A special listing needs a stated volume; a set's guessed first volume is not coverage.
  return (
    !item.special ||
    /(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*\d+(?:\.\d+)?/i.test(item.title)
  );
}

export function publisherKey(name: string) {
  const key = String(name || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
  if (/phoenix|ฟีนิกซ์/.test(key)) return "phoenix";
  if (/firstpage|เฟิร์สเพจ/.test(key)) return "firstpage";
  if (/luckpim|รักพิมพ์/.test(key)) return "luckpim";
  if (/yaakz|siaminter|สยามอินเตอร์|^sic$/.test(key)) return "yaakz";
  if (/^(?:yenpress|yenon|izepress|jy)$/.test(key)) return "yenpress";
  return key;
}

export function seriesGaps<T extends MatchBook>(books: T[]) {
  const editions = new Map<
    string,
    { type: string; publisher: string; books: T[] }
  >();
  books.forEach((b) => {
    const type = matchingBookType(b.type),
      key = JSON.stringify([type, publisherKey(b.publisher)]);
    if (!editions.has(key))
      editions.set(key, { type, publisher: b.publisher, books: [] });
    editions.get(key).books.push(b);
  });
  return [...editions.values()].map((edition) => {
    const volumes = [
      ...new Set<number>(
        edition.books
          .filter((b) => b.volume !== "" && b.volume !== null)
          .map((b) => Number(b.volume))
          .filter(
            (v) => Number.isFinite(v) && v >= 1 && v <= Number.MAX_SAFE_INTEGER,
          ),
      ),
    ].sort((a, b) => a - b);
    const highest = volumes.length
        ? Math.floor(volumes[volumes.length - 1])
        : 0,
      ranges: [number, number][] = [];
    let next = 1;
    volumes.filter(Number.isInteger).forEach((v) => {
      if (v > next) ranges.push([next, v - 1]);
      next = v + 1;
    });
    if (next <= highest) ranges.push([next, highest]);
    return {
      ...edition,
      highest,
      ranges,
      missing: ranges.reduce((sum, [from, to]) => sum + to - from + 1, 0),
    };
  });
}

export function collectionGaps<T extends MatchBook>(books: T[]) {
  const series = new Map<string, T[]>();
  for (const book of books) {
    const title = book.series.trim() || "Untitled series";
    if (!series.has(title)) series.set(title, []);
    series.get(title).push(book);
  }
  return [...series]
    .map(([series, owned]) => {
      const editions = seriesGaps(owned).filter((edition) => edition.missing);
      return {
        series,
        editions,
        missing: editions.reduce((sum, edition) => sum + edition.missing, 0),
      };
    })
    .filter((group) => group.missing)
    .sort((a, b) => a.series.localeCompare(b.series));
}

export function missingSummary(groups: { missing: number }[]) {
  const count = groups.reduce((sum, group) => sum + group.missing, 0);
  const format = new Intl.NumberFormat("en");
  return (
    format.format(count) +
    (count === 1 ? " missing volume across " : " missing volumes across ") +
    format.format(groups.length) +
    " series"
  );
}

export function matchRelease<T extends MatchBook>(
  item: MatchRelease,
  books: T[],
) {
  const isbn = canonical(item.isbn);
  const owned = isbn ? books.filter((b) => canonical(b.isbn) === isbn) : [];
  const series = books.filter(
    (b) =>
      releaseSeriesKey(b.series) ===
        releaseSeriesKey(item.catalogSeries || item.series) &&
      publisherKey(b.publisher) === item.publisherId &&
      (!item.type || matchingBookType(b.type) === matchingBookType(item.type)),
  );
  const possible =
    releaseSingleVolume(item) &&
    (!item.catalogVariant ||
      releaseSeriesKey(item.series) === releaseSeriesKey(item.catalogSeries))
      ? series.filter(
          (b) =>
            b.volume !== "" &&
            b.volume !== null &&
            Number(b.volume) === Number(item.volume),
        )
      : [];
  return { owned, series, possible };
}

export function discoverTitles<T extends Release>(
  items: T[],
  owned: MatchBook[],
  aliases: CatalogAlias[] = [],
) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key =
      item.publisherId +
      ":" +
      releaseSeriesKey(item.series) +
      (item.publisherId === "yenpress"
        ? ":" + matchingBookType(item.type)
        : "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const rank = (item) =>
    item.bundle
      ? 5
      : Number(item.volume) === 1
        ? item.special
          ? 1
          : 0
        : item.special
          ? 4
          : 2;
  return [...groups.values()]
    .filter(
      (list) =>
        !owned.some((book) =>
          list.some(
            (item) =>
              (canonical(item.isbn) &&
                canonical(item.isbn) === canonical(book.isbn)) ||
              (publisherKey(book.publisher) === item.publisherId &&
                (releaseSeriesKey(book.series) ===
                  releaseSeriesKey(item.series) ||
                  aliases.some(
                    (alias) =>
                      alias.publisherId === item.publisherId &&
                      releaseSeriesKey(alias.series) ===
                        releaseSeriesKey(book.series) &&
                      releaseSeriesKey(alias.title) ===
                        releaseSeriesKey(item.series),
                  ))),
          ),
        ),
    )
    .map((list) => {
      list.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.volume === "" ? Infinity : Number(a.volume)) -
            (b.volume === "" ? Infinity : Number(b.volume)) ||
          Number(/\[แถม|\[ฟรี/.test(a.title)) -
            Number(/\[แถม|\[ฟรี/.test(b.title)) ||
          a.title.localeCompare(b.title),
      );
      const first = list[0];
      return {
        ...first,
        coverId:
          first.coverId ||
          list.find((item) => item.volume === first.volume && item.coverId)
            ?.coverId ||
          "",
      };
    })
    .sort((a, b) => a.series.localeCompare(b.series));
}
