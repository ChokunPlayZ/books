import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { openStore } from "../../lib/server/store.ts";

const schemas = new Set();
const named = new Map();
let pool;

// Always require a dedicated test database, never fall back to DATABASE_URL.
export async function testDatabaseUrl(key) {
  if (key && named.has(key)) return named.get(key);
  const connectionString = process.env.BOOKS_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "Set BOOKS_TEST_DATABASE_URL to a dedicated PostgreSQL test database.",
    );
  pool ??= new Pool({ connectionString, allowExitOnIdle: true });
  const schema = "books_test_" + randomUUID().replaceAll("-", "");
  await pool.query(`CREATE SCHEMA "${schema}"`);
  schemas.add(schema);
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const value = url.href;
  if (key) named.set(key, value);
  return value;
}

export async function openTestStore(key) {
  return openStore(await testDatabaseUrl(key));
}

// Pools in individual stores are explicitly closed by tests. Once Node has no
// work left, remove only the random schemas created by this process.
process.once("beforeExit", async () => {
  if (!pool) return;
  for (const schema of schemas)
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
});
