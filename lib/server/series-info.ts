import { randomUUID } from "node:crypto";
import { AppError, type Store } from "./store.ts";
import { canonicalIsbn } from "../domain/isbn.ts";
import { normalizeBookType } from "../domain/book-type.ts";
import {
  mergeSeriesMetadata,
  seriesAliasesMatch,
  textLanguage,
  type SeriesProfile,
  type SeriesInfo,
} from "../domain/series-info.ts";
import type { createCatalogService } from "./catalogs.ts";
import type { createAnimeService } from "./anime.ts";

type ProfileRow = { series: string; type: string; data: string };
type Request = {
  series: string;
  type: string;
  search?: string;
  mediaId?: number;
  sourceUrl?: string;
};

export function createSeriesInfoService(
  store: Store,
  catalogs: Pick<ReturnType<typeof createCatalogService>, "lookupIsbn"> &
    Partial<
      Pick<
        ReturnType<typeof createCatalogService>,
        "getBookSourceMetadata" | "getSeriesSourceMetadata"
      >
    >,
  anime: Pick<ReturnType<typeof createAnimeService>, "getAnimeAdaptations">,
) {
  async function profiles() {
    const rows = await store.db
      .prepare(
        "SELECT series,type,data FROM series_profiles WHERE user_id=app_user_id() ORDER BY series,type",
      )
      .all();
    return (rows as unknown as ProfileRow[]).map((row) => ({
      series: row.series,
      type: row.type,
      profile: JSON.parse(row.data) as SeriesProfile,
    }));
  }
  async function save(series: string, type: string, profile: SeriesProfile) {
    await store.db
      .prepare(
        "INSERT INTO series_profiles(user_id,series,type,data) VALUES(app_user_id(),?,?,?) ON CONFLICT(user_id,series,type) DO UPDATE SET data=excluded.data",
      )
      .run(series, type, JSON.stringify(profile));
  }
  async function validate(arg: Request) {
    if (
      !arg ||
      typeof arg !== "object" ||
      Array.isArray(arg) ||
      typeof arg.series !== "string" ||
      !arg.series.trim() ||
      arg.series.length > 500 ||
      !["Manga", "Light novel", "Others"].includes(arg.type)
    )
      throw new AppError("Choose a series and book type.");
    const books = (await store.api.getCollection()).books;
    if (
      !books.some(
        (book) =>
          book.series === arg.series &&
          normalizeBookType(book.type) === arg.type,
      )
    )
      throw new AppError("This series is not in your library.", 404);
    return books;
  }
  function empty(): SeriesProfile {
    return { workId: "", titles: [], synopses: [] };
  }
  async function getSeriesInfo(arg: Request): Promise<SeriesInfo> {
    const books = await validate(arg);
    const rows = await profiles();
    const own =
      rows.find((row) => row.series === arg.series && row.type === arg.type)
        ?.profile || empty();
    const linked = rows.filter(
      (row) =>
        row.type === arg.type &&
        own.workId &&
        row.profile.workId === own.workId,
    );
    const members = [{ series: arg.series, type: arg.type }, ...linked];
    const editions = new Map<string, SeriesInfo["editions"][number]>();
    for (const book of books) {
      if (
        !members.some(
          (member) =>
            member.series === book.series &&
            member.type === normalizeBookType(book.type),
        )
      )
        continue;
      const language = /\((TH|EN|JP)\)/i
        .exec(book.edition || "")?.[1]
        ?.toUpperCase();
      const lang =
        { TH: "th", EN: "en", JP: "ja" }[language || ""] ||
        textLanguage(book.series);
      const key = JSON.stringify([book.series, lang, arg.type]);
      const edition = editions.get(key) || {
        series: book.series,
        type: arg.type,
        language: lang,
        count: 0,
      };
      edition.count++;
      editions.set(key, edition);
    }
    return {
      ...own,
      ...mergeSeriesMetadata(own, ...linked.map((row) => row.profile)),
      series: arg.series,
      type: arg.type,
      editions: [...editions.values()],
      candidates: [],
      warnings: [],
    };
  }
  async function pullSeriesInfo(arg: Request): Promise<SeriesInfo> {
    const books = await validate(arg);
    if (
      arg.search !== undefined &&
      (typeof arg.search !== "string" ||
        arg.search.trim().length < 2 ||
        arg.search.length > 200)
    )
      throw new AppError("Enter a title between 2 and 200 characters.");
    if (
      arg.mediaId !== undefined &&
      (!Number.isSafeInteger(arg.mediaId) || arg.mediaId <= 0)
    )
      throw new AppError("Choose a title from the search results.");
    const before = await getSeriesInfo(arg);
    const warnings: string[] = [];
    const records: Partial<SeriesProfile>[] = [];
    if (arg.sourceUrl !== undefined && arg.sourceUrl !== "") {
      if (
        typeof arg.sourceUrl !== "string" ||
        arg.sourceUrl.length > 2000 ||
        !catalogs.getSeriesSourceMetadata
      )
        throw new AppError("Choose a supported series source URL.");
      records.push(
        await catalogs.getSeriesSourceMetadata({ url: arg.sourceUrl }),
      );
    }
    // Read one representative volume per edition. Volume descriptions retain their
    // source and edition title; they are not presented as translations of each other.
    const seen = new Set<string>();
    const representatives = [...books]
      .sort((a, b) => Number(a.volume || 0) - Number(b.volume || 0))
      .filter((book) => {
        if (
          !before.editions.some(
            (edition) =>
              edition.series === book.series &&
              normalizeBookType(book.type) === arg.type,
          )
        )
          return false;
        const key = JSON.stringify([book.series, book.publisher, book.edition]);
        if (seen.has(key) || (!canonicalIsbn(book.isbn) && !book.publisherUrl))
          return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
    await Promise.all(
      representatives.map(async (book) => {
        try {
          const result = canonicalIsbn(book.isbn)
            ? await catalogs.lookupIsbn(book.isbn)
            : null;
          if (
            result?.found &&
            (!result.details?.isbn ||
              canonicalIsbn(result.details.isbn) === canonicalIsbn(book.isbn))
          )
            records.push(result.details);
          warnings.push(...(result?.warnings || []));
        } catch {
          warnings.push(
            "Some publisher metadata could not be loaded. Saved descriptions were kept.",
          );
        }
        // A failed ISBN provider must not prevent reading the saved source page.
        try {
          if (book.publisherUrl && catalogs.getBookSourceMetadata)
            records.push(
              await catalogs.getBookSourceMetadata({ row: book.row }),
            );
        } catch {
          warnings.push(
            "Some publisher metadata could not be loaded. Saved descriptions were kept.",
          );
        }
      }),
    );
    const metadata = mergeSeriesMetadata(before, ...records);
    const aliases = [
      arg.series,
      ...metadata.titles.map((title) => title.title),
    ];
    const searches = arg.search
      ? [arg.search.trim()]
      : [
          ...new Set([
            ...metadata.titles
              .filter((title) =>
                ["ja-Latn", "ja", "en"].includes(title.language),
              )
              .map((title) => title.title),
            arg.series,
          ]),
        ]
          .filter((name) => name.length >= 2 && name.length <= 200)
          .slice(0, 3);
    const candidates = new Map<
      number,
      Awaited<
        ReturnType<typeof anime.getAnimeAdaptations>
      >["items"][number]["book"]
    >();
    if (arg.type !== "Others") {
      for (const search of searches) {
        try {
          const result = await anime.getAnimeAdaptations({
            search,
            type: arg.type === "Light novel" ? "LN" : "Manga",
          });
          if ("warning" in result && typeof result.warning === "string")
            warnings.push(result.warning);
          for (const item of result.items)
            candidates.set(item.book.id, item.book);
        } catch (error) {
          warnings.push(
            error instanceof Error
              ? error.message
              : "AniList is unavailable. Please try again later.",
          );
          break;
        }
      }
    }
    const exact = [...candidates.values()].filter((book) =>
      book.titles.some((title) =>
        aliases.some((alias) => seriesAliasesMatch([alias], title)),
      ),
    );
    let selected = arg.mediaId
      ? candidates.get(arg.mediaId)
      : exact.length === 1
        ? exact[0]
        : undefined;
    if (arg.mediaId && !selected)
      throw new AppError("Choose a title from the search results.");
    if (
      !arg.mediaId &&
      before.manual &&
      before.workId !== `anilist:${selected?.id}`
    )
      selected = undefined;
    await store.transaction(async () => {
      // Re-read after network I/O. Concurrent edition links are never lost.
      const currentBooks = await validate(arg);
      const rows = await profiles();
      const current =
        rows.find((row) => row.series === arg.series && row.type === arg.type)
          ?.profile || empty();
      const workId = selected
        ? `anilist:${selected.id}`
        : current.workId || "local:" + randomUUID();
      const next = {
        workId,
        manual: arg.mediaId ? true : current.manual,
        ...mergeSeriesMetadata(
          current,
          metadata,
          selected
            ? {
                titles: selected.translatedTitles,
                synopses: selected.synopses,
                facts: selected.facts,
                tags: selected.tags,
                links: selected.links,
              }
            : {},
        ),
      };
      // Changing a match drops the old work's descriptions rather than carrying
      // an unrelated AniList synopsis into the newly chosen identity.
      if (
        selected &&
        current.workId.startsWith("anilist:") &&
        current.workId !== workId
      ) {
        Object.assign(
          next,
          mergeSeriesMetadata(...records, {
            titles: selected.translatedTitles,
            synopses: selected.synopses,
            facts: selected.facts,
            tags: selected.tags,
            links: selected.links,
          }),
        );
      }
      if (!arg.mediaId && current.manual && current.workId !== workId) return;
      await save(arg.series, arg.type, next);
      if (!selected) return;
      const matching = new Set(selected.titles);
      for (const book of currentBooks) {
        if (
          normalizeBookType(book.type) !== arg.type ||
          book.series === arg.series
        )
          continue;
        const previous = rows.find(
          (row) => row.series === book.series && row.type === arg.type,
        )?.profile;
        if (
          previous?.manual ||
          (previous?.workId.startsWith("anilist:") &&
            previous.workId !== workId)
        )
          continue;
        const isbn = canonicalIsbn(book.isbn);
        let snapshot;
        try {
          snapshot = isbn
            ? JSON.parse(
                (await store.cache.get("book-metadata:v1:" + isbn)) || "null",
              )
            : null;
        } catch {}
        if (
          ![
            book.series,
            ...(snapshot?.titles || []).map((title) => title.title),
          ].some((name) => seriesAliasesMatch([...matching], name))
        )
          continue;
        await save(book.series, arg.type, {
          workId,
          ...mergeSeriesMetadata(previous || {}, snapshot || {}),
        });
      }
    });
    return {
      ...(await getSeriesInfo(arg)),
      candidates: selected
        ? []
        : [...candidates.values()].map((book) => ({
            id: book.id,
            title: book.title,
            titles: book.titles,
            url: book.url,
          })),
      warnings: [...new Set(warnings)],
    };
  }
  async function linkSeriesInfo(arg: Request & { targetSeries: string }) {
    await validate(arg);
    await validate({ series: arg.targetSeries, type: arg.type });
    await store.transaction(async () => {
      const source = await getSeriesInfo(arg);
      const target = await getSeriesInfo({
        series: arg.targetSeries,
        type: arg.type,
      });
      const workId = target.workId || source.workId || "local:" + randomUUID();
      const metadata = mergeSeriesMetadata(source, target);
      const rows = await profiles();
      for (const row of rows) {
        if (
          row.type === arg.type &&
          ((source.workId && row.profile.workId === source.workId) ||
            (target.workId && row.profile.workId === target.workId))
        )
          await save(row.series, row.type, {
            ...row.profile,
            workId,
            manual: true,
            ...metadata,
          });
      }
      await save(arg.series, arg.type, { workId, manual: true, ...metadata });
      await save(arg.targetSeries, arg.type, {
        workId,
        manual: true,
        ...metadata,
      });
    });
    return getSeriesInfo(arg);
  }
  async function unlinkSeriesInfo(arg: Request) {
    await validate(arg);
    await store.transaction(async () => {
      await save(arg.series, arg.type, {
        ...empty(),
        workId: "local:" + randomUUID(),
        manual: true,
      });
    });
    return getSeriesInfo(arg);
  }
  return { getSeriesInfo, pullSeriesInfo, linkSeriesInfo, unlinkSeriesInfo };
}
