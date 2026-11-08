import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../lib/server/store.ts";
import { migrateSqlite } from "../../scripts/sqlite-migration.ts";
import {
  createAccount,
  signInWithGoogle,
  sessionUser,
} from "../../lib/server/auth.ts";
import { testDatabaseUrl } from "../helpers/database.mjs";

// Build legacy fixtures from real records with SQLite's historical storage types.
async function sqliteFixture(store, path, version) {
  const source = new DatabaseSync(path);
  try {
    const { rows: tables } = await store.db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name<>'schema_migrations'",
    );
    for (const { table_name: table } of tables) {
      // The durable queue was introduced after SQLite support ended.
      if (
        table.startsWith("scrape_") ||
        table.startsWith("publisher_") ||
        ["account_relinks", "admin_events"].includes(table)
      )
        continue;
      if (version < 6 && ["oauth_attempts", "request_limits"].includes(table))
        continue;
      const { rows: columns } = await store.db.query(
        "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",
        [table],
      );
      const included = columns.filter(
        ({ column_name }) =>
          !["disabled", "relink_hash"].includes(column_name) &&
          !(version < 7 && ["locale", "theme"].includes(column_name)) &&
          !(version < 6 && ["google_subject", "email"].includes(column_name)),
      );
      source.exec(
        `CREATE TABLE ${table} (${included.map(({ column_name, data_type }) => `"${column_name}" ${data_type === "bytea" ? "BLOB" : data_type === "double precision" ? "REAL" : /int/.test(data_type) ? "INTEGER" : "TEXT"}`).join(",")})`,
      );
      const { rows } = await store.db.query(`SELECT * FROM ${table}`);
      const insert = source.prepare(
        `INSERT INTO ${table} VALUES (${included.map(() => "?").join(",")})`,
      );
      for (const row of rows)
        insert.run(...included.map(({ column_name }) => row[column_name]));
    }
    source.exec(`PRAGMA user_version=${version}`);
  } finally {
    source.close();
  }
}

for (const version of [5, 6, 7]) {
  test(`SQLite v${version} migrates accounts, library data, binary covers and identity sequences without modifying the source`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "books-pg-migration-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = await openStore(await testDatabaseUrl());
    const targetUrl = await testDatabaseUrl();
    const target = await openStore(targetUrl);
    t.after(async () => {
      await source.close();
      await target.close();
    });
    const account = await createAccount(source, "reader", "reader@gmail.com");
    const login = await signInWithGoogle(source, {
      sub: "reader-google",
      email: "reader@gmail.com",
      email_verified: true,
    });
    const body = Buffer.from([0, 1, 127, 128, 255]);
    await source.forUser(account, async () => {
      const image = await source.covers.put({ body, contentType: "image/png" });
      await source.api.saveBook({
        requestId: "migration_book_001",
        book: {
          series: "Private shelf",
          type: "Manga",
          status: "Read",
          price: 0,
          volume: 1.5,
          note: "ไทย",
          coverId: image.id,
        },
      });
      await source.preferences.update({ locale: "th", theme: "dark" });
    });
    await source.cache.put("migration-cache", "retained", Infinity);
    const file = join(directory, "books.sqlite");
    await sqliteFixture(source, file, version);
    const before = readFileSync(file);
    const counts = await migrateSqlite(file, targetUrl);
    assert.deepEqual(readFileSync(file), before);
    assert.equal(counts.users, 2);
    assert.equal(counts.books, 1);
    await target.forUser(account, async () => {
      const data = await target.api.getCollection();
      assert.equal(data.books[0].note, "ไทย");
      assert.equal(data.books[0].price, 0);
      assert.equal(data.books[0].volume, 1.5);
      assert.deepEqual(
        (await target.covers.get(data.books[0].coverId)).body,
        body,
      );
      assert.deepEqual(
        await target.preferences.get(),
        version === 7
          ? { locale: "th", theme: "dark" }
          : { locale: "en", theme: "system" },
      );
      const saved = await target.api.saveBook({
        requestId: "after_migration_001",
        book: { series: "New volume", type: "Manga", status: "Read" },
      });
      assert.ok(saved.row > data.books[0].row);
    });
    assert.equal(await target.cache.get("migration-cache"), "retained");
    assert.equal(
      (await sessionUser(target, login.token))?.id ?? null,
      version < 6 ? null : account.id,
    );
    assert.ok(
      (await createAccount(target, "next-reader", "next-reader@gmail.com")).id >
        account.id,
    );
    await assert.rejects(migrateSqlite(file, targetUrl), /empty PostgreSQL/);
    assert.deepEqual(readFileSync(file), before);
  });
}

test("a failed SQLite copy rolls back all PostgreSQL changes", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "books-pg-rollback-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "books.sqlite");
  const source = new DatabaseSync(file);
  source.exec(`
    CREATE TABLE users (id INTEGER, username TEXT, role TEXT, created_at TEXT);
    INSERT INTO users VALUES (1,'legacy-owner','admin','2026-01-01');
    CREATE TABLE books (id INTEGER, series TEXT, user_id INTEGER);
    INSERT INTO books VALUES (1,'Invalid ownership',999);
    PRAGMA user_version=7;
  `);
  source.close();
  const before = readFileSync(file);
  const url = await testDatabaseUrl();
  const target = await openStore(url);
  t.after(() => target.close());
  await assert.rejects(migrateSqlite(file, url), /foreign key/);
  assert.equal(
    (await target.db.prepare("SELECT username FROM users WHERE id=1").get())
      .username,
    "admin",
  );
  assert.equal((await target.api.getCollection()).books.length, 0);
  assert.deepEqual(readFileSync(file), before);
});
