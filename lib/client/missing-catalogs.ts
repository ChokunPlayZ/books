import { PUBLISHERS } from "../domain/constants.ts";
import { bookSourceApplies } from "../domain/book-sources.ts";
import type { Release } from "../types.ts";
import {
  matchingBookType,
  matchRelease,
  publisherKey,
  releaseSingleVolume,
  seriesGaps,
  type MatchBook,
} from "./matching.ts";

export type MissingCatalog = {
  series: string;
  publisherId: string;
  type: string;
  feed?: {
    items: Release[];
    checkedAt?: string;
    complete?: boolean;
    stale?: boolean;
    needsSelection?: boolean;
    error?: string;
  };
};

export function missingCatalogKey(spec: MissingCatalog) {
  return JSON.stringify([spec.series, spec.publisherId, spec.type]);
}

export function missingCatalogSpecs(books: MatchBook[]) {
  const specs = new Map<string, MissingCatalog>();
  for (const book of books) {
    const publisherId = publisherKey(book.publisher);
    if (
      !PUBLISHERS.some((publisher) => publisher.id === publisherId) ||
      !bookSourceApplies(publisherId, book)
    )
      continue;
    const spec = {
      series: book.series.trim() || "Untitled series",
      publisherId,
      type: book.type,
    };
    specs.set(missingCatalogKey(spec), spec);
  }
  return [...specs.values()];
}

// Split bounded shelf ranges around known listings without expanding large gaps.
function withoutVolumes(ranges: [number, number][], volumes: number[]) {
  const sorted = [...new Set(volumes.filter(Number.isInteger))].sort(
    (a, b) => a - b,
  );
  return ranges.flatMap(([from, to]) => {
    const remaining: [number, number][] = [];
    let next = from;
    for (const volume of sorted) {
      if (volume < next || volume > to) continue;
      if (volume > next) remaining.push([next, volume - 1]);
      next = volume + 1;
    }
    if (next <= to) remaining.push([next, to]);
    return remaining;
  });
}

export function collectionMissing<T extends MatchBook>(
  books: T[],
  catalogs: MissingCatalog[],
) {
  const series = new Map<string, T[]>();
  for (const book of books) {
    const name = book.series.trim() || "Untitled series";
    if (!series.has(name)) series.set(name, []);
    series.get(name).push(book);
  }
  return [...series]
    .map(([series, owned]) => {
      const editions = seriesGaps(owned)
        .map((edition) => {
          const volumes = new Map<
            number,
            { item: Release; alternatives: Release[] }
          >();
          const covered: number[] = [];
          const ownedVolumes = new Set<number>();
          const seen = new Set<string>();
          for (const catalog of catalogs) {
            if (
              catalog.series !== series ||
              catalog.publisherId !== publisherKey(edition.publisher) ||
              matchingBookType(catalog.type) !== edition.type
            )
              continue;
            for (const source of catalog.feed?.items || []) {
              if (
                source.publisherId !== catalog.publisherId ||
                !source.type ||
                matchingBookType(source.type) !== edition.type ||
                source.catalogVariant ||
                !releaseSingleVolume(source) ||
                Number(source.volume) < 0
              )
                continue;
              const item = { ...source, catalogSeries: series };
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              const volume = Number(item.volume);
              // Listings also cover shelf gaps when an owned ISBN lacks a volume number.
              covered.push(volume);
              const match = matchRelease(item, books);
              if (match.owned.length || match.possible.length) {
                ownedVolumes.add(volume);
                volumes.delete(volume);
                continue;
              }
              const previous = volumes.get(volume);
              if (previous && previous.item.id === item.id) continue;
              if (previous && previous.item.special && !item.special)
                volumes.set(volume, {
                  item,
                  alternatives: [previous.item, ...previous.alternatives],
                });
              else if (previous) previous.alternatives.push(item);
              else volumes.set(volume, { item, alternatives: [] });
            }
          }
          const ranges = withoutVolumes(edition.ranges, covered);
          const catalogVolumes = [...volumes.values()]
            .filter(({ item }) => !ownedVolumes.has(Number(item.volume)))
            .sort((a, b) => Number(a.item.volume) - Number(b.item.volume));
          return {
            ...edition,
            ranges,
            catalogVolumes,
            missing:
              ranges.reduce((sum, [from, to]) => sum + to - from + 1, 0) +
              catalogVolumes.length,
          };
        })
        .filter((edition) => edition.missing);
      return {
        series,
        editions,
        missing: editions.reduce((sum, edition) => sum + edition.missing, 0),
      };
    })
    .filter((group) => group.missing)
    .sort((a, b) => a.series.localeCompare(b.series));
}

export function catalogReviewCount(
  catalog: MissingCatalog,
  books: MatchBook[],
) {
  return (catalog.feed?.items || []).filter((source) => {
    const item = { ...source, catalogSeries: catalog.series };
    const match = matchRelease(item, books);
    return (
      !match.owned.length &&
      !match.possible.length &&
      (!source.type ||
        source.catalogVariant ||
        !releaseSingleVolume(source) ||
        (matchingBookType(source.type) !== matchingBookType(catalog.type) &&
          source.type.split(" (")[0] === catalog.type.split(" (")[0]))
    );
  }).length;
}
