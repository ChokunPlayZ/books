import type { Book } from "../types.ts";

// An allowlist, not a copy of a stored record: new metadata and internal fields
// must never silently become part of a user's portable library export.
export function exportLibraryBook(book: Book) {
  return {
    isbn: book.isbn,
    title: book.series,
    type: book.type,
    volume: book.volume,
    edition: book.edition ?? "",
    status: book.status,
    source: book.source,
    price: book.price,
    date: book.date,
    note: book.note,
  };
}
