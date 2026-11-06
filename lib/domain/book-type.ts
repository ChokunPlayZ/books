export const BOOK_TYPES = ["Manga", "Light novel", "Others"] as const;
export type BookType = (typeof BOOK_TYPES)[number];

// Accept legacy imports without retaining language/colour as separate book types.
export function normalizeBookType(value: unknown): BookType {
  const type = String(value ?? "").trim();
  if (/^manga\b/i.test(type)) return "Manga";
  if (/^(?:LN\b|light[ -]?novel\b)/i.test(type)) return "Light novel";
  return "Others";
}

export function bookEditionKey(book: { type?: string; edition?: string }) {
  const language =
    /\((TH|EN|JP)\)/i
      .exec(book.edition || book.type || "")?.[1]
      .toUpperCase() || "";
  return normalizeBookType(book.type) + (language ? ` (${language})` : "");
}

export function normalizeRecordTypes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeRecordTypes) as T;
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "type" && typeof child === "string"
        ? child
          ? normalizeBookType(child)
          : ""
        : normalizeRecordTypes(child),
    ]),
  );
  const original = (value as { type?: unknown }).type;
  if (
    typeof original === "string" &&
    original &&
    original !== normalizeBookType(original) &&
    !result.edition
  )
    result.edition = original;
  return result as T;
}
