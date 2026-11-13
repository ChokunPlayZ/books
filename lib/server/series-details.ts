import { digest } from "../domain/hash.ts";
import { canonicalIsbn } from "../domain/isbn.ts";
import { normalizeBookType } from "../domain/book-type.ts";
import { bookSourceApplies } from "../domain/book-sources.ts";
import { PUBLISHERS } from "../domain/constants.ts";
import { publisherKey } from "../domain/urls.ts";
import {
  seriesAliasesMatch,
  mergeSeriesMetadata,
  publicSourceUrl,
  type SeriesProfile,
} from "../domain/series-info.ts";
import { editionLanguage } from "../domain/series-detail.ts";
import type { Release, StoredBook } from "../types.ts";
import type { Store } from "./store.ts";
import { AppError } from "./store.ts";

export type KnownVolume = Partial<StoredBook> &
  Partial<SeriesProfile> & {
    key: string;
    series: string;
    title: string;
    type: string;
    owned: boolean;
    language: string;
    url?: string;
    availability?: string;
    releaseDate?: string;
    listedPrice?: number | "";
    currency?: string;
    checkedAt?: string;
  };

type LoadSeriesCatalog = (request: {
  series: string;
  type: string;
  publisherId: string;
}) => Promise<{ items: Release[] }>;

export function createSeriesDetailsService(
  store: Store,
  loadCatalog?: LoadSeriesCatalog,
) {
  async function getSeriesVolumes(arg: { series: string; type: string }) {
    if (
      typeof arg?.series !== "string" ||
      !arg.series.trim() ||
      arg.series.length > 500 ||
      !["Manga", "Light novel", "Others"].includes(arg.type)
    )
      throw new AppError("Choose a series and book type.");
    const data = await store.api.getCollection();
    const owned = data.books.filter(
      (book) =>
        book.series === arg.series && normalizeBookType(book.type) === arg.type,
    );
    if (!owned.length)
      throw new AppError("This series is not in your library.", 404);
    // A first visit must discover volumes too, rather than depending on a prior
    // release/catalog page to have warmed the cache. The loader owns its TTL.
    const publisherIds = new Set(
      owned
        .filter((book) => bookSourceApplies(publisherKey(book.publisher), book))
        .map((book) => publisherKey(book.publisher))
        .filter((id) => PUBLISHERS.some((publisher) => publisher.id === id)),
    );
    const catalogs = loadCatalog
      ? await Promise.all(
          [...publisherIds].map(async (publisherId) => {
            try {
              return await loadCatalog({ ...arg, publisherId });
            } catch {
              // Keep owned volumes and known metadata usable during an outage.
              return { items: [] };
            }
          }),
        )
      : [];
    const profileRow = await store.db
      .prepare(
        "SELECT data FROM series_profiles WHERE user_id=app_user_id() AND series=? AND type=?",
      )
      .get(arg.series, arg.type);
    const profile: SeriesProfile = profileRow
      ? JSON.parse(String(profileRow.data))
      : { workId: "", titles: [], synopses: [] };
    const aliases = [arg.series, ...profile.titles.map((item) => item.title)];
    const snapshots: any[] = [];
    for (const row of await store.cache.searchable()) {
      try {
        const value = JSON.parse(row.value);
        snapshots.push(
          ...(Array.isArray(value.items) ? value.items : []),
          ...(value.found && value.details
            ? [{ ...value.details, isbn: value.isbn }]
            : []),
          ...(value.isbnVerified && value.title ? [value] : []),
        );
      } catch {
        /* Bad cache entries cannot hide owned books. */
      }
    }
    snapshots.push(...data.savedReleases);
    snapshots.push(...catalogs.flatMap((catalog) => catalog.items));
    const items: KnownVolume[] = owned.map((book) => {
      const isbn = canonicalIsbn(book.isbn);
      const records = snapshots.filter(
        (item) => isbn && canonicalIsbn(item.isbn) === isbn,
      );
      const metadata = Object.assign({}, ...records);
      for (const field of ["pageCount", "msrp", "msrpCurrency"] as const)
        if (book[field] !== "" && book[field] != null)
          metadata[field] = book[field];
      return {
        ...metadata,
        ...book,
        pageCount: metadata.pageCount || book.pageCount,
        msrp: metadata.msrp ?? book.msrp,
        msrpCurrency: metadata.msrpCurrency || book.msrpCurrency,
        ...mergeSeriesMetadata(...records),
        availability:
          metadata.availability ||
          mergeSeriesMetadata(...records).facts?.find((fact) =>
            /^(StockStatus|Availability|สถานะสินค้า)$/i.test(fact.label),
          )?.value ||
          "",
        key: "owned-" + book.row,
        title: metadata.title || book.series,
        listedPrice: records.find(
          (item) => item.price !== "" && item.price != null,
        )?.price,
        owned: true,
        language: editionLanguage(book),
      };
    });
    const catalog = new Map<string, KnownVolume>();
    for (const item of snapshots) {
      const url = publicSourceUrl(item.url || item.publisherUrl);
      if (
        !url ||
        item.bundle ||
        item.special ||
        item.catalogVariant ||
        item.volume === "" ||
        item.volume == null ||
        !Number.isFinite(Number(item.volume))
      )
        continue;
      if (
        normalizeBookType(item.type) !== arg.type ||
        !seriesAliasesMatch(
          aliases,
          item.catalogSeries || item.series || item.title || "",
        )
      )
        continue;
      const isbn = canonicalIsbn(item.isbn);
      if (
        items.some((book) =>
          isbn ? canonicalIsbn(book.isbn) === isbn : book.publisherUrl === url,
        )
      )
        continue;
      const identity = isbn || url;
      const previous = catalog.get(identity);
      catalog.set(identity, {
        ...previous,
        ...item,
        ...mergeSeriesMetadata(previous || {}, item),
        key: "catalog-" + digest(identity),
        series: arg.series,
        title: item.title || arg.series,
        type: arg.type,
        owned: false,
        listedPrice: item.price,
        availability:
          item.availability ||
          mergeSeriesMetadata(previous || {}, item).facts?.find((fact) =>
            /^(StockStatus|Availability|สถานะสินค้า)$/i.test(fact.label),
          )?.value ||
          "",
        url,
        language: editionLanguage({
          series: item.series || arg.series,
          edition: item.edition,
        }),
      });
    }
    return {
      items: [...items, ...catalog.values()].sort(
        (a, b) =>
          Number(a.volume ?? Infinity) - Number(b.volume ?? Infinity) ||
          a.key.localeCompare(b.key),
      ),
    };
  }

  async function getMetadataBrowse(arg: { field: string; value: string }) {
    if (
      typeof arg?.field !== "string" ||
      !arg.field ||
      arg.field.length > 100 ||
      typeof arg.value !== "string" ||
      !arg.value ||
      arg.value.length > 2000
    )
      throw new AppError("Choose a metadata value to browse.");
    const data = await store.api.getCollection();
    const rows = await store.db
      .prepare(
        "SELECT series,type,data FROM series_profiles WHERE user_id=app_user_id()",
      )
      .all();
    const key = (value: string) =>
      value.normalize("NFKC").trim().toLocaleLowerCase();
    const wanted = key(arg.value);
    const creator = (field: string) =>
      /author|artist|story|art\b|creator|illustrat|translat|character design/i.test(
        field,
      );
    const matches = (profile: Partial<SeriesProfile>) =>
      profile.facts?.some(
        (fact) =>
          (key(fact.label) === key(arg.field) ||
            (creator(arg.field) && creator(fact.label))) &&
          key(fact.value) === wanted,
      ) ||
      (["Tag", "Genre", "Theme", "Spoiler tag"].includes(arg.field) &&
        profile.tags?.some((tag) => key(tag.name) === wanted));
    const matching = new Set<string>();
    for (const row of rows) {
      const profile: SeriesProfile = JSON.parse(String(row.data));
      if (matches(profile)) matching.add(String(row.series));
    }
    const books = data.books.filter(
      (book) =>
        matching.has(book.series) ||
        (arg.field === "Publisher" && key(book.publisher) === wanted) ||
        (arg.field === "Format" &&
          key(normalizeBookType(book.type)) === wanted),
    );
    const known = new Map<
      string,
      { title: string; publisher: string; type: string; url: string }
    >();
    for (const row of await store.cache.searchable()) {
      try {
        const value = JSON.parse(row.value);
        const records = [
          ...(Array.isArray(value.items) ? value.items : []),
          ...(value.found && value.details ? [value.details] : []),
          ...(value.isbnVerified && value.title ? [value] : []),
        ];
        for (const record of records) {
          if (
            !matches(record) &&
            !(
              arg.field === "Publisher" &&
              key(record.publisher || "") === wanted
            ) &&
            !(creator(arg.field) && key(record.authors || "") === wanted)
          )
            continue;
          const title = record.series || record.title;
          const url = publicSourceUrl(record.url);
          if (
            typeof title !== "string" ||
            !title ||
            !url ||
            books.some((book) => book.series === title)
          )
            continue;
          known.set(title + ":" + record.publisher, {
            title,
            publisher: record.publisher || "",
            type: record.type || "",
            url,
          });
        }
      } catch {
        /* Ignore disposable malformed cache data. */
      }
    }
    return {
      field: arg.field,
      value: arg.value,
      books,
      known: [...known.values()],
    };
  }
  return { getSeriesVolumes, getMetadataBrowse };
}
