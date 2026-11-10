import type { StoredBook } from "./types.ts";

export const BOOK_EDIT_LABELS = {
  isbn: "ISBN",
  series: "Series name",
  type: "Book type / language",
  publisher: "Publisher",
  status: "Reading status",
  volume: "Volume number",
  source: "Bought from",
  price: "Price paid (฿)",
  date: "Purchase date",
  note: "Notes",
  pageCount: "Pages",
  msrp: "Listed price",
  msrpCurrency: "Currency",
  edition: "Edition",
  coverUrl: "Cover image URL",
  publisherUrl: "Publisher product URL",
  coverId: "Stored cover",
} as const;

export type BookEditField = keyof typeof BOOK_EDIT_LABELS;
export type BookEditValues = Partial<Record<BookEditField, unknown>>;
export type BookEdit = { row: number; token: string; book: BookEditValues };
export type BookEditRequest = {
  requestId: string;
  row?: number;
  token?: string;
  book?: BookEditValues;
  changes?: BookEdit[];
};

export class BookEditConflictError extends Error {
  readonly books: StoredBook[];
  constructor(message: string, books: StoredBook[]) {
    super(message);
    this.books = books;
  }
}

function comparable(field: BookEditField, value: unknown) {
  if (value == null || value === "") return "";
  if (["volume", "price", "pageCount", "msrp"].includes(field)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return String(value).trim();
}

export function bookEditDiff(
  original: StoredBook,
  current: StoredBook,
  draft: BookEditValues,
) {
  return (Object.keys(BOOK_EDIT_LABELS) as BookEditField[])
    .map((field) => {
      const before = original[field] ?? "";
      const latest = current[field] ?? "";
      const mine = Object.hasOwn(draft, field) ? draft[field] : before;
      return {
        field,
        before,
        latest,
        mine,
        edited: comparable(field, before) !== comparable(field, mine),
        changed: comparable(field, before) !== comparable(field, latest),
        different: comparable(field, mine) !== comparable(field, latest),
      };
    })
    .filter((diff) => diff.edited || diff.changed);
}

export function resolvedBookEdit(
  current: StoredBook,
  diffs: ReturnType<typeof bookEditDiff>,
  choices: Partial<Record<BookEditField, "mine" | "latest">> = {},
): BookEditValues {
  const result: BookEditValues = Object.fromEntries(
    (Object.keys(BOOK_EDIT_LABELS) as BookEditField[]).map((field) => [
      field,
      current[field] ?? "",
    ]),
  );
  for (const diff of diffs) {
    const choice = choices[diff.field] ?? (diff.edited ? "mine" : "latest");
    result[diff.field] = choice === "mine" ? diff.mine : diff.latest;
  }
  return result;
}
