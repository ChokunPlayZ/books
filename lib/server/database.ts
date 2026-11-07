import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient } from "pg";
import { migrateDatabase } from "./schema.ts";

export type DatabaseValue = string | number | boolean | Uint8Array | null;

export async function openDatabase(
  connectionString: string,
  currentUserId: () => number,
) {
  if (!/^postgres(?:ql)?:\/\//.test(connectionString || ""))
    throw new Error("Set DATABASE_URL to a PostgreSQL connection URL.");
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    // Epoch milliseconds and COUNT(*) must remain numbers, not string values.
    types: {
      getTypeParser(oid, format) {
        if (oid === types.builtins.INT8 && format !== "binary")
          return (value: string) => {
            const number = Number(value);
            if (!Number.isSafeInteger(number))
              throw new Error(
                "Database integer exceeds JavaScript's safe range.",
              );
            return number;
          };
        return types.getTypeParser(oid, format);
      },
    },
  });
  pool.on("error", (error) => console.error("PostgreSQL pool error:", error));
  const context = new AsyncLocalStorage<PoolClient>();
  try {
    await migrateDatabase(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }

  // Keep SQL values (including request identity) parameterized. Quoted SQL
  // literals are left untouched; no user data is interpolated into SQL.
  function bind(sql: string, args: DatabaseValue[]) {
    const values: DatabaseValue[] = [];
    let index = 0;
    const text = sql.replace(
      /'(?:''|[^'])*'|"(?:""|[^"])*"|\?|app_user_id\(\)/g,
      (token) => {
        if (token !== "?" && token !== "app_user_id()") return token;
        values.push(token === "?" ? args[index++] : currentUserId());
        return "$" + values.length;
      },
    );
    if (index !== args.length)
      throw new Error("Incorrect number of database parameters.");
    return { text, values };
  }
  const query = (sql: string, values: DatabaseValue[] = []) =>
    (context.getStore() ?? pool).query(sql, values);

  return {
    query,
    exec: (sql: string) => query(sql),
    prepare(sql: string) {
      const execute = (...args: DatabaseValue[]) => {
        const { text, values } = bind(sql, args);
        return query(text, values);
      };
      return {
        async all(...args: DatabaseValue[]) {
          return (await execute(...args)).rows;
        },
        async get(...args: DatabaseValue[]) {
          return (await execute(...args)).rows[0];
        },
        async run(...args: DatabaseValue[]) {
          const result = await execute(...args);
          return {
            changes: result.rowCount ?? 0,
            lastInsertRowid: result.rows[0]?.id as number | undefined,
          };
        },
      };
    },
    async transaction<T>(
      action: () => T | Promise<T>,
      snapshot = false,
    ): Promise<T> {
      if (context.getStore()) return action();
      const client = await pool.connect();
      try {
        await client.query(
          snapshot ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN",
        );
        // Serialize each account's read/check/write operations across pools and
        // app instances: receipts, duplicate checks and revision tokens stay atomic.
        await client.query("SELECT pg_advisory_xact_lock(726004, $1)", [
          currentUserId(),
        ]);
        const result = await context.run(client, action);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
