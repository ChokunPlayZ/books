import { randomBytes } from "node:crypto";
import { authHash } from "./auth.ts";
import { appOrigin, normalizeEmail } from "./auth-config.ts";
import { AppError, type Store } from "./store.ts";

export async function validateRelinkToken(store: Store, token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError("Invalid re-link invitation.", 400);
  const hash = authHash(token);
  const link = await store.db
    .prepare(
      `SELECT r.token_hash FROM account_relinks r JOIN users u ON u.id=r.user_id
    WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at>? AND u.disabled=false`,
    )
    .get(hash, Date.now());
  if (!link)
    throw new AppError(
      "This re-link invitation expired or was already used. Ask the administrator for a new link.",
      403,
    );
  return hash;
}

export function createAccountRelinks(store: Store) {
  async function createAccountRelink(request: {
    userId: number;
    email: string;
  }) {
    store.requireAdmin();
    const email = normalizeEmail(request?.email);
    if (!Number.isSafeInteger(request?.userId) || !email)
      throw new AppError(
        "Choose an account and a valid destination Google email.",
      );
    const origin = appOrigin();
    return store.transaction(async () => {
      const user = await store.db
        .prepare(
          "SELECT google_subject,disabled FROM users WHERE id=? FOR UPDATE",
        )
        .get(request.userId);
      if (!user || user.disabled)
        throw new AppError("Choose an active account.", 404);
      if (
        await store.db
          .prepare("SELECT id FROM users WHERE id<>? AND lower(email)=?")
          .get(request.userId, email)
      )
        throw new AppError(
          "This email already belongs to another library.",
          409,
        );
      const token = randomBytes(32).toString("hex"),
        now = Date.now(),
        expiresAt = now + 24 * 3600_000;
      await store.db
        .prepare("DELETE FROM account_relinks WHERE user_id=? OR expires_at<=?")
        .run(request.userId, now);
      await store.db
        .prepare(
          `INSERT INTO account_relinks(token_hash,user_id,destination_email,credential_hash,created_by,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          authHash(token),
          request.userId,
          email,
          authHash("google:" + (user.google_subject || "")),
          store.currentUser().id,
          now,
          expiresAt,
        );
      await store.db
        .prepare(
          "INSERT INTO admin_events(actor_id,user_id,action,created_at) VALUES (?,?,'relink-created',?)",
        )
        .run(store.currentUser().id, request.userId, now);
      // A fragment is not sent to the server in a URL, access log or Referer.
      return { url: origin + "/relink#token=" + token, expiresAt, email };
    });
  }
  async function revokeAccountRelinks(request: { userId: number }) {
    store.requireAdmin();
    if (!Number.isSafeInteger(request?.userId))
      throw new AppError("Choose an account.");
    await store.db
      .prepare("DELETE FROM account_relinks WHERE user_id=?")
      .run(request.userId);
    return { revoked: true };
  }
  return { createAccountRelink, revokeAccountRelinks };
}
