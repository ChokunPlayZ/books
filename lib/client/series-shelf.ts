import type { Release, StoredBook } from "../types.ts";
import type { KnownVolume } from "../server/series-details.ts";
import { bookEditionKey, normalizeBookType } from "../domain/book-type.ts";
import { editionLanguage } from "../domain/series-detail.ts";
import { isRevisedEditionOf } from "../domain/title-normalization.ts";
import {
  matchRelease,
  publisherKey,
  releaseSingleVolume,
  seriesGaps,
} from "./matching.ts";

export type MissingShelfVolume = {
  key: string;
  book: Pick<
    StoredBook,
    "series" | "type" | "publisher" | "edition" | "volume" | "isbn"
  > &
    Partial<StoredBook>;
  catalog?: Release;
  detailKey?: string;
  rangeEnd?: number;
};

// One slot per edition/volume; alternate listings never duplicate an owned copy.
export function missingShelfVolumes(
  owned: StoredBook[],
  known: KnownVolume[],
  listings: Release[],
): MissingShelfVolume[] {
  if (!owned.length) return [];
  const series = owned[0].series;
  const identity = (book: {
    type?: string;
    edition?: string;
    publisher?: string;
    volume?: number | "";
  }) =>
    JSON.stringify([
      bookEditionKey(book),
      publisherKey(book.publisher || ""),
      book.volume,
    ]);
  const missing = new Map<string, MissingShelfVolume>();
  const candidates = [
    ...listings.map((item) => ({
      item,
      detailKey: undefined as string | undefined,
    })),
    ...known
      .filter((item) => !item.owned)
      .flatMap((volume) => {
        const edition = owned.find(
          (book) =>
            normalizeBookType(book.type) === volume.type &&
            publisherKey(book.publisher) ===
              publisherKey(volume.publisher || "") &&
            (volume.edition
              ? bookEditionKey(book) === bookEditionKey(volume)
              : editionLanguage(book) === volume.language),
        );
        if (!edition) return [];
        const item: Release = {
          ...volume,
          id: volume.key,
          publisherId: publisherKey(volume.publisher || ""),
          publisher: volume.publisher || "",
          isbn: volume.isbn || "",
          url: volume.url || volume.publisherUrl || "",
          volume: volume.volume ?? "",
          price: volume.listedPrice ?? "",
          special: false,
          bundle: false,
          availability: volume.availability || "",
          edition: volume.edition || edition.edition || "",
          catalogSeries: series,
        };
        return [{ item, detailKey: volume.key }];
      }),
  ];
  for (const { item, detailKey } of candidates) {
    if (
      !releaseSingleVolume(item) ||
      item.catalogVariant ||
      isRevisedEditionOf(item.series, series) ||
      isRevisedEditionOf(item.title, series)
    )
      continue;
    const match = matchRelease(item, owned);
    if (match.owned.length || match.possible.length || !match.series.length)
      continue;
    const book = {
      ...item,
      series,
      publisher: item.publisher || match.series[0].publisher,
      edition: item.edition || "",
      // Publisher prices and sources are not this user's purchase records.
      price: "" as const,
      source: "",
      date: "",
      note: "",
      status: "",
    };
    const key = identity(book);
    const previous = missing.get(key);
    missing.set(key, {
      key,
      book: { ...book, coverId: previous?.book.coverId || book.coverId },
      catalog: previous?.catalog || item,
      detailKey: previous?.detailKey || detailKey,
    });
  }
  for (const edition of seriesGaps(owned)) {
    const template = edition.books[0];
    const addRange = (from: number, to: number) => {
      const book = {
        series,
        type: template.type,
        publisher: template.publisher,
        edition: bookEditionKey(template),
        volume: from,
        isbn: "",
      };
      const key = identity(book);
      missing.set(key, { key, book, ...(to > from ? { rangeEnd: to } : {}) });
    };
    for (const [from, to] of edition.ranges) {
      // Split inferred gaps around catalog covers and bound enormous imported sequences.
      const catalogNumbers = [...missing.values()]
        .filter(
          ({ book }) =>
            bookEditionKey(book) === bookEditionKey(template) &&
            publisherKey(book.publisher) === publisherKey(template.publisher),
        )
        .map(({ book }) => Number(book.volume))
        .filter(
          (volume) =>
            Number.isInteger(volume) && volume >= from && volume <= to,
        )
        .sort((a, b) => a - b);
      let next = from;
      for (const end of [...catalogNumbers, to + 1]) {
        if (end - next > 100) addRange(next, end - 1);
        else
          for (let volume = next; volume < end; volume++)
            addRange(volume, volume);
        next = end + 1;
      }
    }
  }
  return [...missing.values()].sort(
    (a, b) =>
      Number(a.book.volume) - Number(b.book.volume) ||
      a.key.localeCompare(b.key),
  );
}
