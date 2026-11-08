import { seriesSlug, seriesUrlId } from "./series-slug.ts";

export type CollectionView =
  | "collection"
  | "missing"
  | "releases"
  | "discover"
  | "search"
  | "stats"
  | "trash";

export type LibraryView = CollectionView | "settings" | "data";

export const collectionPaths: Record<CollectionView, string> = {
  collection: "/",
  missing: "/missing",
  releases: "/releases",
  discover: "/discover",
  search: "/search",
  stats: "/stats",
  trash: "/removed",
};

export function seriesPath(series: string) {
  return "/series/" + seriesSlug(series) + "--" + seriesUrlId(series);
}

function legacySegment(series: string) {
  const bytes = new TextEncoder().encode(series);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function seriesFromPath(segment: string, titles: Iterable<string>) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("Invalid title URL");
  const names = [...new Set(titles)];
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*--([a-z0-9]{7})$/.exec(segment);
  if (slug) {
    const matches = names.filter((title) => seriesUrlId(title) === slug[1]);
    const exact = matches.filter(
      (title) => seriesPath(title) === "/series/" + segment,
    );
    if (exact.length === 1) return exact[0];
    // Accept an outdated readable prefix, then redirect to the canonical slug.
    if (matches.length === 1) return matches[0];
    throw new Error("Unknown or ambiguous title URL");
  }
  const bytes = Uint8Array.from(
    atob(segment.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0),
  );
  const title = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (legacySegment(title) !== segment || !names.includes(title))
    throw new Error("Unknown title URL");
  return title;
}
