import { openStore } from "../lib/server/store.ts";
import { createAccount } from "../lib/server/auth.ts";
import { normalizeEmail } from "../lib/server/auth-config.ts";
import { configureEnvironment } from "./environment.mjs";

configureEnvironment();
const [username, rawEmail] = process.argv.slice(2);
const email = normalizeEmail(rawEmail);
if (!username || !email) {
  console.error(
    "Run: npm run user:add -- username google-email [--admin | --link]",
  );
  process.exit(1);
}
const store = await openStore();
try {
  if (process.argv.includes("--link")) {
    const user = await store.db
      .prepare(
        "SELECT id,google_subject FROM users WHERE lower(username)=lower(?)",
      )
      .get(username);
    if (!user) throw new Error("That existing username was not found.");
    if (user.google_subject)
      throw new Error(
        "This library is already linked. It cannot be reassigned by email.",
      );
    if (
      await store.db
        .prepare("SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?")
        .get(email, user.id)
    )
      throw new Error("That email is already assigned to another library.");
    await store.db
      .prepare("UPDATE users SET email=? WHERE id=?")
      .run(email, user.id);
    console.log(
      `Linked ${username} to ${email}. Sign in with Google to claim this library.`,
    );
  } else {
    const user = await createAccount(
      store,
      username,
      email,
      process.argv.includes("--admin") ? "admin" : "user",
    );
    console.log(
      `Created ${user.role} account: ${user.username}, reserved for ${email}. Its library starts empty.`,
    );
  }
} finally {
  await store.close();
}
