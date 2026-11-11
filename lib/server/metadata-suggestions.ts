import { randomUUID } from "node:crypto";
import { AppError, type Store } from "./store.ts";
import { publicSourceUrl } from "../domain/series-info.ts";
import { normalizeBookType } from "../domain/book-type.ts";

export type MetadataSuggestion = {
  id: string;
  series: string;
  type: string;
  volume_key: string;
  field: string;
  proposed: string;
  source_url: string;
  note: string;
  status: "pending" | "reviewed" | "rejected";
  created_at: number;
};

export function createMetadataSuggestions(store: Store) {
  return {
    async suggestMetadataEdit(arg: {
      series: string;
      type: string;
      volumeKey?: string;
      field: string;
      proposed: string;
      sourceUrl?: string;
      note?: string;
    }) {
      if (
        !arg ||
        typeof arg !== "object" ||
        [arg.series, arg.type, arg.field, arg.proposed].some(
          (value) => typeof value !== "string" || !value.trim(),
        ) ||
        arg.series.length > 500 ||
        arg.field.length > 100 ||
        arg.proposed.length > 8000 ||
        !["Manga", "Light novel", "Others"].includes(arg.type) ||
        [arg.volumeKey, arg.sourceUrl, arg.note].some(
          (value) =>
            value != null && (typeof value !== "string" || value.length > 2000),
        )
      )
        throw new AppError(
          "Enter the field and proposed correction within the allowed length.",
        );
      if (arg.sourceUrl && !publicSourceUrl(arg.sourceUrl))
        throw new AppError("Use an HTTPS source URL.");
      const books = (await store.api.getCollection()).books;
      if (
        !books.some(
          (book) =>
            book.series === arg.series &&
            normalizeBookType(book.type) === arg.type,
        )
      )
        throw new AppError("This series is not in your library.", 404);
      if (
        arg.volumeKey &&
        (!/^(owned-\d+|catalog-[A-Za-z0-9_-]{43})$/.test(arg.volumeKey) ||
          (arg.volumeKey.startsWith("owned-") &&
            !books.some(
              (book) =>
                book.series === arg.series &&
                "owned-" + book.row === arg.volumeKey,
            )))
      )
        throw new AppError("Choose a volume from this series.");
      // Bound pending submissions per account; reviewing a suggestion never writes
      // another user's collection or silently publishes unverified metadata.
      return store.transaction(async () => {
        await store.db
          .prepare("SELECT id FROM users WHERE id=app_user_id() FOR UPDATE")
          .get();
        const count = await store.db
          .prepare(
            "SELECT count(*) AS count FROM metadata_suggestions WHERE user_id=app_user_id() AND status='pending'",
          )
          .get();
        if (Number(count?.count) >= 100)
          throw new AppError(
            "You have 100 pending suggestions. Wait for review before submitting more.",
            429,
          );
        const id = randomUUID();
        await store.db
          .prepare(
            "INSERT INTO metadata_suggestions(id,user_id,series,type,volume_key,field,proposed,source_url,note,created_at) VALUES(?,app_user_id(),?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            arg.series,
            arg.type,
            arg.volumeKey || "",
            arg.field.trim(),
            arg.proposed.trim(),
            arg.sourceUrl || "",
            arg.note || "",
            Date.now(),
          );
        return { id, status: "pending" };
      });
    },
    async getMetadataSuggestions(arg?: { series?: string; all?: boolean }) {
      if (arg?.all) store.requireAdmin();
      if (
        arg?.series != null &&
        (typeof arg.series !== "string" || arg.series.length > 500)
      )
        throw new AppError("Choose a series.");
      const rows = arg?.all
        ? await store.db
            .prepare(
              "SELECT id,series,type,volume_key,field,proposed,source_url,note,status,created_at FROM metadata_suggestions ORDER BY created_at DESC LIMIT 200",
            )
            .all()
        : await store.db
            .prepare(
              "SELECT id,series,type,volume_key,field,proposed,source_url,note,status,created_at FROM metadata_suggestions WHERE user_id=app_user_id() AND (?='' OR series=?) ORDER BY created_at DESC LIMIT 100",
            )
            .all(arg?.series || "", arg?.series || "");
      return { items: rows as unknown as MetadataSuggestion[] };
    },
    async reviewMetadataSuggestion(arg: { id: string; status: string }) {
      store.requireAdmin();
      if (
        typeof arg?.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(arg.id) ||
        !["reviewed", "rejected"].includes(arg.status)
      )
        throw new AppError("Choose a suggestion and review outcome.");
      const updated = await store.db
        .prepare(
          "UPDATE metadata_suggestions SET status=?,reviewed_at=?,reviewed_by=app_user_id() WHERE id=? AND status='pending' RETURNING id",
        )
        .get(arg.status, Date.now(), arg.id);
      if (!updated)
        throw new AppError(
          "This suggestion was already reviewed or no longer exists.",
          409,
        );
      return { id: arg.id, status: arg.status };
    },
  };
}
