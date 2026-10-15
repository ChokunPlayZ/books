import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { Book, StoredBook } from "../types.ts";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  BOOK_APP,
  PUBLISHERS,
  normalizeBook,
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

type DatabaseRow = Record<string, SQLOutputValue> & {
  id: number;
  user_version: number;
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

export type Store = ReturnType<typeof openStore>;
export class AppError extends Error {
  readonly status: number;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function openStore(
  path = process.env.BOOKS_DATABASE_PATH || "./data/books.sqlite",
) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  // Add subsequent schema versions here; startup never drops or reseeds user data.
  const version = Number(db.prepare("PRAGMA user_version").get().user_version);
  if (version > 3) {
    db.close();
    throw new Error("This database needs a newer version of Book Collection.");
  }
  if (version === 0)
    db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT, isbn TEXT NOT NULL DEFAULT '',
      canonical_isbn TEXT NOT NULL DEFAULT '', series TEXT NOT NULL, type TEXT NOT NULL DEFAULT '',
      publisher TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', volume REAL,
      source TEXT NOT NULL DEFAULT '', price REAL, purchased_on TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
      trash_id TEXT UNIQUE, removed_at TEXT
    );
    CREATE INDEX books_isbn ON books(canonical_isbn) WHERE removed_at IS NULL;
    CREATE INDEX books_series ON books(series) WHERE removed_at IS NULL;
    CREATE TABLE receipts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE saved_releases (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE series_catalogs (series_key TEXT NOT NULL, publisher_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(series_key,publisher_id,type));
    CREATE TABLE options (field TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(field,value));
    CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE imports (fingerprint TEXT PRIMARY KEY, result TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at INTEGER NOT NULL);
    PRAGMA user_version=1;
    COMMIT;
  `);
  if (version < 2)
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE books ADD COLUMN cover_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN publisher_url TEXT NOT NULL DEFAULT '';
      PRAGMA user_version=2;
      COMMIT;
    `);
  if (version < 3)
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE covers (id TEXT PRIMARY KEY, content_type TEXT NOT NULL, body BLOB NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE cover_sources (url TEXT PRIMARY KEY, cover_id TEXT NOT NULL REFERENCES covers(id));
      ALTER TABLE books ADD COLUMN cover_id TEXT REFERENCES covers(id);
      PRAGMA user_version=3;
      COMMIT;
    `);
  const run = (sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).run(...args);
  const all = <T = DatabaseRow>(sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).all(...args) as T[];
  const get = <T = DatabaseRow>(sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).get(...args) as T | undefined;
  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function book(row: DatabaseRow): StoredBook {
    const data = Object.fromEntries(
      fields.map((field, index) => [field, row[columns[index]] ?? ""]),
    ) as Book;
    data.coverUrl = row.cover_url;
    data.publisherUrl = row.publisher_url;
    return {
      ...data,
      coverId: row.cover_id || "",
      row: row.id,
      token: digest(stableJson([row.id, row.revision, data])),
    };
  }
  function current(request) {
    if (!Number.isSafeInteger(request.row))
      throw new AppError("Choose a book and try again.");
    const row = get(
      "SELECT * FROM books WHERE id=? AND removed_at IS NULL",
      request.row,
    );
    if (!row || book(row).token !== request.token)
      throw new AppError(
        "This book changed since you opened it. Refresh and reopen the book.",
        409,
      );
    return row;
  }
  function receipt(kind, request, fn) {
    if (!request || !/^[a-zA-Z0-9_-]{12,100}$/.test(request.requestId || ""))
      throw new AppError("Refresh the app and try again.");
    return transaction(() => {
      const hash = digest(stableJson(request));
      const previous = get(
        "SELECT * FROM receipts WHERE id=?",
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
      const result = fn();
      run(
        "INSERT INTO receipts VALUES (?,?,?,?,?)",
        request.requestId,
        kind,
        hash,
        JSON.stringify(result),
        new Date().toISOString(),
      );
      return result;
    });
  }
  function rememberOptions(data) {
    for (const field of ["series", "type", "publisher", "status", "source"])
      if (data[field])
        run(
          "INSERT OR IGNORE INTO options VALUES (?,?)",
          field,
          String(data[field]),
        );
  }
  function insertBook(data, removedAt = null, trashId = null) {
    const args = fields.map((field) =>
      (field === "volume" || field === "price") && data[field] === ""
        ? null
        : (data[field] ??
          (field === "volume" || field === "price" ? null : "")),
    );
    const result = run(
      `INSERT INTO books (${columns.join(",")},canonical_isbn,removed_at,trash_id) VALUES (${Array(13).fill("?").join(",")})`,
      ...args,
      canonicalIsbn(data.isbn),
      removedAt,
      trashId,
    );
    rememberOptions(data);
    const id = Number(result.lastInsertRowid);
    writeMetadata(id, data);
    return id;
  }
  function writeMetadata(id, data) {
    const metadata = bookMetadata(data);
    let coverId = data.coverId;
    const existing = get("SELECT cover_url,cover_id FROM books WHERE id=?", id);
    if (coverId === undefined)
      coverId =
        metadata.coverUrl === existing?.cover_url
          ? existing.cover_id
          : covers.bySource(metadata.coverUrl)?.id;
    if (coverId && !covers.get(coverId))
      throw new AppError("Choose an available stored cover.");
    run(
      "UPDATE books SET cover_url=?,publisher_url=?,cover_id=? WHERE id=?",
      metadata.coverUrl,
      metadata.publisherUrl,
      coverId || null,
      id,
    );
  }
  function duplicate(isbn, id) {
    return (
      isbn &&
      get(
        "SELECT id FROM books WHERE canonical_isbn=? AND removed_at IS NULL AND id<>?",
        isbn,
        id || 0,
      )
    );
  }
  function collection() {
    const options = {
      series: [],
      type: [...BOOK_APP.types],
      publisher: [],
      status: [...BOOK_APP.statuses],
      source: [],
    };
    all("SELECT * FROM options").forEach((row) => {
      if (options[row.field]) options[row.field].push(row.value);
    });
    Object.keys(options).forEach(
      (key) => (options[key] = [...new Set(options[key])].sort()),
    );
    const timeZone = process.env.BOOKS_TIME_ZONE || "Asia/Bangkok";
    const rows = all(
      "SELECT * FROM books WHERE removed_at IS NULL ORDER BY id",
    );
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.series)) groups.set(row.series, []);
      groups.get(row.series).push(row);
    }
    return {
      books: rows.map(book),
      titles: [...groups].map(([series, volumes]) => ({
        series,
        token: titleToken(series, volumes),
      })),
      trash: all(
        "SELECT * FROM books WHERE removed_at IS NOT NULL ORDER BY removed_at DESC,id DESC",
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
      savedReleases: savedReleases(),
      seriesCatalogs: all("SELECT data FROM series_catalogs").map((row) =>
        JSON.parse(row.data),
      ),
    };
  }
  function savedReleases() {
    return all(
      "SELECT data FROM saved_releases ORDER BY updated_at DESC,id",
    ).map((row) => JSON.parse(row.data));
  }
  function titleToken(series, rows) {
    return digest(
      stableJson([series, rows.map((row) => [row.id, row.revision])]),
    );
  }
  const api = {
    getCollection: collection,
    saveTitle(request) {
      return receipt("title", request, () => {
        const original = String(request.series || "");
        const rows = all(
          "SELECT * FROM books WHERE series=? AND removed_at IS NULL ORDER BY id",
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
          all(
            "SELECT DISTINCT series FROM books WHERE removed_at IS NULL",
          ).some(
            (row) =>
              row.series !== original &&
              row.series.toLocaleLowerCase() === series.toLocaleLowerCase(),
          )
        )
          throw new AppError(
            "That title already exists. Use a different series name.",
            409,
          );
        const editions = new Map();
        if (!Array.isArray(request.title?.editions))
          throw new AppError("Include the editions for this title.");
        for (const edition of request.title.editions) {
          const key = JSON.stringify([
            edition.originalType,
            edition.originalPublisher,
          ]);
          const type = String(edition.type || "").trim();
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
          run(
            "UPDATE books SET series=?,type=?,publisher=?,publisher_url=?,revision=revision+1 WHERE id=?",
            series,
            edition.type,
            edition.publisher,
            safePublisherUrl(row.publisher_url, edition.publisher),
            row.id,
          );
          rememberOptions({
            series,
            type: edition.type,
            publisher: edition.publisher,
          });
        }
        // Keep selected catalog categories attached when a title or edition is renamed.
        const catalogs = all(
          "SELECT data FROM series_catalogs WHERE series_key=?",
          catalogSeriesKey(original),
        );
        run(
          "DELETE FROM series_catalogs WHERE series_key=?",
          catalogSeriesKey(original),
        );
        for (const row of catalogs) {
          const catalog = JSON.parse(row.data);
          const edition = [...editions.values()].find(
            (entry) =>
              entry.originalType === catalog.type &&
              publisherKey(entry.originalPublisher) === catalog.publisherId,
          );
          if (
            edition &&
            publisherKey(edition.publisher) !== catalog.publisherId
          )
            continue;
          api.setSeriesCatalog({
            ...catalog,
            series,
            type: edition?.type ?? catalog.type,
          });
        }
        return { series, volumes: rows.length, action: "title updated" };
      });
    },
    checkOwnership(raw) {
      const isbn = normalizeIsbn(raw);
      if (!isbn) throw new AppError("Enter or scan an ISBN first.");
      const books = collection().books;
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
    saveBook(request) {
      return receipt("save", request, () => {
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
        const existing = request.row == null ? null : current(request);
        Object.assign(
          data,
          bookMetadata({
            publisher: data.publisher,
            coverUrl: request.book.coverUrl ?? existing?.cover_url ?? "",
            publisherUrl:
              request.book.publisherUrl ?? existing?.publisher_url ?? "",
          }),
        );
        if (request.book.coverId !== undefined)
          data.coverId = request.book.coverId;
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
          duplicate(canonicalIsbn(data.isbn), existing?.id)
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
          run(
            `UPDATE books SET ${columns.map((c) => c + "=?").join(",")},canonical_isbn=?,revision=revision+1 WHERE id=?`,
            ...args,
            canonicalIsbn(data.isbn),
            existing.id,
          );
          rememberOptions(data);
          id = existing.id;
          writeMetadata(id, data);
        } else id = insertBook(data);
        return { row: id, action: existing ? "updated" : "added" };
      });
    },
    setBookIsbn(request) {
      return receipt("isbn", request, () => {
        const row = current(request),
          isbn = normalizeIsbn(request.isbn);
        if (!isbn) throw new AppError("Enter or scan an ISBN first.");
        if (!request.allowDuplicate && duplicate(canonicalIsbn(isbn), row.id))
          throw new AppError(
            "This ISBN belongs to another book on your shelf. Select Another copy if you own two copies.",
            409,
          );
        run(
          "UPDATE books SET isbn=?,canonical_isbn=?,cover_id=CASE WHEN cover_url='' THEN NULL ELSE cover_id END,revision=revision+1 WHERE id=?",
          isbn,
          canonicalIsbn(isbn),
          row.id,
        );
        return { row: row.id, isbn, action: "isbn saved" };
      });
    },
    removeBook(request) {
      return receipt("remove", request, () => {
        const row = current(request),
          trashId = randomUUID();
        run(
          "UPDATE books SET trash_id=?,removed_at=?,revision=revision+1 WHERE id=?",
          trashId,
          new Date().toISOString(),
          row.id,
        );
        return { row: row.id, trashId, action: "removed" };
      });
    },
    restoreBook(request) {
      return receipt("restore", request, () => {
        const row = get(
          "SELECT * FROM books WHERE trash_id=? AND removed_at IS NOT NULL",
          String(request.trashId || ""),
        );
        if (!row)
          throw new AppError(
            "This book has already been restored. Refresh your collection.",
            409,
          );
        run(
          "UPDATE books SET removed_at=NULL,trash_id=NULL,revision=revision+1 WHERE id=?",
          row.id,
        );
        return { row: row.id, trashId: request.trashId, action: "restored" };
      });
    },
    setSavedRelease(request) {
      if (typeof request?.saved !== "boolean")
        throw new AppError("Choose Save for later or Unsave.");
      const item = cleanRelease(request.release);
      if (request.saved)
        run(
          "INSERT INTO saved_releases VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
          item.id,
          JSON.stringify(item),
          new Date().toISOString(),
        );
      else run("DELETE FROM saved_releases WHERE id=?", item.id);
      return { savedReleases: savedReleases() };
    },
    setSeriesCatalog(request) {
      const spec = seriesCatalogRequest(request),
        url = safeSeriesCatalogUrl(request.url, spec.publisherId);
      if (!url) throw new AppError("Use this publisher’s series category URL.");
      const data = {
        series: spec.series,
        publisherId: spec.publisherId,
        type: spec.type,
        url,
        title: String(request.title || spec.series).slice(0, 500),
      };
      run(
        "INSERT INTO series_catalogs VALUES (?,?,?,?) ON CONFLICT(series_key,publisher_id,type) DO UPDATE SET data=excluded.data",
        catalogSeriesKey(spec.series),
        spec.publisherId,
        spec.type,
        JSON.stringify(data),
      );
      return data;
    },
  };
  function importData(plan, fingerprint?: string) {
    return transaction(() => {
      const previous = get(
        "SELECT result FROM imports WHERE fingerprint=?",
        fingerprint,
      );
      if (previous)
        return { ...JSON.parse(previous.result), alreadyImported: true };
      // An import into an occupied library is ambiguous: preserve real duplicate copies.
      // Require an empty library instead of guessing whether matching volumes are duplicates.
      if (
        get("SELECT COUNT(*) AS n FROM books").n ||
        get("SELECT COUNT(*) AS n FROM saved_releases").n ||
        get("SELECT COUNT(*) AS n FROM series_catalogs").n
      )
        throw new AppError(
          "Import into an empty library. Download a backup first, or use a new database to restore it.",
          409,
        );
      for (const image of plan.covers || []) {
        const stored = covers.put(image);
        for (const url of image.sources || [])
          covers.linkSource(url, stored.id);
      }
      plan.books.forEach((data) => insertBook(data));
      plan.trash.forEach((entry) =>
        insertBook(entry.book, entry.removedAt, entry.id || randomUUID()),
      );
      plan.savedReleases.forEach((item) =>
        api.setSavedRelease({ release: item, saved: true }),
      );
      plan.seriesCatalogs.forEach((item) => api.setSeriesCatalog(item));
      for (const [field, values] of Object.entries(plan.options || {}))
        for (const value of values as string[])
          run(
            "INSERT OR IGNORE INTO options VALUES (?,?)",
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
      run(
        "INSERT INTO imports VALUES (?,?,?)",
        fingerprint,
        JSON.stringify(result),
        new Date().toISOString(),
      );
      return result;
    });
  }
  const cache = {
    get(key) {
      const row = get(
        "SELECT value FROM cache WHERE key=? AND expires_at>?",
        key,
        Date.now(),
      );
      return row?.value || null;
    },
    put(key, value, seconds) {
      run(
        "INSERT INTO cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at",
        key,
        value,
        Date.now() + seconds * 1000,
      );
    },
  };
  const covers = {
    get(id) {
      const row = get<CoverRow>("SELECT * FROM covers WHERE id=?", id);
      return row
        ? {
            id: row.id,
            contentType: row.content_type,
            body: Buffer.from(row.body),
          }
        : null;
    },
    bySource(url) {
      const row = get("SELECT cover_id FROM cover_sources WHERE url=?", url);
      return row ? covers.get(row.cover_id) : null;
    },
    linkSource(url, id) {
      run(
        "INSERT INTO cover_sources VALUES (?,?) ON CONFLICT(url) DO UPDATE SET cover_id=excluded.cover_id",
        url,
        id,
      );
    },
    put(
      { body, contentType }: { body: Uint8Array; contentType: string },
      url?: string,
    ) {
      const id = createHash("sha256").update(body).digest("hex");
      run(
        "INSERT OR IGNORE INTO covers VALUES (?,?,?,?)",
        id,
        contentType,
        body,
        new Date().toISOString(),
      );
      if (url) covers.linkSource(url, id);
      return { id, body: Buffer.from(body), contentType };
    },
    assign(row, coverId, token) {
      const current = get("SELECT * FROM books WHERE id=?", row);
      if (!current) return "";
      if (token && book(current).token !== token) return current.cover_id || "";
      // Automatic cover association is derived metadata; it does not invalidate edits.
      run(
        "UPDATE books SET cover_id=? WHERE id=? AND cover_id IS NULL",
        coverId,
        row,
      );
      return get("SELECT cover_id FROM books WHERE id=?", row)?.cover_id || "";
    },
  };
  return {
    db,
    api,
    transaction,
    cache,
    covers,
    importData,
    close: () => db.close(),
    savedSeriesCatalog(spec) {
      const row = get(
        "SELECT data FROM series_catalogs WHERE series_key=? AND publisher_id=? AND type=?",
        catalogSeriesKey(spec.series),
        spec.publisherId,
        spec.type,
      );
      return row ? JSON.parse(row.data) : null;
    },
    exportData() {
      return transaction(() => {
        const data = collection();
        return {
          covers: all<CoverRow>("SELECT * FROM covers").map((image) => ({
            id: image.id,
            contentType: image.content_type,
            data: Buffer.from(image.body).toString("base64"),
            sources: all(
              "SELECT url FROM cover_sources WHERE cover_id=?",
              image.id,
            ).map((source) => source.url),
          })),
          format: "book-collection",
          version: 1,
          exportedAt: new Date().toISOString(),
          books: data.books,
          trash: data.trash,
          savedReleases: data.savedReleases,
          seriesCatalogs: all("SELECT data FROM series_catalogs").map((row) =>
            JSON.parse(row.data),
          ),
          options: data.options,
        };
      });
    },
  };
}
