export type CollectionView = "collection" | "releases" | "discover" | "trash";

export const collectionPaths: Record<CollectionView, string> = {
  collection: "/",
  releases: "/releases",
  discover: "/discover",
  trash: "/removed",
};

export function seriesPath(series: string) {
  // Keep arbitrary title text (including slashes and percent signs) out of route syntax.
  const bytes = new TextEncoder().encode(series);
  const segment = btoa(
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return "/series/" + segment;
}

export function seriesFromPath(segment: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("Invalid title URL");
  const bytes = Uint8Array.from(
    atob(segment.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
