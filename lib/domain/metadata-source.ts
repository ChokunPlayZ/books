import { PUBLISHERS } from "./constants.ts";
import type { Synopsis } from "./series-info.ts";

const publisherHosts = new Set(
  PUBLISHERS.filter((publisher) => publisher.id !== "yaakz").map(
    (publisher) => new URL(publisher.url).hostname,
  ),
);
const bookstoreHosts = new Set([
  "www.naiin.com",
  "kinokuniya.co.th",
  "thailand.kinokuniya.com",
  "www.yaakz.com",
]);

export function metadataSourcePriority(url: string) {
  try {
    const host = new URL(url).hostname;
    if (publisherHosts.has(host) || host === "www.hanmoto.com") return 0;
    if (bookstoreHosts.has(host)) return 1;
  } catch {}
  return 2;
}

// Keep every citation in storage, but choose a single description per language.
// Publisher series descriptions beat product blurbs; stores are the fallback.
export function preferredSynopses(synopses: Synopsis[]) {
  const selected = new Map<string, Synopsis>();
  const ordered = [...synopses]
    .filter((item) => item.text.trim())
    .sort(
      (a, b) =>
        metadataSourcePriority(a.url) - metadataSourcePriority(b.url) ||
        Number(!/\/series\//.test(a.url)) - Number(!/\/series\//.test(b.url)) ||
        a.url.localeCompare(b.url, "en") ||
        a.text.localeCompare(b.text, "en"),
    );
  for (const synopsis of ordered)
    if (!selected.has(synopsis.language))
      selected.set(synopsis.language, synopsis);
  return [...selected.values()];
}
