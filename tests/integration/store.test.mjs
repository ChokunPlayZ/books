import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as XLSX from "xlsx";
import { openStore } from "../../lib/server/store.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { BOOK_APP, parseCatalog } from "../../lib/domain.ts";
import { hasSession, signIn, signOut } from "../../lib/server/auth.ts";
import { readFileSync } from "node:fs";

const input = {
  isbn: "0140328726",
  series: "A story",
  type: "Manga (TH)",
  publisher: "Publisher",
  status: "Read",
  volume: "14.5",
  source: "Shop",
  price: "0",
  date: "2026-10-09",
  note: "=literal text",
};
let sequence = 0;
const request = (book = input, extra = {}) => ({
  requestId: `test_request_${++sequence}`,
  book,
  ...extra,
});
const plan = (books = [input]) =>
  parseImport(Buffer.from(JSON.stringify(books)), "books.json");
const release = () =>
  parseCatalog(
    "phoenix",
    readFileSync(
      new URL("../fixtures/publishers/phoenix.html", import.meta.url),
      "utf8",
    ),
  )[0];

test("SQLite writes, gifts, unknown prices, decimals, dates and options persist after restart", () => {
  const path = join(mkdtempSync(join(tmpdir(), "books-db-")), "books.sqlite");
  let store = openStore(path);
  const result = store.api.saveBook(request());
  store.api.saveBook(
    request({ ...input, isbn: "", series: "No price", price: "" }),
  );
  store.close();
  store = openStore(path);
  try {
    const data = store.api.getCollection(),
      book = data.books[0];
    assert.equal(book.row, result.row);
    assert.equal(book.volume, 14.5);
    assert.equal(book.price, 0);
    assert.equal(book.date, "2026-10-09");
    assert.equal(book.note, "=literal text");
    assert.equal(data.books[1].price, "");
    assert.ok(data.options.publisher.includes("Publisher"));
    assert.equal(
      data.books.reduce((sum, b) => sum + (Number(b.price) || 0), 0),
      0,
    );
  } finally {
    store.close();
  }
});

test("request receipts survive restart, reject mismatched reuse and commit atomically with writes", () => {
  const path = join(
      mkdtempSync(join(tmpdir(), "books-retry-")),
      "books.sqlite",
    ),
    arg = request();
  let store = openStore(path);
  const result = store.api.saveBook(arg);
  store.close();
  store = openStore(path);
  try {
    assert.deepEqual(store.api.saveBook(arg), result);
    assert.equal(store.api.getCollection().books.length, 1);
    assert.throws(
      () =>
        store.api.saveBook({ ...arg, book: { ...input, series: "Different" } }),
      /different change/,
    );
    store.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;",
    );
    assert.throws(
      () =>
        store.api.saveBook(
          request({ ...input, isbn: "", series: "Must roll back" }),
        ),
      /simulated/,
    );
    assert.equal(store.api.getCollection().books.length, 1);
    assert.ok(
      !store.api.getCollection().options.series.includes("Must roll back"),
    );
  } finally {
    store.close();
  }
});

test("equivalent ISBNs prevent duplicates, allow explicit copies and check ownership against current records", () => {
  const store = openStore(":memory:");
  try {
    store.api.saveBook(request());
    assert.throws(
      () => store.api.saveBook(request({ ...input, isbn: "9780140328721" })),
      /already/,
    );
    store.api.saveBook(
      request({ ...input, isbn: "9780140328721" }, { allowDuplicate: true }),
    );
    store.api.saveBook(request({ ...input, isbn: "", series: "Unindexed" }));
    const result = store.api.checkOwnership("978-0-140-32872-1");
    assert.equal(result.matches.length, 2);
    assert.equal(result.unindexedCount, 1);
    assert.equal(result.totalCount, 3);
  } finally {
    store.close();
  }
});

test("edits and ISBN-only saves reject stale versions and preserve every other field", () => {
  const store = openStore(":memory:");
  try {
    store.api.saveBook(request({ ...input, isbn: "" }));
    const book = store.api.getCollection().books[0],
      arg = {
        requestId: "isbn_request_0001",
        row: book.row,
        token: book.token,
        isbn: input.isbn,
      };
    store.api.setBookIsbn(arg);
    const updated = store.api.getCollection().books[0];
    for (const field of BOOK_APP.fields.filter((f) => f !== "isbn"))
      assert.equal(updated[field], book[field]);
    assert.notEqual(updated.token, book.token);
    assert.equal(updated.row, book.row);
    assert.throws(
      () =>
        store.api.saveBook(
          request(input, { row: book.row, token: book.token }),
        ),
      /changed/,
    );
    assert.deepEqual(store.api.setBookIsbn(arg), {
      row: book.row,
      isbn: input.isbn,
      action: "isbn saved",
    });
  } finally {
    store.close();
  }
});

test("recoverable removal and restore are durable, idempotent, and never reuse another book ID", () => {
  const store = openStore(":memory:");
  try {
    store.api.saveBook(request());
    const original = store.api.getCollection().books[0];
    const arg = {
        requestId: "remove_request_001",
        row: original.row,
        token: original.token,
      },
      removed = store.api.removeBook(arg);
    assert.deepEqual(store.api.removeBook(arg), removed);
    assert.equal(store.api.getCollection().books.length, 0);
    assert.equal(store.api.getCollection().trash.length, 1);
    const added = store.api.saveBook(
      request({ ...input, isbn: "", series: "Another book" }),
    );
    assert.notEqual(added.row, original.row);
    const restore = {
        requestId: "restore_request_01",
        trashId: removed.trashId,
      },
      restored = store.api.restoreBook(restore);
    assert.deepEqual(store.api.restoreBook(restore), restored);
    assert.equal(restored.row, original.row);
    assert.equal(store.api.getCollection().books.length, 2);
    assert.equal(store.api.getCollection().trash.length, 0);
  } finally {
    store.close();
  }
});

test("workbook migration preserves owned books, hidden helper tabs and literal notes without remote writes", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      BOOK_APP.headers,
      [
        input.isbn,
        input.series,
        input.type,
        input.publisher,
        input.status,
        14.5,
        input.source,
        0,
        46304,
        input.note,
      ],
      [
        "",
        input.series,
        input.type,
        input.publisher,
        input.status,
        15,
        input.source,
        "",
        "",
        "copy",
      ],
    ]),
    "Sheet1",
  );
  const item = release(),
    catalog = {
      series: input.series,
      publisherId: "phoenix",
      type: input.type,
      url: "https://www.phoenixnext.com/book-series/bocchi-the-rock.html",
      title: "Bocchi The Rock",
    };
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Trash ID", "Removed At", "State", "Original Row", "Book JSON"],
      [
        "trash-original",
        "2026-10-09T00:00:00Z",
        "removed",
        2,
        JSON.stringify(input),
      ],
    ]),
    "_BookAppTrash",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Release ID", "State", "Book JSON", "Updated At"],
      [item.id, "saved", JSON.stringify(item), "2026-10-09"],
    ]),
    "_BookAppReleases",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Series", "Publisher ID", "Type", "Catalog URL", "Catalog Title"],
      Object.values(catalog),
    ]),
    "_BookAppSeriesCatalogs",
  );
  const parsed = parseImport(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      "collection.xlsx",
    ),
    store = openStore(":memory:");
  try {
    const imported = store.importData(parsed, parsed.fingerprint),
      data = store.api.getCollection();
    assert.equal(imported.books, 2);
    assert.equal(data.books[0].date, "2026-10-09");
    assert.equal(data.books[0].price, 0);
    assert.equal(data.books[1].price, "");
    assert.equal(data.trash.length, 1);
    assert.equal(data.savedReleases.length, 1);
    assert.equal(store.savedSeriesCatalog(catalog).url, catalog.url);
    assert.equal(data.books[0].note, input.note);
    assert.equal(
      store.importData(parsed, parsed.fingerprint).alreadyImported,
      true,
    );
    assert.equal(store.api.getCollection().books.length, 2);
  } finally {
    store.close();
  }
});

test("JSON backup restores removed books, saved releases, editions, duplicates and unused dropdown choices", () => {
  const source = openStore(":memory:"),
    destination = openStore(":memory:");
  try {
    source.api.saveBook(request());
    source.api.saveBook(request(input, { allowDuplicate: true }));
    const book = source.api.getCollection().books[0];
    source.api.removeBook({
      requestId: "backup_remove_001",
      row: book.row,
      token: book.token,
    });
    source.api.setSavedRelease({ release: release(), saved: true });
    source.db
      .prepare("INSERT INTO options VALUES (?,?)")
      .run("source", "Unused shop");
    const parsed = parseImport(
      Buffer.from(JSON.stringify(source.exportData())),
      "backup.json",
    );
    destination.importData(parsed, parsed.fingerprint);
    assert.equal(destination.api.getCollection().books.length, 1);
    assert.equal(destination.api.getCollection().trash.length, 1);
    assert.equal(destination.api.getCollection().savedReleases.length, 1);
    assert.ok(
      destination.api.getCollection().options.source.includes("Unused shop"),
    );
    assert.throws(
      () =>
        destination.importData(
          plan([{ ...input, series: "Another import" }]),
          "different-source",
        ),
      /empty library/,
    );
    assert.equal(destination.api.getCollection().books.length, 1);
  } finally {
    source.close();
    destination.close();
  }
});

test("migration rejects malformed inputs and retains legacy scientific ISBNs, blank prices and duplicate copies", () => {
  const fixture = parseImport(
    readFileSync(new URL("../fixtures/collection.json", import.meta.url)),
    "books.json",
  );
  assert.equal(fixture.books.length, 150);
  assert.equal(fixture.books[96].isbn, "9780113896554");
  assert.equal(fixture.books[0].price, 0);
  for (const data of [
    [{ ...input, price: -1 }],
    [{ ...input, date: "2026-02-30" }],
    [{ ...input, series: "" }],
  ])
    assert.throws(() => plan(data));
  assert.throws(() => parseImport(Buffer.from("{invalid"), "books.json"));
  assert.throws(
    () =>
      parseImport(
        Buffer.from(
          JSON.stringify({ format: "book-collection", version: 2, books: [] }),
        ),
        "books.json",
      ),
    /supported/,
  );
  assert.throws(
    () => parseImport(Buffer.from("ISBN,Series\n123,title"), "books.csv"),
    /ten columns/,
  );
});

test("authentication persists sessions, invalidates old passwords, expires sessions and rate-limits failures", () => {
  const oldPassword = process.env.BOOKS_PASSWORD;
  process.env.BOOKS_PASSWORD = "test-library-password";
  const store = openStore(":memory:");
  try {
    assert.equal(hasSession(store, null), false);
    const login = signIn(store, "test-library-password");
    assert.ok(login.token);
    assert.equal(hasSession(store, login.token), true);
    process.env.BOOKS_PASSWORD = "changed-password";
    assert.equal(hasSession(store, login.token), false);
    process.env.BOOKS_PASSWORD = "test-library-password";
    signOut(store, login.token);
    assert.equal(hasSession(store, login.token), false);
    const expired = signIn(store, "test-library-password");
    store.db.exec("UPDATE sessions SET expires_at=0");
    assert.equal(hasSession(store, expired.token), false);
    for (let i = 0; i < 10; i++)
      assert.equal(signIn(store, "wrong").error.status, 401);
    assert.equal(signIn(store, "test-library-password").error.status, 429);
  } finally {
    store.close();
    if (oldPassword === undefined) delete process.env.BOOKS_PASSWORD;
    else process.env.BOOKS_PASSWORD = oldPassword;
  }
});
