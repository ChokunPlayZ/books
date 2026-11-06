import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as XLSX from "xlsx";
import { openTestStore as openStore } from "../helpers/database.mjs";
import { parseImport } from "../../lib/server/importer.ts";
import { BOOK_APP, parseCatalog } from "../../lib/domain.ts";
import {
  hasSession,
  signInWithGoogle,
  signOut,
} from "../../lib/server/auth.ts";
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

test("PostgreSQL writes, gifts, unknown prices, decimals, dates and options persist after restart", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "books-db-")), "books.sqlite");
  let store = await openStore(path);
  const result = await store.api.saveBook(await request());
  await store.api.saveBook(
    await request({ ...input, isbn: "", series: "No price", price: "" }),
  );
  await store.close();
  store = await openStore(path);
  try {
    const data = await store.api.getCollection(),
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
    await store.close();
  }
});

test("request receipts survive restart, reject mismatched reuse and commit atomically with writes", async () => {
  const path = join(
      mkdtempSync(join(tmpdir(), "books-retry-")),
      "books.sqlite",
    ),
    arg = await request();
  let store = await openStore(path);
  const result = await store.api.saveBook(arg);
  await store.close();
  store = await openStore(path);
  try {
    assert.deepEqual(await store.api.saveBook(arg), result);
    assert.equal((await store.api.getCollection()).books.length, 1);
    await assert.rejects(
      async () =>
        await store.api.saveBook({
          ...arg,
          book: { ...input, series: "Different" },
        }),
      /different change/,
    );
    await store.db.exec(
      "CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated write failure'; END $$; CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION fail_receipt();",
    );
    await assert.rejects(
      async () =>
        await store.api.saveBook(
          await request({ ...input, isbn: "", series: "Must roll back" }),
        ),
      /simulated/,
    );
    assert.equal((await store.api.getCollection()).books.length, 1);
    assert.ok(
      !(await store.api.getCollection()).options.series.includes(
        "Must roll back",
      ),
    );
  } finally {
    await store.close();
  }
});

test("equivalent ISBNs prevent duplicates, allow explicit copies and check ownership against current records", async () => {
  const store = await openStore();
  try {
    await store.api.saveBook(await request());
    await assert.rejects(
      async () =>
        await store.api.saveBook(
          await request({ ...input, isbn: "9780140328721" }),
        ),
      /already/,
    );
    await store.api.saveBook(
      await request(
        { ...input, isbn: "9780140328721" },
        { allowDuplicate: true },
      ),
    );
    await store.api.saveBook(
      await request({ ...input, isbn: "", series: "Unindexed" }),
    );
    const result = await store.api.checkOwnership("978-0-140-32872-1");
    assert.equal(result.matches.length, 2);
    assert.equal(result.unindexedCount, 1);
    assert.equal(result.totalCount, 3);
  } finally {
    await store.close();
  }
});

test("edits and ISBN-only saves reject stale versions and preserve every other field", async () => {
  const store = await openStore();
  try {
    await store.api.saveBook(await request({ ...input, isbn: "" }));
    const book = (await store.api.getCollection()).books[0],
      arg = {
        requestId: "isbn_request_0001",
        row: book.row,
        token: book.token,
        isbn: input.isbn,
      };
    await store.api.setBookIsbn(arg);
    const updated = (await store.api.getCollection()).books[0];
    for (const field of BOOK_APP.fields.filter((f) => f !== "isbn"))
      assert.equal(updated[field], book[field]);
    assert.notEqual(updated.token, book.token);
    assert.equal(updated.row, book.row);
    await assert.rejects(
      async () =>
        await store.api.saveBook(
          await request(input, { row: book.row, token: book.token }),
        ),
      /changed/,
    );
    assert.deepEqual(await store.api.setBookIsbn(arg), {
      row: book.row,
      isbn: input.isbn,
      action: "isbn saved",
    });
  } finally {
    await store.close();
  }
});

test("recoverable removal and restore are durable, idempotent, and never reuse another book ID", async () => {
  const store = await openStore();
  try {
    await store.api.saveBook(await request());
    const original = (await store.api.getCollection()).books[0];
    const arg = {
        requestId: "remove_request_001",
        row: original.row,
        token: original.token,
      },
      removed = await store.api.removeBook(arg);
    assert.deepEqual(await store.api.removeBook(arg), removed);
    assert.equal((await store.api.getCollection()).books.length, 0);
    assert.equal((await store.api.getCollection()).trash.length, 1);
    const added = await store.api.saveBook(
      await request({ ...input, isbn: "", series: "Another book" }),
    );
    assert.notEqual(added.row, original.row);
    const restore = {
        requestId: "restore_request_01",
        trashId: removed.trashId,
      },
      restored = await store.api.restoreBook(restore);
    assert.deepEqual(await store.api.restoreBook(restore), restored);
    assert.equal(restored.row, original.row);
    assert.equal((await store.api.getCollection()).books.length, 2);
    assert.equal((await store.api.getCollection()).trash.length, 0);
  } finally {
    await store.close();
  }
});

test("workbook migration preserves owned books, hidden helper tabs and literal notes without remote writes", async () => {
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
    store = await openStore();
  try {
    const imported = await store.importData(parsed, parsed.fingerprint),
      data = await store.api.getCollection();
    assert.equal(imported.books, 2);
    assert.equal(data.books[0].date, "2026-10-09");
    assert.equal(data.books[0].price, 0);
    assert.equal(data.books[1].price, "");
    assert.equal(data.trash.length, 1);
    assert.equal(data.savedReleases.length, 1);
    assert.equal((await store.savedSeriesCatalog(catalog)).url, catalog.url);
    assert.equal(data.books[0].note, input.note);
    assert.equal(
      (await store.importData(parsed, parsed.fingerprint)).alreadyImported,
      true,
    );
    assert.equal((await store.api.getCollection()).books.length, 2);
  } finally {
    await store.close();
  }
});

test("JSON backup restores removed books, saved releases, editions, duplicates and unused dropdown choices", async () => {
  const source = await openStore(),
    destination = await openStore();
  try {
    await source.api.saveBook(await request());
    await source.api.saveBook(await request(input, { allowDuplicate: true }));
    const book = (await source.api.getCollection()).books[0];
    await source.api.removeBook({
      requestId: "backup_remove_001",
      row: book.row,
      token: book.token,
    });
    await source.api.setSavedRelease({ release: release(), saved: true });
    await source.db
      .prepare("INSERT INTO options VALUES (?,?,app_user_id())")
      .run("source", "Unused shop");
    const parsed = parseImport(
      Buffer.from(JSON.stringify(await source.exportData())),
      "backup.json",
    );
    await destination.importData(parsed, parsed.fingerprint);
    assert.equal((await destination.api.getCollection()).books.length, 1);
    assert.equal((await destination.api.getCollection()).trash.length, 1);
    assert.equal(
      (await destination.api.getCollection()).savedReleases.length,
      1,
    );
    assert.ok(
      (await destination.api.getCollection()).options.source.includes(
        "Unused shop",
      ),
    );
    await assert.rejects(
      async () =>
        await destination.importData(
          plan([{ ...input, series: "Another import" }]),
          "different-source",
        ),
      /empty library/,
    );
    assert.equal((await destination.api.getCollection()).books.length, 1);
  } finally {
    await source.close();
    await destination.close();
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

test("Google sessions are hashed, bound to an identity, revocable and expiring", async () => {
  const store = await openStore();
  try {
    assert.equal(await hasSession(store, null), false);
    const identity = {
      sub: "google-owner",
      email: "owner@gmail.com",
      email_verified: true,
    };
    const login = await signInWithGoogle(store, identity, identity.email);
    assert.ok(login.token);
    assert.equal(await hasSession(store, login.token), true);
    assert.notEqual(
      (await store.db.prepare("SELECT token_hash FROM sessions").get())
        .token_hash,
      login.token,
    );
    await store.db.exec(
      "UPDATE users SET google_subject='changed-identity' WHERE id=1",
    );
    assert.equal(await hasSession(store, login.token), false);
    await store.db.exec(
      "UPDATE users SET google_subject='google-owner' WHERE id=1",
    );
    await signOut(store, login.token);
    assert.equal(await hasSession(store, login.token), false);
    const expired = await signInWithGoogle(store, identity);
    await store.db.exec("UPDATE sessions SET expires_at=0");
    assert.equal(await hasSession(store, expired.token), false);
  } finally {
    await store.close();
  }
});
