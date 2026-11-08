import { openDatabase, type DatabaseValue } from "./database.ts";
import type { Book, StoredBook } from "../types.ts";
import { createHash, randomUUID } from "node:crypto";
import { createUserContext, type User } from "./user-context.ts";
import type { Preferences } from "../preferences.ts";
import { exportLibraryBook } from "../domain/library-export.ts";
import { COVER_PREVIEW_VERSION } from "./cover-images.ts";
import {
  normalizeBookType,
  normalizeRecordTypes,
} from "../domain/book-type.ts";
import {
  BOOK_APP,
  PUBLISHERS,
  normalizeBook,
  normalizePurchaseDetails,
  normalizeIsbn,
  canonicalIsbn,
  digest,
  stableJson,
  cleanRelease,
  seriesCatalogRequest,
  safeSeriesCatalogUrl,
  catalogSeriesKey,
  bookMetadata,
  publisherKey,
  safePublisherUrl,
  splitFirstPageTitle,
} from "../domain.ts";

const columns = [
  "isbn",
  "series",
  "type",
  "publisher",
  "status",
  "volume",
  "source",
  "price",
  "purchased_on",
  "note",
];
const fields = BOOK_APP.fields;

type DatabaseRow = Record<string, DatabaseValue> & {
  id: number;
  revision: number;
  series: string;
  isbn: string;
  type: string;
  publisher: string;
  data: string;
  result: string;
  value: string;
  field: string;
  body: Uint8Array;
  cover_id: string;
  cover_url: string;
  publisher_url: string;
  removed_at: string;
  trash_id: string;
};

type CoverRow = {
  id: string;
  content_type: string;
  body: Uint8Array;
};

export type Store = Awaited<ReturnType<typeof openStore>>;
export class AppError extends Error {
  readonly status: number;
  // Instrumentation, RSC and route handlers can load separate server bundles.
  // Preserve typed HTTP errors across those bundles without trusting arbitrary
  // objects containing a caller-controlled `status` property.
  static [Symbol.hasInstance](value: unknown) {
    return (
      value instanceof Error &&
      Reflect.get(value, Symbol.for("meemai.AppError")) === true
    );
  }
  constructor(message, status = 400) {
    super(message);
    Object.defineProperty(this, Symbol.for("meemai.AppError"), { value: true });
    this.status = status;
  }
}

export async function openStore(
  connectionString = process.env.DATABASE_URL || "",
) {
  const users = createUserContext();
  const db = await openDatabase(connectionString, () => users.current().id);
  const closeHandlers = new Set<() => Promise<void>>();
  const owned = "user_id=app_user_id()";
  function requireAdmin() {
    if (users.current().role !== "admin")
      throw new AppError(
        "Only an administrator can manage shared metadata or re-scrape sources.",
        403,
      );
  }
  const run = async (sql: string, ...args: DatabaseValue[]) =>
    await db.prepare(sql).run(...args);
  const all = async <T = DatabaseRow>(sql: string, ...args: DatabaseValue[]) =>
    (await db.prepare(sql).all(...args)) as T[];
  const get = async <T = DatabaseRow>(sql: string, ...args: DatabaseValue[]) =>
    (await db.prepare(sql).get(...args)) as T | undefined;
  const preferences = {
    async get(): Promise<Preferences> {
      const row = await get(
        "SELECT locale,theme FROM users WHERE id=app_user_id()",
      );
      if (!row) throw new AppError("Sign in to open your library.", 401);
      return {
        locale: row.locale as Preferences["locale"],
        theme: row.theme as Preferences["theme"],
      };
    },
    async update(input: unknown): Promise<Preferences> {
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new AppError("Choose a valid language or theme.");
      const changes = input as Record<string, unknown>;
      const keys = Object.keys(changes);
      if (
        !keys.length ||
        keys.some((key) => key !== "locale" && key !== "theme") ||
        (Object.hasOwn(changes, "locale") &&
          (typeof changes.locale !== "string" ||
            !["en", "th"].includes(changes.locale))) ||
        (Object.hasOwn(changes, "theme") &&
          (typeof changes.theme !== "string" ||
            !["light", "dark", "system"].includes(changes.theme)))
      )
        throw new AppError("Choose a valid language or theme.");
      return await transaction(async () => {
        for (const key of keys)
          await run(
            `UPDATE users SET ${key}=? WHERE id=app_user_id()`,
            changes[key] as string,
          );
        return preferences.get();
      });
    },
  };
  const transaction = db.transaction;
  function book(row: DatabaseRow): StoredBook {
    const data = Object.fromEntries(
      fields.map((field, index) => [field, row[columns[index]] ?? ""]),
    ) as Book;
    data.coverUrl = row.cover_url;
    data.publisherUrl = row.publisher_url;
    data.pageCount = row.page_count == null ? "" : Number(row.page_count);
    data.msrp = row.msrp == null ? "" : Number(row.msrp);
    data.msrpCurrency = String(row.msrp_currency || "");
    data.edition = String(row.edition || "");
    return {
      ...data,
      coverId: row.cover_id || "",
      row: row.id,
      token: digest(stableJson([row.id, row.revision, data])),
    };
  }
  async function current(request) {
    if (!Number.isSafeInteger(request.row))
      throw new AppError("Choose a book and try again.");
    const row = await get(
      `SELECT * FROM books WHERE ${owned} AND id=? AND removed_at IS NULL`,
      request.row,
    );
    if (!row || book(row).token !== request.token)
      throw new AppError(
        "This book changed since you opened it. Refresh and reopen the book.",
        409,
      );
    return row;
  }
  async function receipt(kind, request, fn) {
    if (!request || !/^[a-zA-Z0-9_-]{12,100}$/.test(request.requestId || ""))
      throw new AppError("Refresh the app and try again.");
    return await transaction(async () => {
      const hash = digest(stableJson(request));
      const previous = await get(
        `SELECT * FROM receipts WHERE ${owned} AND id=?`,
        request.requestId,
      );
      if (previous) {
        if (previous.kind !== kind || previous.hash !== hash)
          throw new AppError(
            "This request ID was already used for a different change.",
            409,
          );
        return JSON.parse(previous.result);
      }
      const result = await fn();
      await run(
        "INSERT INTO receipts VALUES (?,?,?,?,?,app_user_id())",
        request.requestId,
        kind,
        hash,
        JSON.stringify(result),
        new Date().toISOString(),
      );
      return result;
    });
  }
  async function rememberOptions(data) {
    for (const field of ["series", "type", "publisher", "status", "source"])
      if (data[field])
        await run(
          "INSERT INTO options VALUES (?,?,app_user_id()) ON CONFLICT DO NOTHING",
          field,
          String(data[field]),
        );
  }
  async function insertBook(data, removedAt = null, trashId = null) {
    data = {
      ...data,
      edition: data.edition ?? data.type,
      type: normalizeBookType(data.type),
    };
    const args = fields.map((field) =>
      (field === "volume" || field === "price") && data[field] === ""
        ? null
        : (data[field] ??
          (field === "volume" || field === "price" ? null : "")),
    );
    const result = await run(
      `INSERT INTO books (${columns.join(",")},canonical_isbn,removed_at,trash_id,user_id) VALUES (${Array(13).fill("?").join(",")},app_user_id()) RETURNING id`,
      ...args,
      canonicalIsbn(data.isbn),
      removedAt,
      trashId,
    );
    await rememberOptions(data);
    const id = Number(result.lastInsertRowid);
    await writeMetadata(id, data);
    return id;
  }
  async function writeMetadata(id, data) {
    const metadata = bookMetadata(data);
    let coverId = data.coverId;
    const existing = await get(
      `SELECT cover_url,cover_id FROM books WHERE ${owned} AND id=?`,
      id,
    );
    if (coverId === undefined)
      coverId =
        metadata.coverUrl === existing?.cover_url
          ? existing.cover_id
          : (await covers.bySource(metadata.coverUrl))?.id;
    if (
      coverId &&
      (!(await covers.get(coverId)) || !(await covers.canAccess(coverId)))
    )
      throw new AppError("Choose an available stored cover.");
    await run(
      `UPDATE books SET cover_url=?,publisher_url=?,cover_id=?,page_count=?,msrp=?,msrp_currency=?,edition=? WHERE ${owned} AND id=?`,
      metadata.coverUrl,
      metadata.publisherUrl,
      coverId || null,
      metadata.pageCount === "" ? null : metadata.pageCount,
      metadata.msrp === "" ? null : metadata.msrp,
      metadata.msrpCurrency,
      metadata.edition,
      id,
    );
  }
  async function duplicate(isbn, id) {
    return (
      isbn &&
      (await get(
        `SELECT id FROM books WHERE ${owned} AND canonical_isbn=? AND removed_at IS NULL AND id<>?`,
        isbn,
        id || 0,
      ))
    );
  }
  async function collection() {
    const options = {
      series: [],
      type: [...BOOK_APP.types],
      publisher: [],
      status: [...BOOK_APP.statuses],
      source: [],
    };
    (await all(`SELECT * FROM options WHERE ${owned}`)).forEach((row) => {
      if (row.field !== "type" && options[row.field])
        options[row.field].push(row.value);
    });
    Object.keys(options).forEach(
      (key) => (options[key] = [...new Set(options[key])].sort()),
    );
    const timeZone = process.env.BOOKS_TIME_ZONE || "Asia/Bangkok";
    const rows = await all(
      `SELECT * FROM books WHERE ${owned} AND removed_at IS NULL ORDER BY id`,
    );
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.series)) groups.set(row.series, []);
      groups.get(row.series).push(row);
    }
    return {
      user: users.current(),
      books: rows.map(book),
      titles: [...groups].map(([series, volumes]) => ({
        series,
        token: titleToken(series, volumes),
      })),
      trash: (
        await all(
          `SELECT * FROM books WHERE ${owned} AND removed_at IS NOT NULL ORDER BY removed_at DESC,id DESC`,
        )
      ).map((row) => ({
        id: row.trash_id,
        removedAt: row.removed_at,
        book: book(row),
      })),
      options,
      timeZone,
      today: new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      publishers: PUBLISHERS,
      savedReleases: await savedReleases(),
      seriesCatalogs: (
        await all(`SELECT data FROM series_catalogs WHERE ${owned}`)
      ).map((row) => normalizeRecordTypes(JSON.parse(row.data))),
    };
  }
  async function savedReleases() {
    return (
      await all(
        `SELECT data FROM saved_releases WHERE ${owned} ORDER BY updated_at DESC,id`,
      )
    ).map((row) => {
      const item = JSON.parse(row.data);
      if (item.publisherId === "firstpage")
        item.type = splitFirstPageTitle(item.title).type || item.type;
      return normalizeRecordTypes(item);
    });
  }
  function titleToken(series, rows) {
    return digest(
      stableJson([series, rows.map((row) => [row.id, row.revision])]),
    );
  }
  async function saveBookChange(request) {
    const values = normalizeBook(request.book || {});
    const data = Object.fromEntries(
      fields.map((field, index) => [field, values[index]]),
    );
    if (data.date !== "")
      data.date = new Date(
        Date.UTC(1899, 11, 30) + Number(data.date) * 86400000,
      )
        .toISOString()
        .slice(0, 10);
    const existing = request.row == null ? null : await current(request);
    Object.assign(
      data,
      bookMetadata({
        publisher: data.publisher,
        coverUrl: request.book.coverUrl ?? existing?.cover_url ?? "",
        publisherUrl:
          request.book.publisherUrl ?? existing?.publisher_url ?? "",
        pageCount: request.book.pageCount ?? existing?.page_count ?? "",
        msrp: request.book.msrp ?? existing?.msrp ?? "",
        msrpCurrency:
          request.book.msrpCurrency ?? existing?.msrp_currency ?? "",
        edition:
          request.book.edition ?? existing?.edition ?? request.book.type ?? "",
      }),
    );
    if (request.book.coverId !== undefined) data.coverId = request.book.coverId;
    if (
      existing &&
      !existing.cover_url &&
      !data.coverUrl &&
      (!data.coverId || data.coverId === existing.cover_id) &&
      (canonicalIsbn(data.isbn) !== existing.canonical_isbn ||
        data.series !== existing.series ||
        data.type !== existing.type ||
        data.publisher !== existing.publisher ||
        (data.volume === "" ? null : data.volume) !== existing.volume)
    )
      data.coverId = "";
    if (
      !request.allowDuplicate &&
      (await duplicate(canonicalIsbn(data.isbn), existing?.id))
    )
      throw new AppError(
        "That ISBN is already in your collection. Select Another copy to save a second copy.",
        409,
      );
    let id;
    if (existing) {
      const args = fields.map((field) =>
        data[field] === "" && ["volume", "price"].includes(field)
          ? null
          : data[field],
      );
      await run(
        `UPDATE books SET ${columns.map((c) => c + "=?").join(",")},canonical_isbn=?,revision=revision+1 WHERE ${owned} AND id=?`,
        ...args,
        canonicalIsbn(data.isbn),
        existing.id,
      );
      await rememberOptions(data);
      id = existing.id;
      await writeMetadata(id, data);
    } else id = await insertBook(data);
    return { row: id, action: existing ? "updated" : "added" };
  }
  const api = {
    getCollection: collection,
    async updateBooks(request: {
      requestId: string;
      action: "status" | "remove" | "restore";
      status?: string;
      books: { row: number; token: string; trashId?: string }[];
    }) {
      return await receipt("batch-books", request, async () => {
        if (
          !["status", "remove", "restore"].includes(request.action) ||
          !Array.isArray(request.books) ||
          !request.books.length
        )
          throw new AppError("Choose books and a batch action.");
        const status =
          typeof request.status === "string" ? request.status.trim() : "";
        if (request.action === "status" && (!status || status.length > 500))
          throw new AppError(
            "Choose a reading status of up to 500 characters.",
          );
        const seen = new Set<number>();
        const removedAt = new Date().toISOString();
        for (const selected of request.books) {
          if (
            !selected ||
            typeof selected !== "object" ||
            seen.has(selected.row)
          )
            throw new AppError("Include each book only once.");
          seen.add(selected.row);
          if (request.action === "restore") {
            if (
              !Number.isSafeInteger(selected.row) ||
              typeof selected.trashId !== "string"
            )
              throw new AppError("Choose removed books to restore.");
            const row = await get(
              `SELECT * FROM books WHERE ${owned} AND id=? AND trash_id=? AND removed_at IS NOT NULL`,
              selected.row,
              selected.trashId,
            );
            if (!row || book(row).token !== selected.token)
              throw new AppError(
                "A selected book changed. Refresh and select the books again.",
                409,
              );
            await run(
              `UPDATE books SET removed_at=NULL,trash_id=NULL,revision=revision+1 WHERE ${owned} AND id=?`,
              row.id,
            );
          } else {
            const row = await current(selected);
            if (request.action === "status")
              await run(
                `UPDATE books SET status=?,revision=revision+1 WHERE ${owned} AND id=?`,
                status,
                row.id,
              );
            else
              await run(
                `UPDATE books SET trash_id=?,removed_at=?,revision=revision+1 WHERE ${owned} AND id=?`,
                randomUUID(),
                removedAt,
                row.id,
              );
          }
        }
        if (request.action === "status") await rememberOptions({ status });
        return {
          books: seen.size,
          action: request.action,
          ...(request.action === "status" ? { status } : {}),
        };
      });
    },
    async mergeSeries(request: {
      requestId: string;
      series: string;
      titles: { series: string; token: string }[];
    }) {
      return await receipt("merge-series", request, async () => {
        if (!Array.isArray(request.titles) || request.titles.length < 2)
          throw new AppError("Select at least two series to merge.");
        const names = new Set<string>();
        const titles = await Promise.all(
          request.titles.map(async (title) => {
            if (
              !title ||
              typeof title.series !== "string" ||
              names.has(title.series)
            )
              throw new AppError("Include each series only once.");
            names.add(title.series);
            const rows = await all(
              `SELECT * FROM books WHERE ${owned} AND series=? AND removed_at IS NULL ORDER BY id`,
              title.series,
            );
            if (!rows.length || titleToken(title.series, rows) !== title.token)
              throw new AppError(
                "A selected series changed. Close this dialog, refresh and select the series again.",
                409,
              );
            return { series: title.series, rows };
          }),
        );
        const series = request.series;
        if (typeof series !== "string" || !names.has(series))
          throw new AppError(
            "Choose one of the selected series names to keep.",
          );
        for (const title of titles) {
          if (title.series === series) continue;
          await run(
            `UPDATE books SET series=?,revision=revision+1 WHERE ${owned} AND series=? AND removed_at IS NULL`,
            series,
            title.series,
          );
          await run(
            `DELETE FROM options WHERE ${owned} AND field='series' AND value=? AND NOT EXISTS (SELECT 1 FROM books WHERE ${owned} AND series=?)`,
            title.series,
            title.series,
          );
        }
        await rememberOptions({ series });

        // The destination's catalog choices take priority when editions overlap.
        const targetKey = catalogSeriesKey(series);
        for (const row of await all(
          `SELECT data,type FROM series_catalogs WHERE ${owned} AND series_key=?`,
          targetKey,
        )) {
          const catalog = JSON.parse(row.data);
          await run(
            `UPDATE series_catalogs SET data=? WHERE ${owned} AND series_key=? AND publisher_id=? AND type=?`,
            JSON.stringify({ ...catalog, series }),
            targetKey,
            catalog.publisherId,
            row.type,
          );
        }
        const sourceKeys = new Set(
          titles.map((title) => catalogSeriesKey(title.series)),
        );
        sourceKeys.delete(targetKey);
        const remainingKeys = new Set(
          (
            await all(
              `SELECT DISTINCT series FROM books WHERE ${owned} AND removed_at IS NULL`,
            )
          ).map((row) => catalogSeriesKey(row.series)),
        );
        for (const key of sourceKeys) {
          for (const row of await all(
            `SELECT data,type FROM series_catalogs WHERE ${owned} AND series_key=?`,
            key,
          )) {
            const catalog = JSON.parse(row.data);
            await run(
              "INSERT INTO series_catalogs VALUES (?,?,?,?,app_user_id()) ON CONFLICT DO NOTHING",
              targetKey,
              catalog.publisherId,
              row.type,
              JSON.stringify({ ...catalog, series }),
            );
          }
          if (!remainingKeys.has(key))
            await run(
              `DELETE FROM series_catalogs WHERE ${owned} AND series_key=?`,
              key,
            );
        }
        return {
          series,
          volumes: titles.reduce(
            (count, title) => count + title.rows.length,
            0,
          ),
          merged: titles.length,
        };
      });
    },
    async saveTitle(request) {
      return await receipt("title", request, async () => {
        const original = String(request.series || "");
        const rows = await all(
          `SELECT * FROM books WHERE ${owned} AND series=? AND removed_at IS NULL ORDER BY id`,
          original,
        );
        if (!rows.length || titleToken(original, rows) !== request.token)
          throw new AppError(
            "This title changed since you opened it. Refresh and reopen the title details.",
            409,
          );
        const series = String(request.title?.series || "").trim();
        if (!series || series.length > 500)
          throw new AppError("Enter a series name of up to 500 characters.");
        if (
          (
            await all(
              `SELECT DISTINCT series FROM books WHERE ${owned} AND removed_at IS NULL`,
            )
          ).some(
            (row) =>
              row.series !== original &&
              row.series.toLocaleLowerCase() === series.toLocaleLowerCase(),
          )
        )
          throw new AppError(
            "That title already exists. To combine them, select both on the collection page and choose Merge series.",
            409,
          );
        const editions = new Map();
        if (!Array.isArray(request.title?.editions))
          throw new AppError("Include the editions for this title.");
        for (const edition of request.title.editions) {
          const key = JSON.stringify([
            normalizeBookType(edition.originalType),
            edition.originalPublisher,
          ]);
          const type = edition.type ? normalizeBookType(edition.type) : "";
          const publisher = String(edition.publisher || "").trim();
          if (
            !type ||
            type.length > 500 ||
            publisher.length > 500 ||
            editions.has(key)
          )
            throw new AppError(
              "Choose a type and a publisher of up to 500 characters for each edition.",
            );
          editions.set(key, { ...edition, type, publisher });
        }
        const keys = new Set(
          rows.map((row) => JSON.stringify([row.type, row.publisher])),
        );
        if (
          editions.size !== keys.size ||
          [...keys].some((key) => !editions.has(key))
        )
          throw new AppError(
            "The editions changed. Refresh and reopen the title details.",
            409,
          );
        for (const row of rows) {
          const edition = editions.get(
            JSON.stringify([row.type, row.publisher]),
          );
          await run(
            `UPDATE books SET series=?,type=?,publisher=?,publisher_url=?,revision=revision+1 WHERE ${owned} AND id=?`,
            series,
            edition.type,
            edition.publisher,
            safePublisherUrl(row.publisher_url, edition.publisher),
            row.id,
          );
          await rememberOptions({
            series,
            type: edition.type,
            publisher: edition.publisher,
          });
        }
        // Keep selected catalog categories attached when a title or edition is renamed.
        const catalogs = await all(
          `SELECT data FROM series_catalogs WHERE ${owned} AND series_key=?`,
          catalogSeriesKey(original),
        );
        await run(
          `DELETE FROM series_catalogs WHERE ${owned} AND series_key=?`,
          catalogSeriesKey(original),
        );
        for (const row of catalogs) {
          const catalog = JSON.parse(row.data);
          const edition = [...editions.values()].find(
            (entry) =>
              normalizeBookType(entry.originalType) ===
                normalizeBookType(catalog.type) &&
              publisherKey(entry.originalPublisher) === catalog.publisherId,
          );
          if (
            edition &&
            publisherKey(edition.publisher) !== catalog.publisherId
          )
            continue;
          await api.setSeriesCatalog({
            ...catalog,
            series,
            type: edition?.type ?? catalog.type,
          });
        }
        return { series, volumes: rows.length, action: "title updated" };
      });
    },
    async checkOwnership(raw) {
      const isbn = normalizeIsbn(raw);
      if (!isbn) throw new AppError("Enter or scan an ISBN first.");
      const books = (await collection()).books;
      return {
        isbn,
        books,
        matches: books.filter(
          (b) => canonicalIsbn(b.isbn) === canonicalIsbn(isbn),
        ),
        unindexedCount: books.filter((b) => !canonicalIsbn(b.isbn)).length,
        totalCount: books.length,
        checkedAt: new Date().toISOString(),
      };
    },
    async saveBook(request) {
      return await receipt("save", request, async () => {
        return await saveBookChange(request);
      });
    },
    async saveSeriesVolumes(request: {
      requestId: string;
      series: string;
      changes: { row: number; token: string; book: Partial<Book> }[];
    }) {
      return await receipt("series-volumes", request, async () => {
        if (
          typeof request.series !== "string" ||
          !request.series ||
          !Array.isArray(request.changes) ||
          !request.changes.length
        )
          throw new AppError("Choose volumes in this series to update.");
        const seen = new Set<number>();
        for (const change of request.changes) {
          if (!change || typeof change !== "object" || seen.has(change.row))
            throw new AppError("Include each volume only once.");
          seen.add(change.row);
          const row = await current(change);
          if ((row.series.trim() || "Untitled series") !== request.series)
            throw new AppError("Choose volumes from the same series.");
          if (
            !change.book ||
            typeof change.book !== "object" ||
            Array.isArray(change.book)
          )
            throw new AppError("Enter the volume details to update.");
          // Title renames belong to Edit title details; each copy stays in this series.
          const updates = Object.fromEntries(
            [
              ...fields.filter((field) => field !== "series"),
              "coverUrl",
              "publisherUrl",
              "pageCount",
              "msrp",
              "msrpCurrency",
              "edition",
            ]
              .filter((field) => Object.hasOwn(change.book, field))
              .map((field) => [field, change.book[field]]),
          );
          const { coverId, ...existing } = book(row);
          await saveBookChange({
            row: change.row,
            token: change.token,
            book: { ...existing, ...updates },
            // Existing owned copies can intentionally share ISBNs.
            allowDuplicate: true,
          });
        }
        return { volumes: seen.size, action: "volumes updated" };
      });
    },
    async saveSeriesPurchases(request: {
      requestId: string;
      series: string;
      changes: {
        row: number;
        token: string;
        date: string;
        price: string;
        source: string;
      }[];
    }) {
      return await receipt("series-purchases", request, async () => {
        if (
          typeof request.series !== "string" ||
          !request.series ||
          !Array.isArray(request.changes) ||
          !request.changes.length
        )
          throw new AppError("Choose volumes in this series to update.");
        const seen = new Set<number>();
        for (const change of request.changes) {
          if (!change || typeof change !== "object" || seen.has(change.row))
            throw new AppError("Include each volume only once.");
          seen.add(change.row);
          const row = await current(change);
          if ((row.series.trim() || "Untitled series") !== request.series)
            throw new AppError("Choose volumes from the same series.");
          const details = normalizePurchaseDetails(change);
          await run(
            `UPDATE books SET purchased_on=?,price=?,source=?,revision=revision+1 WHERE ${owned} AND id=?`,
            details.date,
            details.price === "" ? null : details.price,
            details.source,
            row.id,
          );
          await rememberOptions({ source: details.source });
        }
        return { volumes: seen.size, action: "purchases updated" };
      });
    },
    async setBookIsbn(request) {
      return await receipt("isbn", request, async () => {
        const row = await current(request),
          isbn = normalizeIsbn(request.isbn);
        if (!isbn) throw new AppError("Enter or scan an ISBN first.");
        if (
          !request.allowDuplicate &&
          (await duplicate(canonicalIsbn(isbn), row.id))
        )
          throw new AppError(
            "This ISBN belongs to another book on your shelf. Select Another copy if you own two copies.",
            409,
          );
        await run(
          `UPDATE books SET isbn=?,canonical_isbn=?,cover_id=CASE WHEN cover_url='' THEN NULL ELSE cover_id END,revision=revision+1 WHERE ${owned} AND id=?`,
          isbn,
          canonicalIsbn(isbn),
          row.id,
        );
        return { row: row.id, isbn, action: "isbn saved" };
      });
    },
    async removeBook(request) {
      return await receipt("remove", request, async () => {
        const row = await current(request),
          trashId = randomUUID();
        await run(
          `UPDATE books SET trash_id=?,removed_at=?,revision=revision+1 WHERE ${owned} AND id=?`,
          trashId,
          new Date().toISOString(),
          row.id,
        );
        return { row: row.id, trashId, action: "removed" };
      });
    },
    async restoreBook(request) {
      return await receipt("restore", request, async () => {
        const row = await get(
          `SELECT * FROM books WHERE ${owned} AND trash_id=? AND removed_at IS NOT NULL`,
          String(request.trashId || ""),
        );
        if (!row)
          throw new AppError(
            "This book has already been restored. Refresh your collection.",
            409,
          );
        await run(
          `UPDATE books SET removed_at=NULL,trash_id=NULL,revision=revision+1 WHERE ${owned} AND id=?`,
          row.id,
        );
        return { row: row.id, trashId: request.trashId, action: "restored" };
      });
    },
    async setSavedRelease(request) {
      if (typeof request?.saved !== "boolean")
        throw new AppError("Choose Save for later or Unsave.");
      const item = normalizeRecordTypes(cleanRelease(request.release));
      if (item.coverId && !(await covers.canAccess(item.coverId)))
        throw new AppError("Choose an available stored cover.");
      if (request.saved)
        await run(
          "INSERT INTO saved_releases VALUES (?,?,?,app_user_id()) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
          item.id,
          JSON.stringify(item),
          new Date().toISOString(),
        );
      else
        await run(
          `DELETE FROM saved_releases WHERE ${owned} AND id=?`,
          item.id,
        );
      return { savedReleases: await savedReleases() };
    },
    async setSeriesCatalog(request) {
      const spec = seriesCatalogRequest(request),
        url = safeSeriesCatalogUrl(request.url, spec.publisherId);
      if (!url) throw new AppError("Use this publisher’s series category URL.");
      const data = {
        series: spec.series,
        publisherId: spec.publisherId,
        type: spec.type,
        url,
        title: String(request.title || spec.series).slice(0, 500),
        ...(request.edition
          ? { edition: String(request.edition).slice(0, 500) }
          : {}),
      };
      await run(
        "INSERT INTO series_catalogs VALUES (?,?,?,?,app_user_id()) ON CONFLICT(user_id,series_key,publisher_id,type) DO UPDATE SET data=excluded.data",
        catalogSeriesKey(spec.series),
        spec.publisherId,
        data.edition ? spec.type + "\n" + data.edition : spec.type,
        JSON.stringify(data),
      );
      return data;
    },
  };
  async function importData(plan, fingerprint: string) {
    return await transaction(async () => {
      const previous = await get(
        `SELECT result FROM imports WHERE ${owned} AND fingerprint=?`,
        fingerprint,
      );
      if (previous)
        return { ...JSON.parse(previous.result), alreadyImported: true };
      // An import into an occupied library is ambiguous: preserve real duplicate copies.
      // Require an empty library instead of guessing whether matching volumes are duplicates.
      if (
        (await get(`SELECT COUNT(*) AS n FROM books WHERE ${owned}`)).n ||
        (await get(`SELECT COUNT(*) AS n FROM saved_releases WHERE ${owned}`))
          .n ||
        (await get(`SELECT COUNT(*) AS n FROM series_catalogs WHERE ${owned}`))
          .n
      )
        throw new AppError(
          "Import into an empty library. Download a backup first, or use a new database to restore it.",
          409,
        );
      for (const image of plan.covers || []) {
        const stored = await covers.put(image);
        for (const url of image.sources || [])
          await covers.linkPrivateSource(url, stored.id);
      }
      for (const data of plan.books) await insertBook(data);
      for (const entry of plan.trash)
        await insertBook(entry.book, entry.removedAt, entry.id || randomUUID());
      for (const item of plan.savedReleases)
        await api.setSavedRelease({ release: item, saved: true });
      for (const item of plan.seriesCatalogs) await api.setSeriesCatalog(item);
      for (const [field, values] of Object.entries(plan.options || {}))
        for (const value of values as string[])
          await run(
            "INSERT INTO options VALUES (?,?,app_user_id()) ON CONFLICT DO NOTHING",
            field,
            String(value),
          );
      const result = {
        books: plan.books.length,
        trash: plan.trash.length,
        savedReleases: plan.savedReleases.length,
        seriesCatalogs: plan.seriesCatalogs.length,
        warnings: plan.warnings,
      };
      await run(
        "INSERT INTO imports VALUES (?,?,?,app_user_id())",
        fingerprint,
        JSON.stringify(result),
        new Date().toISOString(),
      );
      return result;
    });
  }
  const cache = {
    async searchable() {
      // Only parsed public book metadata and this user's series aliases. Never
      // expose raw responses, private imports, or another user's catalog links.
      return await all<{ key: string; value: string }>(
        `SELECT key,value FROM cache WHERE (expires_at=0 OR expires_at>?) AND (
          key LIKE 'isbn:v15:%' OR key LIKE 'publisher-catalog:v1:%' OR
          key LIKE 'publisher-directory:v1:%' OR key LIKE 'releases:v1:%' OR
          key LIKE 'search-titles:v1:%' OR key LIKE ?
        ) ORDER BY key`,
        Date.now(),
        `user:${users.current().id}:series:v1:%`,
      );
    },
    async get(key) {
      if (key.startsWith("series:v1:"))
        key = `user:${users.current().id}:` + key;
      const row = await get(
        "SELECT value FROM cache WHERE key=? AND (expires_at=0 OR expires_at>?)",
        key,
        Date.now(),
      );
      return row?.value || null;
    },
    async put(key, value, seconds) {
      if (key.startsWith("series:v1:"))
        key = `user:${users.current().id}:` + key;
      await run(
        "INSERT INTO cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at",
        key,
        value,
        seconds === Infinity ? 0 : Date.now() + seconds * 1000,
      );
    },
  };
  const covers = {
    async canAccess(id: string) {
      return !!(await get(
        `SELECT 1 FROM cover_access WHERE ${owned} AND cover_id=?
        UNION ALL SELECT 1 FROM books WHERE ${owned} AND cover_id=?
        UNION ALL SELECT 1 FROM saved_releases WHERE ${owned} AND data::jsonb->>'coverId'=? LIMIT 1`,
        id,
        id,
        id,
      ));
    },
    async allow(id: string) {
      await run(
        "INSERT INTO cover_access VALUES (app_user_id(),?) ON CONFLICT DO NOTHING",
        id,
      );
    },
    async get(id) {
      const row = await get<CoverRow>("SELECT * FROM covers WHERE id=?", id);
      return row
        ? {
            id: row.id,
            contentType: row.content_type,
            body: Buffer.from(row.body),
          }
        : null;
    },
    async preview(id: string) {
      const row = await get<{ body: Uint8Array | null; blurhash: string }>(
        "SELECT body,blurhash FROM cover_previews WHERE cover_id=? AND version=?",
        id,
        COVER_PREVIEW_VERSION,
      );
      return row
        ? {
            body: row.body ? Buffer.from(row.body) : null,
            blurhash: row.blurhash,
          }
        : null;
    },
    async putPreview(
      id: string,
      preview: { body: Uint8Array | null; blurhash: string },
    ) {
      await run(
        "INSERT INTO cover_previews (cover_id,version,body,blurhash) VALUES (?,?,?,?) ON CONFLICT(cover_id) DO UPDATE SET version=excluded.version,body=excluded.body,blurhash=excluded.blurhash",
        id,
        COVER_PREVIEW_VERSION,
        preview.body,
        preview.blurhash,
      );
      return preview;
    },
    async blurhashes(ids: string[]): Promise<Record<string, string>> {
      if (!ids.length) return {};
      const rows = await all<{ cover_id: string; blurhash: string }>(
        `SELECT cover_id,blurhash FROM cover_previews p WHERE version=? AND blurhash<>''
        AND cover_id IN (${ids.map(() => "?").join(",")}) AND (
          EXISTS (SELECT 1 FROM cover_access a WHERE a.user_id=app_user_id() AND a.cover_id=p.cover_id)
          OR EXISTS (SELECT 1 FROM books b WHERE b.user_id=app_user_id() AND b.cover_id=p.cover_id)
          OR EXISTS (SELECT 1 FROM saved_releases s WHERE s.user_id=app_user_id() AND s.data::jsonb->>'coverId'=p.cover_id)
        )`,
        COVER_PREVIEW_VERSION,
        ...ids,
      );
      return Object.fromEntries(
        rows.map((row) => [row.cover_id, row.blurhash]),
      );
    },
    async bySource(url) {
      const row = await get(
        `SELECT cover_id FROM user_cover_sources WHERE ${owned} AND url=?
        UNION ALL SELECT cover_id FROM cover_sources WHERE url=? LIMIT 1`,
        url,
        url,
      );
      if (row) await covers.allow(row.cover_id);
      return row ? await covers.get(row.cover_id) : null;
    },
    async linkSource(url, id) {
      await run(
        "INSERT INTO cover_sources VALUES (?,?) ON CONFLICT(url) DO UPDATE SET cover_id=excluded.cover_id",
        url,
        id,
      );
    },
    async linkPrivateSource(url: string, id: string) {
      await run(
        "INSERT INTO user_cover_sources VALUES (app_user_id(),?,?) ON CONFLICT(user_id,url) DO UPDATE SET cover_id=excluded.cover_id",
        url,
        id,
      );
    },
    async put(
      { body, contentType }: { body: Uint8Array; contentType: string },
      url?: string,
    ) {
      const id = createHash("sha256").update(body).digest("hex");
      await run(
        "INSERT INTO covers VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
        id,
        contentType,
        body,
        new Date().toISOString(),
      );
      if (url) await covers.linkSource(url, id);
      await covers.allow(id);
      return { id, body: Buffer.from(body), contentType };
    },
    async assign(row, coverId, token) {
      return transaction(async () => {
        if (!(await covers.canAccess(coverId))) return "";
        const current = await get(
          `SELECT * FROM books WHERE ${owned} AND id=?`,
          row,
        );
        if (!current) return "";
        if (token && book(current).token !== token)
          return current.cover_id || "";
        // Automatic cover association is derived metadata; it does not invalidate edits.
        await run(
          `UPDATE books SET cover_id=? WHERE ${owned} AND id=? AND cover_id IS NULL`,
          coverId,
          row,
        );
        return (
          (await get(`SELECT cover_id FROM books WHERE ${owned} AND id=?`, row))
            ?.cover_id || ""
        );
      });
    },
  };
  return {
    db,
    currentUser: users.current,
    requireAdmin,
    async forUser<T>(user: User, action: () => T | Promise<T>): Promise<T> {
      const account = await get<{
        id: number;
        username: string;
        role: User["role"];
      }>("SELECT id,username,role FROM users WHERE id=?", user.id);
      if (!account) throw new AppError("Sign in to open your library.", 401);
      return users.run(account, action);
    },
    api,
    preferences,
    transaction,
    cache,
    covers,
    importData,
    onClose: (handler: () => Promise<void>) => closeHandlers.add(handler),
    close: async () => {
      for (const handler of closeHandlers) await handler();
      await db.close();
    },
    async savedSeriesCatalog(spec) {
      const row = await get(
        `SELECT data FROM series_catalogs WHERE ${owned} AND series_key=? AND publisher_id=? AND type=?`,
        catalogSeriesKey(spec.series),
        spec.publisherId,
        spec.type ? normalizeBookType(spec.type) : "",
      );
      if (row) return normalizeRecordTypes(JSON.parse(row.data));
      const legacy = (
        await all(
          `SELECT data FROM series_catalogs WHERE ${owned} AND series_key=? AND publisher_id=?`,
          catalogSeriesKey(spec.series),
          spec.publisherId,
        )
      )
        .map((entry) => normalizeRecordTypes(JSON.parse(entry.data)))
        .filter((entry) => entry.type === normalizeBookType(spec.type));
      // Several legacy language links require an explicit choice, never a guess.
      return legacy.length === 1 ? legacy[0] : null;
    },
    async exportLibrary(series?: string) {
      const rows = await all(
        `SELECT * FROM books WHERE ${owned} AND removed_at IS NULL ORDER BY id`,
      );
      const books = rows
        .map(book)
        .filter(
          (record) =>
            series === undefined ||
            (record.series.trim() || "Untitled series") === series,
        )
        .map(exportLibraryBook);
      if (series !== undefined && !books.length)
        throw new AppError("This series has no owned volumes to export.", 404);
      return { format: "book-collection", version: 1, books };
    },
    // Full-fidelity server backups are separate from the user-facing export.
    async exportData(series?: string) {
      return await transaction(async () => {
        const data = await collection();
        const matches = (record: { series: string }) =>
          (record.series.trim() || "Untitled series") === series;
        if (series !== undefined) {
          data.books = data.books.filter(matches);
          if (!data.books.length)
            throw new AppError(
              "This series has no owned volumes to export.",
              404,
            );
          data.trash = [];
          data.savedReleases = data.savedReleases.filter(matches);
          data.seriesCatalogs = data.seriesCatalogs.filter(matches);
          for (const field of Object.keys(data.options))
            data.options[field] = [
              ...new Set(data.books.map((book) => book[field]).filter(Boolean)),
            ].sort();
        }
        const coverIds = new Set(
          [
            ...data.books,
            ...data.trash.map((entry) => entry.book),
            ...data.savedReleases,
          ]
            .map((record) => record.coverId)
            .filter(Boolean),
        );
        const imageFilter = ` WHERE id IN (${[...coverIds].map(() => "?").join(",") || "NULL"})`;
        return {
          covers: await Promise.all(
            (
              await all<CoverRow>(
                "SELECT * FROM covers" + imageFilter,
                ...coverIds,
              )
            ).map(async (image) => ({
              id: image.id,
              contentType: image.content_type,
              data: Buffer.from(image.body).toString("base64"),
              sources: (
                await all(
                  `SELECT url FROM cover_sources WHERE cover_id=? UNION SELECT url FROM user_cover_sources WHERE ${owned} AND cover_id=?`,
                  image.id,
                  image.id,
                )
              ).map((source) => source.url),
            })),
          ),
          format: "book-collection",
          version: 1,
          exportedAt: new Date().toISOString(),
          books: data.books,
          trash: data.trash,
          savedReleases: data.savedReleases,
          seriesCatalogs: data.seriesCatalogs,
          options: data.options,
        };
      }, true);
    },
  };
}
