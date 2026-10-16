import type { StoredBook } from "../types.ts";

export function shelfCoverBook(books: StoredBook[]) {
  const ordered = [...books].sort((a, b) => {
    const volume = (book: StoredBook) =>
      book.volume === "" || book.volume === null
        ? Infinity
        : Number(book.volume);
    return volume(a) - volume(b) || a.row - b.row;
  });
  return ordered.find((book) => book.coverId) || ordered[0];
}

export function coverTint(title: string) {
  const colors = ["sage", "clay", "slate", "sand", "plum"] as const;
  const tint = [...title].reduce(
    (sum, character) => sum + character.codePointAt(0),
    0,
  );
  return colors[tint % colors.length];
}
