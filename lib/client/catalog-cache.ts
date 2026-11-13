const DAY = 24 * 60 * 60 * 1000;
const RETRY = 15 * 60 * 1000;

type CatalogStatus = {
  checkedAt?: string;
  stale?: boolean;
  error?: string;
};

export function catalogRefreshAt(feed: CatalogStatus, receivedAt: number) {
  if (feed.stale || feed.error) return receivedAt + RETRY;
  const checkedAt = Date.parse(feed.checkedAt || "");
  if (!Number.isFinite(checkedAt)) return receivedAt + DAY;
  const expiresAt = Math.min(checkedAt + DAY, receivedAt + DAY);
  // A stale fallback or an older server must not cause a tight retry loop.
  return expiresAt > receivedAt ? expiresAt : receivedAt + RETRY;
}
