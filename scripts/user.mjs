import { openStore } from "../lib/server/store.ts";
import { createAccount } from "../lib/server/auth.ts";
import { configureEnvironment } from "./environment.mjs";

configureEnvironment();
const username = process.argv[2];
const password = process.env.BOOKS_NEW_USER_PASSWORD;
if (!username || !password) {
  console.error(
    "Set BOOKS_NEW_USER_PASSWORD, then run: npm run user:add -- username [--admin]",
  );
  process.exit(1);
}
const store = openStore();
try {
  if (
    !process.env.BOOKS_PASSWORD &&
    !store.db
      .prepare("SELECT 1 FROM users WHERE id=1 AND password_hash<>''")
      .get()
  )
    throw new Error(
      "Set BOOKS_PASSWORD for the existing admin library before enabling multiple users.",
    );
  const user = createAccount(
    store,
    username,
    password,
    process.argv.includes("--admin") ? "admin" : "user",
  );
  console.log(
    `Created ${user.role} account: ${user.username}. Its library starts empty.`,
  );
} finally {
  store.close();
}
