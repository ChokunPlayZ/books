import { createHash, randomBytes } from "node:crypto";
import { AppError } from "./store.ts";
import type { Store } from "./store.ts";
import type { User } from "./user-context.ts";
import { appOrigin, normalizeEmail } from "./auth-config.ts";
import { googleProfilePicture } from "../domain/profile-picture.ts";

// __Host- cookies cannot be planted for this host by sibling subdomains.
export const SESSION_COOKIE = process.env.BOOKS_APP_URL?.trim()
  .toLowerCase()
  .startsWith("https:")
  ? "__Host-book_collection_session"
  : "book_collection_session";
export const SESSION_SECONDS = 14 * 86400;
export const authHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function sessionUser(
  store: Store,
  token?: string,
): Promise<User | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await store.db
    .prepare(
      `
    SELECT users.id,users.username,users.role,users.google_subject,sessions.credential_hash
    FROM sessions JOIN users ON users.id=sessions.user_id
    WHERE token_hash=? AND expires_at>? AND users.disabled=false
  `,
    )
    .get(authHash(token), Date.now());
  if (
    !row?.google_subject ||
    row.credential_hash !== authHash("google:" + row.google_subject)
  )
    return null;
  return {
    id: Number(row.id),
    username: String(row.username),
    role: row.role as User["role"],
  };
}

export async function hasSession(store: Store, token?: string | null) {
  return !!(await sessionUser(store, token ?? undefined));
}

export async function authorize(
  store: Store,
  request: { cookies?: { get(name: string): { value: string } | undefined } },
) {
  const user = await sessionUser(
    store,
    request.cookies?.get(SESSION_COOKIE)?.value,
  );
  if (!user) throw new AppError("Sign in to open your library.", 401);
  return user;
}

// Server-side provisioning only. A verified Google email can claim this mapping
// once; subsequent sign-ins are bound to Google's immutable subject, not email.
export async function createAccount(
  store: Store,
  username: string,
  rawEmail: string,
  role: User["role"] = "user",
) {
  store.requireAdmin();
  const email = normalizeEmail(rawEmail);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(username) ||
    !["user", "admin"].includes(role)
  )
    throw new AppError(
      "Use a username of 1–64 letters, numbers, dots, underscores or hyphens.",
    );
  if (!email) throw new AppError("Use a valid Google email address.");
  return store.transaction(async () => {
    if (
      await store.db
        .prepare(
          "SELECT id FROM users WHERE lower(username)=lower(?) OR lower(email)=lower(?)",
        )
        .get(username, email)
    )
      throw new AppError("That username or email is already in use.", 409);
    const result = await store.db
      .prepare(
        "INSERT INTO users (username,email,role,created_at) VALUES (?,?,?,?) RETURNING id",
      )
      .run(username, email, role, new Date().toISOString());
    return { id: Number(result.lastInsertRowid), username, role };
  });
}

export type GoogleIdentity = {
  sub: string;
  email: string;
  email_verified: boolean;
  hd?: string;
  picture?: string;
};

// Only call with claims validated by the OIDC client (issuer, audience,
// signature, expiry and nonce). No HTTP endpoint accepts identity claims.
export async function signInWithGoogle(
  store: Store,
  identity: GoogleIdentity,
  adminEmail = process.env.BOOKS_ADMIN_EMAIL,
  relinkHash?: string,
) {
  const email = normalizeEmail(identity.email);
  if (
    !email ||
    identity.email_verified !== true ||
    typeof identity.sub !== "string" ||
    !/^[\x21-\x7e]{1,255}$/.test(identity.sub)
  )
    throw new AppError(
      "Use a Google account with a verified email address.",
      403,
    );
  return store.transaction(async () => {
    if (relinkHash) {
      const link = await store.db
        .prepare("SELECT * FROM account_relinks WHERE token_hash=? FOR UPDATE")
        .get(relinkHash);
      if (!link || link.used_at !== null || link.expires_at <= Date.now())
        throw new AppError(
          "This re-link invitation expired or was already used. Ask the administrator for a new link.",
          403,
        );
      const target = await store.db
        .prepare("SELECT * FROM users WHERE id=? FOR UPDATE")
        .get(link.user_id);
      if (
        !target ||
        target.disabled ||
        link.credential_hash !==
          authHash("google:" + (target.google_subject || ""))
      )
        throw new AppError("This re-link invitation is no longer valid.", 403);
      if (email !== link.destination_email)
        throw new AppError(
          "Choose the Google account specified in your re-link invitation.",
          403,
        );
      if (
        !email.endsWith("@gmail.com") &&
        identity.hd?.toLowerCase() !== email.split("@")[1]
      )
        throw new AppError(
          "Use a Gmail or Google Workspace account to link an existing library.",
          403,
        );
      const conflict = await store.db
        .prepare(
          "SELECT id FROM users WHERE id<>? AND (google_subject=? OR lower(email)=?)",
        )
        .get(target.id, identity.sub, email);
      if (conflict)
        throw new AppError(
          "This Google account already has a library. Libraries are never merged by a re-link invitation.",
          409,
        );
      await store.db
        .prepare("UPDATE users SET google_subject=?,email=? WHERE id=?")
        .run(identity.sub, email, target.id);
      await store.db
        .prepare("DELETE FROM sessions WHERE user_id=?")
        .run(target.id);
      await store.db
        .prepare(
          "UPDATE account_relinks SET used_at=? WHERE user_id=? AND used_at IS NULL",
        )
        .run(Date.now(), target.id);
      await store.db
        .prepare(
          "INSERT INTO admin_events(actor_id,user_id,action,created_at) VALUES (?,?,'account-relinked',?)",
        )
        .run(link.created_by, target.id, Date.now());
    }
    let user = await store.db
      .prepare("SELECT * FROM users WHERE google_subject=?")
      .get(identity.sub);
    if (user?.disabled)
      throw new AppError(
        "This account is disabled. Contact the administrator.",
        403,
      );
    const reserved = await store.db
      .prepare("SELECT * FROM users WHERE lower(email)=lower(?)")
      .get(email);
    if (user && reserved && reserved.id !== user.id)
      throw new AppError(
        "This Google email is already assigned to another library. Contact the administrator.",
        409,
      );
    if (!user) {
      const admin = await store.db
        .prepare("SELECT * FROM users WHERE id=1")
        .get();
      const target =
        reserved ||
        (email === normalizeEmail(adminEmail) && !admin.google_subject
          ? admin
          : null);
      if (target) {
        if (target.disabled)
          throw new AppError(
            "This account is disabled. Contact the administrator.",
            403,
          );
        if (target.google_subject)
          throw new AppError(
            "This library is already linked to a different Google account.",
            403,
          );
        // Google is authoritative for Gmail and verified Workspace domains, but
        // not for arbitrary third-party email addresses attached to Google.
        if (
          !email.endsWith("@gmail.com") &&
          (!identity.hd || identity.hd.toLowerCase() !== email.split("@")[1])
        )
          throw new AppError(
            "Use a Gmail or Google Workspace account to link an existing library.",
            403,
          );
        await store.db
          .prepare("UPDATE users SET google_subject=?,email=? WHERE id=?")
          .run(identity.sub, email, target.id);
        user = target;
      } else {
        // An old email may still be another account's display username after an
        // email change. Never merge identities or let that collision block signup.
        const username = (await store.db
          .prepare("SELECT id FROM users WHERE lower(username)=lower(?)")
          .get(email))
          ? "google-" + authHash(identity.sub).slice(0, 32)
          : email;
        const result = await store.db
          .prepare(
            "INSERT INTO users (username,email,google_subject,role,created_at) VALUES (?,?,?,'user',?) RETURNING id",
          )
          .run(username, email, identity.sub, new Date().toISOString());
        user = { id: result.lastInsertRowid, username, role: "user" };
      }
    } else {
      await store.db
        .prepare("UPDATE users SET email=? WHERE id=?")
        .run(email, user.id);
    }
    await store.db
      .prepare("UPDATE users SET picture=? WHERE id=?")
      .run(googleProfilePicture(identity.picture), user.id);
    const now = Date.now();
    await store.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
    // Bound the number of active sessions per account.
    await store.db
      .prepare(
        "DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 9)",
      )
      .run(user.id, user.id);
    const token = randomBytes(32).toString("hex");
    await store.db
      .prepare(
        "INSERT INTO sessions (token_hash,expires_at,user_id,credential_hash) VALUES (?,?,?,?)",
      )
      .run(
        authHash(token),
        now + SESSION_SECONDS * 1000,
        user.id,
        authHash("google:" + identity.sub),
      );
    return {
      token,
      user: {
        id: Number(user.id),
        username: String(user.username),
        role: user.role as User["role"],
      },
    };
  });
}

export async function signOut(store: Store, token?: string) {
  if (token && /^[a-f0-9]{64}$/.test(token))
    await store.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(authHash(token));
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.BOOKS_APP_URL
      ? appOrigin().startsWith("https:")
      : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}
