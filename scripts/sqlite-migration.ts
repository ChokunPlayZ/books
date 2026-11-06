import { DatabaseSync } from "node:sqlite";
import { openStore } from "../lib/server/store.ts";

const tables = [
  "users",
  "covers",
  "cover_sources",
  "books",
  "receipts",
  "saved_releases",
  "series_catalogs",
  "options",
  "cache",
  "imports",
  "sessions",
  "login_attempts",
  "oauth_attempts",
  "request_limits",
  "cover_access",
  "user_cover_sources",
] as const;

export async function migrateSqlite(path: string, connectionString?: string) {
  // Opening read-only also prevents a typo from silently creating an empty file.
  const source = new DatabaseSync(path, { readOnly: true });
  let destination: Awaited<ReturnType<typeof openStore>> | undefined;
  try {
    source.exec("BEGIN");
    const version = Number(
      source.prepare("PRAGMA user_version").get()!.user_version,
    );
    if (version < 5 || version > 7)
      throw new Error(
        "Migration supports SQLite schema versions 5–7. Upgrade older databases with the previous app first.",
      );
    destination = await openStore(connectionString);
    const db = destination.db;
    return await destination.transaction(async () => {
      // Stop the old app before migrating. These locks also prevent PostgreSQL
      // writers from racing the empty-target check or observing a partial copy.
      await db.exec(`LOCK TABLE ${tables.join(",")} IN ACCESS EXCLUSIVE MODE`);
      for (const table of tables) {
        const { rows } = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
        if (rows[0].n !== (table === "users" ? 1 : 0))
          throw new Error(
            "Migration requires an empty PostgreSQL database. Existing data was not changed.",
          );
      }
      const admin = await db.prepare("SELECT * FROM users WHERE id=1").get();
      if (
        !admin ||
        admin.username !== "admin" ||
        admin.google_subject ||
        admin.email ||
        admin.locale !== "en" ||
        admin.theme !== "system"
      )
        throw new Error(
          "Migration requires an unclaimed, empty PostgreSQL database.",
        );
      await db.exec("DELETE FROM users");
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const exists = source
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table);
        if (!exists || (table === "sessions" && version < 6)) continue;
        const { rows: columns } = await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",
          [table],
        );
        const available = new Set(
          source
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((column) => column.name),
        );
        const names = columns
          .map((column) => String(column.column_name))
          .filter((name) => available.has(name));
        const sql = `INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(",")}) VALUES (${names.map((_, index) => "$" + (index + 1)).join(",")})`;
        const rows = source.prepare(`SELECT * FROM ${table}`).iterate();
        counts[table] = 0;
        for (const row of rows) {
          const values = names.map((name) => {
            if (name === "password_hash") return "";
            const value = row[name];
            return value instanceof Uint8Array ? Buffer.from(value) : value;
          });
          await db.query(sql, values as (string | number | Buffer | null)[]);
          counts[table]++;
        }
      }
      for (const table of ["users", "books"])
        await db.query(
          `SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM ${table}`,
        );
      return counts;
    });
  } finally {
    source.close();
    await destination?.close();
  }
}
