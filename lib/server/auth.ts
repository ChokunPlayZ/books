import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "./store.ts";

export const SESSION_COOKIE = "book_collection_session";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function passwordRequired() {
  return (
    !!process.env.BOOKS_PASSWORD ||
    (process.env.NODE_ENV === "production" &&
      process.env.BOOKS_ALLOW_UNAUTHENTICATED !== "true")
  );
}
export function hasSession(store, token) {
  if (!passwordRequired()) return true;
  if (!process.env.BOOKS_PASSWORD || !token || !/^[a-f0-9]{64}$/.test(token))
    return false;
  // Changing the configured password invalidates every old session.
  return !!store.db
    .prepare(
      "SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?",
    )
    .get(hash(token + process.env.BOOKS_PASSWORD), Date.now());
}
export function authorize(store, request) {
  const token = request.cookies?.get(SESSION_COOKIE)?.value;
  if (!hasSession(store, token))
    throw new AppError("Sign in to open your library.", 401);
}
export function signIn(store, password) {
  if (!process.env.BOOKS_PASSWORD)
    throw new AppError(
      "Set BOOKS_PASSWORD on the server before signing in.",
      503,
    );
  return store.transaction(() => {
    const now = Date.now(),
      previous = store.db
        .prepare("SELECT * FROM login_attempts WHERE key=?")
        .get("library");
    if (previous && previous.resets_at > now && previous.attempts >= 10)
      return {
        error: new AppError("Too many attempts. Try again in 15 minutes.", 429),
      };
    if (typeof password !== "string" || password.length > 1024)
      return { error: new AppError("Incorrect password.", 401) };
    const correct = timingSafeEqual(
      scryptSync(password, "book-collection-login", 32),
      scryptSync(process.env.BOOKS_PASSWORD, "book-collection-login", 32),
    );
    if (!correct) {
      const attempts =
        previous && previous.resets_at > now ? previous.attempts + 1 : 1;
      store.db
        .prepare(
          "INSERT INTO login_attempts VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts,resets_at=excluded.resets_at",
        )
        .run(
          "library",
          attempts,
          previous && previous.resets_at > now
            ? previous.resets_at
            : now + 15 * 60 * 1000,
        );
      return { error: new AppError("Incorrect password.", 401) };
    }
    store.db.prepare("DELETE FROM login_attempts WHERE key=?").run("library");
    store.db.prepare("DELETE FROM sessions WHERE expires_at<?").run(now);
    const token = randomBytes(32).toString("hex");
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?)")
      .run(hash(token + process.env.BOOKS_PASSWORD), now + 14 * 86400000);
    return { token };
  });
}
export function signOut(store, token) {
  if (token)
    store.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(hash(token + (process.env.BOOKS_PASSWORD || "")));
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
