import { createCatalogService, knownBookCoverUrl } from "./catalogs.ts";
import { canonicalIsbn, volumeCoverKey } from "../domain.ts";
import { createAnimeService } from "./anime.ts";

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
            record.coverId = store.covers.assign(
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
    const books = store.api.getCollection().books;
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
          book.coverId = store.covers.assign(
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
    ...createAnimeService(store, fetchImpl),
  };
  const api = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      async (arg) => attachImages(await method(arg)),
    ]),
  );
  api.getCollection = async () => {
    const collection = store.api.getCollection();
    await eachLimit(
      [...collection.books, ...collection.trash.map((entry) => entry.book)],
      async (book) => {
        if (book.coverId) return;
        try {
          const source = knownBookCoverUrl(store, book);
          if (source) {
            const image = await covers.ensure(source);
            book.coverId = store.covers.assign(book.row, image.id, book.token);
          }
        } catch {}
      },
    );
    return attachImages(collection);
  };
  api.saveBook = async (request) => {
    const book = { ...request.book };
    if (book.coverUrl && !book.coverId)
      book.coverId = (await covers.ensure(book.coverUrl)).id;
    return store.api.saveBook({ ...request, book });
  };
  return api;
}
