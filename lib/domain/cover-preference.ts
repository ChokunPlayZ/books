// Luckpim thumbnails are a fallback; another store often has a better scan.
// Use the image's origin, not the book's publisher or the last merged source.
export function coverPreference(cover: { coverUrl?: string }) {
  try {
    return new URL(cover.coverUrl || "").hostname === "www.luckpim.com" ? 1 : 0;
  } catch {
    return 0;
  }
}
