import {
  SYSTEM_RESOURCES,
  PRIVATE_SYSTEM_RESOURCES,
  type SystemResource,
  type SystemRecords,
  type SystemOverview,
} from "../admin.ts";
import { AppError, type Store } from "./store.ts";

// Only these read-only projections are inspectable. No password hashes, Google
// subjects, OAuth handshakes, session tokens or binary image bodies leave the DAL.
const projections: Record<SystemResource, string> = {
  users: `SELECT id,username,email,role,created_at,locale,theme,
    (SELECT COUNT(*) FROM sessions s WHERE s.user_id=users.id) AS session_records FROM users`,
  books: "SELECT b.*,u.username FROM books b JOIN users u ON u.id=b.user_id",
  saved_releases:
    "SELECT s.*,u.username FROM saved_releases s JOIN users u ON u.id=s.user_id",
  series_catalogs:
    "SELECT s.*,u.username FROM series_catalogs s JOIN users u ON u.id=s.user_id",
  covers:
    "SELECT id,content_type,octet_length(body) AS bytes,created_at FROM covers",
  cover_sources: "SELECT url,cover_id FROM cover_sources",
  user_cover_sources:
    "SELECT s.*,u.username FROM user_cover_sources s JOIN users u ON u.id=s.user_id",
  cover_access:
    "SELECT s.*,u.username FROM cover_access s JOIN users u ON u.id=s.user_id",
  options:
    "SELECT s.*,u.username FROM options s JOIN users u ON u.id=s.user_id",
  imports:
    "SELECT s.*,u.username FROM imports s JOIN users u ON u.id=s.user_id",
  receipts:
    "SELECT s.*,u.username FROM receipts s JOIN users u ON u.id=s.user_id",
  admin_events:
    "SELECT e.id,e.action,e.created_at,u.username,a.username AS administrator FROM admin_events e JOIN users u ON u.id=e.user_id JOIN users a ON a.id=e.actor_id",
};

export function createAdminService(store: Store) {
  async function getSystemOverview(): Promise<SystemOverview> {
    store.requireAdmin();
    const counts = Object.fromEntries(
      await Promise.all(
        [...Object.keys(SYSTEM_RESOURCES), "cache", "sessions"].map(
          async (table) => {
            const row = await store.db
              .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
              .get();
            return [table, row.count];
          },
        ),
      ),
    ) as SystemOverview["counts"];
    return { counts };
  }
  async function getSystemRecords(request: {
    resource: SystemResource;
    search?: string;
    page?: number;
    confirmed?: boolean;
  }): Promise<SystemRecords> {
    store.requireAdmin();
    if (
      !request ||
      typeof request.resource !== "string" ||
      !Object.hasOwn(SYSTEM_RESOURCES, request.resource)
    )
      throw new AppError("Choose a system record category.");
    const resource = request.resource;
    if (
      PRIVATE_SYSTEM_RESOURCES.includes(resource) &&
      request.confirmed !== true
    )
      throw new AppError(
        "Confirm before loading private library records.",
        403,
      );
    const search = String(request.search || "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const where = "(?='' OR lower(to_jsonb(record)::text) LIKE ?)";
    const sql = `FROM (${projections[resource]}) record WHERE ${where}`;
    const args = [search, "%" + search + "%"];
    const { count } = await store.db
      .prepare(`SELECT COUNT(*) AS count ${sql}`)
      .get(...args);
    const pages = Math.max(1, Math.ceil(count / 20));
    const page = Math.min(
      pages,
      Math.max(1, Number.isSafeInteger(request.page) ? request.page : 1),
    );
    const rows = await store.db
      .prepare(
        `SELECT * ${sql} ORDER BY to_jsonb(record)::text LIMIT 20 OFFSET ?`,
      )
      .all(...args, (page - 1) * 20);
    return { resource, rows, total: count, page, pages };
  }
  return { getSystemOverview, getSystemRecords };
}
