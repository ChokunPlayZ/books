import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BOOK_APP,
  PUBLISHERS,
  normalizeBook_,
  normalizeIsbn_,
  canonicalIsbn_,
  digest_,
  stableJson_,
  cleanRelease_,
  seriesCatalogRequest_,
  safeSeriesCatalogUrl_,
  catalogSeriesKey_,
} from "../domain.mjs";

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
export class AppError extends Error {
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
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 1) {
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
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  function transaction(fn) {
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
  function book(row) {
    const data = Object.fromEntries(
      fields.map((field, index) => [field, row[columns[index]] ?? ""]),
    );
    return {
      ...data,
      row: row.id,
      token: digest_(stableJson_([row.id, row.revision, data])),
      hasFormula: false,
      isbnHasFormula: false,
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
      const hash = digest_(stableJson_(request));
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
      canonicalIsbn_(data.isbn),
      removedAt,
      trashId,
    );
    rememberOptions(data);
    return Number(result.lastInsertRowid);
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
    return {
      books: all(
        "SELECT * FROM books WHERE removed_at IS NULL ORDER BY id",
      ).map(book),
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
  const api = {
    getCollection: collection,
    checkOwnership(raw) {
      const isbn = normalizeIsbn_(raw);
      if (!isbn) throw new AppError("Enter or scan an ISBN first.");
      const books = collection().books;
      return {
        isbn,
        books,
        matches: books.filter(
          (b) => canonicalIsbn_(b.isbn) === canonicalIsbn_(isbn),
        ),
        unindexedCount: books.filter((b) => !canonicalIsbn_(b.isbn)).length,
        totalCount: books.length,
        checkedAt: new Date().toISOString(),
      };
    },
    saveBook(request) {
      return receipt("save", request, () => {
        const values = normalizeBook_(request.book || {});
        const data = Object.fromEntries(
          fields.map((field, index) => [field, values[index]]),
        );
        if (data.date !== "")
          data.date = new Date(Date.UTC(1899, 11, 30) + data.date * 86400000)
            .toISOString()
            .slice(0, 10);
        const existing = request.row == null ? null : current(request);
        if (
          !request.allowDuplicate &&
          duplicate(canonicalIsbn_(data.isbn), existing?.id)
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
            canonicalIsbn_(data.isbn),
            existing.id,
          );
          rememberOptions(data);
          id = existing.id;
        } else id = insertBook(data);
        return { row: id, action: existing ? "updated" : "added" };
      });
    },
    setBookIsbn(request) {
      return receipt("isbn", request, () => {
        const row = current(request),
          isbn = normalizeIsbn_(request.isbn);
        if (!isbn) throw new AppError("Enter or scan an ISBN first.");
        if (!request.allowDuplicate && duplicate(canonicalIsbn_(isbn), row.id))
          throw new AppError(
            "This ISBN belongs to another book on your shelf. Select Another copy if you own two copies.",
            409,
          );
        run(
          "UPDATE books SET isbn=?,canonical_isbn=?,revision=revision+1 WHERE id=?",
          isbn,
          canonicalIsbn_(isbn),
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
      const item = cleanRelease_(request.release);
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
      const spec = seriesCatalogRequest_(request),
        url = safeSeriesCatalogUrl_(request.url, spec.publisherId);
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
        catalogSeriesKey_(spec.series),
        spec.publisherId,
        spec.type,
        JSON.stringify(data),
      );
      return data;
    },
  };
  function importData(plan, fingerprint) {
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
      plan.books.forEach((data) => insertBook(data));
      plan.trash.forEach((entry) =>
        insertBook(entry.book, entry.removedAt, entry.id || randomUUID()),
      );
      plan.savedReleases.forEach((item) =>
        api.setSavedRelease({ release: item, saved: true }),
      );
      plan.seriesCatalogs.forEach((item) => api.setSeriesCatalog(item));
      for (const [field, values] of Object.entries(plan.options || {}))
        for (const value of values)
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
  return {
    db,
    api,
    transaction,
    cache,
    importData,
    close: () => db.close(),
    savedSeriesCatalog(spec) {
      const row = get(
        "SELECT data FROM series_catalogs WHERE series_key=? AND publisher_id=? AND type=?",
        catalogSeriesKey_(spec.series),
        spec.publisherId,
        spec.type,
      );
      return row ? JSON.parse(row.data) : null;
    },
    exportData() {
      return transaction(() => {
        const data = collection();
        return {
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
