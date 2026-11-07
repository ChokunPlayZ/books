import { createCatalogService, knownBookCoverUrl } from "./catalogs.ts";
import { canonicalIsbn, volumeCoverKey } from "../domain.ts";
import { createAnimeService } from "./anime.ts";
import { createSeasonalDiscoveryService } from "./seasonal-discovery.ts";
import { createMetadataService } from "./metadata.ts";
import { AppError } from "./store.ts";
import { createSearchService } from "./search.ts";

async function eachLimit(items, action, limit = 4) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, limit) }, async () => {
      while (cursor < items.length) await action(items[cursor++]);
    }),
  );
}

// All client-facing book data carries stored IDs. Cover discovery belongs here.
export function createApplicationApi(
  store,
  covers,
  fetchImpl = globalThis.fetch,
) {
  const catalogs = createCatalogService(store, fetchImpl);
  const anime = createAnimeService(store, fetchImpl);
  async function attachImages(result) {
    const records = [];
    function visit(value) {
      if (!value || typeof value !== "object") return;
      if (Object.hasOwn(value, "coverUrl")) records.push(value);
      for (const child of Object.values(value)) visit(child);
    }
    visit(result);
    await eachLimit(records, async (record) => {
      if (!record.coverId && record.coverUrl) {
        try {
          record.coverId = (await covers.ensure(record.coverUrl)).id;
          if (record.row)
            record.coverId = await store.covers.assign(
              record.row,
              record.coverId,
              record.token,
            );
        } catch {
          // Metadata and the rest of the library remain usable during a source outage.
          record.coverId = "";
        }
      }
    });
    const books = (await store.api.getCollection()).books;
    for (const record of records) {
      if (
        !record.coverId ||
        record.row ||
        record.bundle ||
        record.special ||
        record.catalogVariant
      )
        continue;
      const isbn = canonicalIsbn(record.isbn);
      const key = volumeCoverKey(record);
      for (const book of books) {
        if (book.coverId || book.coverUrl) continue;
        if (
          (isbn && canonicalIsbn(book.isbn) === isbn) ||
          (key && volumeCoverKey(book) === key)
        ) {
          book.coverId = await store.covers.assign(
            book.row,
            record.coverId,
            book.token,
          );
        }
      }
    }
    if (result && typeof result === "object" && !Array.isArray(result)) {
      result.bookCoverIds = Object.fromEntries(
        books
          .filter((book) => book.coverId)
          .map((book) => [book.row, book.coverId]),
      );
      if (Array.isArray(result.covers)) {
        const missing = result.covers.filter((cover) => !cover.coverId).length;
        result.covers = result.covers.filter((cover) => cover.coverId);
        if (missing)
          result.warnings.push(
            "Some cover images could not be downloaded. Try pulling covers again.",
          );
      }
    }
    return result;
  }
  const methods: Record<string, (arg?: unknown) => unknown> = {
    ...store.api,
    ...catalogs,
    ...anime,
    ...createSeasonalDiscoveryService(anime, catalogs),
  };
  const api = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      async (arg) => {
        if (arg && typeof arg === "object") {
          const refresh = (arg as { refresh?: unknown }).refresh;
          // Some source adapters use truthiness. Validate before authorization
          // so JSON values such as "true", 1 or {} cannot force a refresh.
          if (Object.hasOwn(arg, "refresh") && typeof refresh !== "boolean")
            throw new AppError("Choose a boolean refresh value.");
          if (refresh === true) store.requireAdmin();
        }
        return await attachImages(await method(arg));
      },
    ]),
  );
  api.getCollection = async () => {
    const collection = await store.api.getCollection();
    await eachLimit(
      [...collection.books, ...collection.trash.map((entry) => entry.book)],
      async (book) => {
        if (book.coverId) return;
        try {
          const source = await knownBookCoverUrl(store, book);
          if (source) {
            const image = await covers.ensure(source);
            book.coverId = await store.covers.assign(
              book.row,
              image.id,
              book.token,
            );
          }
        } catch {}
      },
    );
    return await attachImages(collection);
  };
  api.saveBook = async (request) => {
    const book = { ...request.book };
    if (book.coverUrl && !book.coverId)
      book.coverId = (await covers.ensure(book.coverUrl)).id;
    return await store.api.saveBook({ ...request, book });
  };
  // Search must never wait for cover downloads or mutate a user's shelf.
  return {
    ...api,
    ...createMetadataService(store, catalogs),
    ...createSearchService(store, catalogs, fetchImpl),
  };
}
