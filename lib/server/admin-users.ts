import type { AdminUser, AdminUsers, AdminLibrary } from "../admin-users.ts";
import { createAccount } from "./auth.ts";
import { createAccountRelinks } from "./account-relink.ts";
import { AppError, type Store } from "./store.ts";

const projection = `SELECT id,username,email,role,disabled,(google_subject IS NOT NULL) AS linked,
  created_at AS "createdAt",locale,theme,
  (SELECT COUNT(*) FROM books b WHERE b.user_id=u.id AND removed_at IS NULL) AS books,
  (SELECT COUNT(*) FROM books b WHERE b.user_id=u.id AND removed_at IS NOT NULL) AS removed,
  (SELECT COUNT(*) FROM saved_releases s WHERE s.user_id=u.id) AS "savedReleases",
  (SELECT COUNT(*) FROM series_catalogs s WHERE s.user_id=u.id) AS catalogs,
  (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND expires_at>?) AS sessions FROM users u`;
export function createAdminUsers(store: Store) {
  async function getAdminUsers(
    request: { search?: string; page?: number } = {},
  ): Promise<AdminUsers> {
    store.requireAdmin();
    if (!request || typeof request !== "object")
      throw new AppError("Choose account filters.");
    const search = String(request.search || "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const where =
      "WHERE (?='' OR strpos(lower(username || ' ' || email || ' ' || id::text),?)>0)";
    const { count } = await store.db
      .prepare("SELECT COUNT(*) AS count FROM users " + where)
      .get(search, search);
    const pages = Math.max(1, Math.ceil(count / 20)),
      page = Math.min(
        pages,
        Math.max(1, Number.isSafeInteger(request.page) ? request.page : 1),
      );
    const users = await store.db
      .prepare(
        projection +
          " " +
          where +
          " ORDER BY lower(username),id LIMIT 20 OFFSET ?",
      )
      .all(Date.now(), search, search, (page - 1) * 20);
    return { users: users as AdminUser[], total: count, page, pages };
  }
  async function getAdminUserLibrary(request: {
    userId: number;
    confirmed: boolean;
    resource?: string;
    search?: string;
    page?: number;
  }): Promise<AdminLibrary> {
    store.requireAdmin();
    if (!Number.isSafeInteger(request?.userId) || request.confirmed !== true)
      throw new AppError("Confirm before loading a private library.", 403);
    const resource = request.resource || "books";
    if (!["books", "saved_releases", "series_catalogs"].includes(resource))
      throw new AppError("Choose a library category.");
    if (
      !(await store.db
        .prepare("SELECT id FROM users WHERE id=?")
        .get(request.userId))
    )
      throw new AppError("Account not found.", 404);
    const search = String(request.search || "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const from = `FROM ${resource} record WHERE user_id=? AND (?='' OR strpos(lower(to_jsonb(record)::text),?)>0)`;
    const { count } = await store.db
      .prepare("SELECT COUNT(*) AS count " + from)
      .get(request.userId, search, search);
    const pages = Math.max(1, Math.ceil(count / 20)),
      page = Math.min(
        pages,
        Math.max(1, Number.isSafeInteger(request.page) ? request.page : 1),
      );
    const rows = await store.db
      .prepare(
        "SELECT * " +
          from +
          " ORDER BY to_jsonb(record)::text LIMIT 20 OFFSET ?",
      )
      .all(request.userId, search, search, (page - 1) * 20);
    await store.db
      .prepare(
        "INSERT INTO admin_events(actor_id,user_id,action,created_at) VALUES (?,?,'library-viewed',?)",
      )
      .run(store.currentUser().id, request.userId, Date.now());
    return { rows, total: count, page, pages };
  }
  async function manageAdminUser(request: {
    userId: number;
    action: "rename" | "role" | "disable" | "enable" | "revoke-sessions";
    value?: string;
  }) {
    store.requireAdmin();
    if (
      !Number.isSafeInteger(request?.userId) ||
      !["rename", "role", "disable", "enable", "revoke-sessions"].includes(
        request.action,
      )
    )
      throw new AppError("Choose an account action.");
    return store.transaction(async () => {
      await store.db.query("SELECT pg_advisory_xact_lock(726006::bigint)");
      const user = await store.db
        .prepare("SELECT * FROM users WHERE id=? FOR UPDATE")
        .get(request.userId);
      if (!user) throw new AppError("Account not found.", 404);
      if (request.action === "rename") {
        if (
          typeof request.value !== "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_.@+-]{0,253}$/.test(request.value)
        )
          throw new AppError("Enter a valid account name.");
        if (
          await store.db
            .prepare(
              "SELECT id FROM users WHERE id<>? AND lower(username)=lower(?)",
            )
            .get(user.id, request.value)
        )
          throw new AppError("That account name is already in use.", 409);
        await store.db
          .prepare("UPDATE users SET username=? WHERE id=?")
          .run(request.value, user.id);
      } else if (request.action === "role" || request.action === "disable") {
        if (
          request.action === "role" &&
          !["admin", "user"].includes(request.value)
        )
          throw new AppError("Choose an account role.");
        if (user.id === store.currentUser().id)
          throw new AppError(
            "You cannot disable or change your own administrator role.",
            409,
          );
        if (
          user.role === "admin" &&
          (request.action === "disable" || request.value === "user")
        ) {
          const { count } = await store.db
            .prepare(
              "SELECT COUNT(*) AS count FROM users WHERE role='admin' AND disabled=false AND id<>?",
            )
            .get(user.id);
          if (!count)
            throw new AppError("Keep at least one active administrator.", 409);
        }
        await store.db
          .prepare(
            request.action === "disable"
              ? "UPDATE users SET disabled=true WHERE id=?"
              : "UPDATE users SET role=? WHERE id=?",
          )
          .run(
            ...(request.action === "disable"
              ? [user.id]
              : [request.value, user.id]),
          );
        await store.db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(user.id);
        await store.db
          .prepare("DELETE FROM account_relinks WHERE user_id=?")
          .run(user.id);
      } else if (request.action === "enable") {
        await store.db
          .prepare("UPDATE users SET disabled=false WHERE id=?")
          .run(user.id);
      } else
        await store.db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(user.id);
      await store.db
        .prepare(
          "INSERT INTO admin_events(actor_id,user_id,action,created_at) VALUES (?,?,?,?)",
        )
        .run(store.currentUser().id, user.id, request.action, Date.now());
      return { updated: true };
    });
  }
  return {
    getAdminUsers,
    getAdminUserLibrary,
    manageAdminUser,
    createAdminUser: (request: { username: string; email: string }) =>
      createAccount(store, request?.username, request?.email),
    ...createAccountRelinks(store),
  };
}
