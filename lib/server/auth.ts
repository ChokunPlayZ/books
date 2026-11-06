import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "./store.ts";
import type { Store } from "./store.ts";
import type { User } from "./user-context.ts";

export const SESSION_COOKIE = "book_collection_session";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function passwordRequired(store?: Store) {
  return (
    !!store?.db
      .prepare("SELECT 1 FROM users WHERE password_hash<>'' LIMIT 1")
      .get() ||
    !!process.env.BOOKS_PASSWORD ||
    (process.env.NODE_ENV === "production" &&
      process.env.BOOKS_ALLOW_UNAUTHENTICATED !== "true")
  );
}
export function sessionUser(store: Store, token?: string): User | null {
  if (!passwordRequired(store))
    return { id: 1, username: "admin", role: "admin" };
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = store.db
    .prepare(
      `SELECT users.id,users.username,users.role,users.password_hash,sessions.credential_hash
       FROM sessions JOIN users ON users.id=sessions.user_id
       WHERE (token_hash=? OR token_hash=?) AND expires_at>?`,
    )
    .get(
      hash(token),
      hash(token + (process.env.BOOKS_PASSWORD || "")),
      Date.now(),
    );
  if (!row) return null;
  const credential =
    row.password_hash || (row.id === 1 ? process.env.BOOKS_PASSWORD : "");
  if (
    !credential ||
    (row.credential_hash && row.credential_hash !== hash(credential))
  )
    return null;
  return {
    id: Number(row.id),
    username: String(row.username),
    role: row.role as User["role"],
  };
}
export function hasSession(store: Store, token?: string) {
  return !!sessionUser(store, token);
}
export function authorize(store, request) {
  const token = request.cookies?.get(SESSION_COOKIE)?.value;
  const user = sessionUser(store, token);
  if (!user) throw new AppError("Sign in to open your library.", 401);
  return user;
}
export function createAccount(
  store: Store,
  username: string,
  password: string,
  role: User["role"] = "user",
) {
  store.requireAdmin();
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(username) ||
    !["user", "admin"].includes(role)
  )
    throw new AppError(
      "Use a username of 1–64 letters, numbers, dots, underscores or hyphens.",
    );
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  )
    throw new AppError("Use a password between 12 and 1,024 characters.");
  const salt = randomBytes(16).toString("hex");
  const encoded = salt + ":" + scryptSync(password, salt, 32).toString("hex");
  if (store.db.prepare("SELECT id FROM users WHERE username=?").get(username))
    throw new AppError("That username is already in use.", 409);
  const result = store.db
    .prepare(
      "INSERT INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)",
    )
    .run(username, encoded, role, new Date().toISOString());
  return { id: Number(result.lastInsertRowid), username, role };
}
export function signIn(
  store: Store,
  password: unknown,
  username: unknown = "admin",
) {
  if (
    !process.env.BOOKS_PASSWORD &&
    !store.db
      .prepare("SELECT 1 FROM users WHERE password_hash<>'' LIMIT 1")
      .get()
  )
    throw new AppError(
      "Set BOOKS_PASSWORD on the server before signing in.",
      503,
    );
  return store.transaction(() => {
    const name =
      typeof username === "string" ? username.trim().toLowerCase() : "";
    const attemptKey = "login:" + hash(name.slice(0, 64));
    const now = Date.now(),
      previous = store.db
        .prepare("SELECT * FROM login_attempts WHERE key=?")
        .get(attemptKey);
    if (
      previous &&
      Number(previous.resets_at) > now &&
      Number(previous.attempts) >= 10
    )
      return {
        error: new AppError("Too many attempts. Try again in 15 minutes.", 429),
      };
    if (typeof password !== "string" || password.length > 1024)
      return { error: new AppError("Incorrect password.", 401) };
    const user =
      name.length <= 64
        ? store.db.prepare("SELECT * FROM users WHERE username=?").get(name)
        : null;
    const credential = String(
      user?.password_hash ||
        (user?.id === 1 ? process.env.BOOKS_PASSWORD || "" : ""),
    );
    const [salt, expected] = user?.password_hash
      ? credential.split(":")
      : ["book-collection-login", ""];
    const actual = scryptSync(password, salt, 32);
    const target = expected
      ? Buffer.from(expected, "hex")
      : scryptSync(credential || "invalid-account", salt, 32);
    const correct =
      !!user &&
      !!credential &&
      target.length === actual.length &&
      timingSafeEqual(actual, target);
    if (!correct) {
      const attempts =
        previous && Number(previous.resets_at) > now
          ? Number(previous.attempts) + 1
          : 1;
      store.db
        .prepare(
          "INSERT INTO login_attempts VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts,resets_at=excluded.resets_at",
        )
        .run(
          attemptKey,
          attempts,
          previous && Number(previous.resets_at) > now
            ? previous.resets_at
            : now + 15 * 60 * 1000,
        );
      return { error: new AppError("Incorrect password.", 401) };
    }
    store.db.prepare("DELETE FROM login_attempts WHERE key=?").run(attemptKey);
    store.db.prepare("DELETE FROM sessions WHERE expires_at<?").run(now);
    const token = randomBytes(32).toString("hex");
    store.db
      .prepare(
        "INSERT INTO sessions (token_hash,expires_at,user_id,credential_hash) VALUES (?,?,?,?)",
      )
      .run(hash(token), now + 14 * 86400000, user.id, hash(credential));
    return { token };
  });
}
export function signOut(store, token) {
  if (token)
    store.db
      .prepare("DELETE FROM sessions WHERE token_hash=? OR token_hash=?")
      .run(hash(token), hash(token + (process.env.BOOKS_PASSWORD || "")));
}
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.BOOKS_SECURE_COOKIES
      ? process.env.BOOKS_SECURE_COOKIES === "true"
      : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 14 * 86400,
  };
}
