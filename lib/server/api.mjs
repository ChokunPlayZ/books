import { createCatalogService } from "./catalogs.mjs";

async function eachLimit(items, action, limit = 4) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (cursor < items.length) await action(items[cursor++]);
  }));
}

// All client-facing book data carries stored IDs. Cover discovery belongs here.
export function createApplicationApi(store, covers, fetchImpl = globalThis.fetch) {
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
          if (record.row) store.covers.assign(record.row, record.coverId);
        } catch {
          // Metadata and the rest of the library remain usable during a source outage.
          record.coverId = "";
        }
      }
    });
    return result;
  }
  const methods = { ...store.api, ...catalogs };
  const api = Object.fromEntries(Object.entries(methods).map(([name, method]) => [
    name, async (arg) => attachImages(await method(arg)),
  ]));
  api.getCollection = async () => {
    const collection = store.api.getCollection();
    await eachLimit([...collection.books, ...collection.trash.map((entry) => entry.book)], async (book) => {
      if (book.coverId) return;
      try {
        const found = await catalogs.getBookCover({ row: book.row });
        book.coverUrl = found.coverUrl || book.coverUrl;
      } catch {}
    });
    return attachImages(collection);
  };
  api.saveBook = async (request) => {
    const book = { ...request.book };
    if (book.coverUrl && !book.coverId) book.coverId = (await covers.ensure(book.coverUrl)).id;
    return store.api.saveBook({ ...request, book });
  };
  return api;
}
