import type { ScraperCache } from "./types.ts";
import { ScrapeFailure } from "../scrape-diagnostics.ts";

// Headroom below the commonly provisioned 1 request/second and 1,000/day.
// Actual project/IP quotas can be lower; provider cooldowns take precedence.
export const GOOGLE_BOOKS_LIMITS = Object.freeze({
  intervalMs: 1_100,
  requestsPerDay: 950,
});
const cooldownKey = "google-books:cooldown";
const pacificDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const pending = new WeakMap<ScraperCache, Promise<unknown>>();

// Production uses an atomic PostgreSQL claim across users, pools and restarts.
// Small injected caches retain the same behavior within their process.
export async function claimScraperRateLimit(
  cache: ScraperCache,
  key: string,
  limit: number,
  windowMs: number,
): Promise<number> {
  if (cache.claimRateLimit) return cache.claimRateLimit(key, limit, windowMs);
  const previous = pending.get(cache) || Promise.resolve();
  const claim = previous
    .catch(() => {})
    .then(async () => {
      const now = Date.now();
      const cacheKey = "request-limit:" + key;
      const saved = JSON.parse((await cache.get(cacheKey)) || "null");
      const state =
        saved?.resetsAt > now ? saved : { count: 0, resetsAt: now + windowMs };
      if (state.count >= limit) return state.resetsAt - now;
      state.count++;
      await cache.put(cacheKey, JSON.stringify(state), windowMs / 1000);
      return 0;
    });
  pending.set(cache, claim);
  try {
    return await claim;
  } finally {
    if (pending.get(cache) === claim) pending.delete(cache);
  }
}

function isBooksApi(url: string) {
  const parsed = new URL(url);
  return (
    parsed.hostname === "www.googleapis.com" &&
    parsed.pathname.startsWith("/books/v1/")
  );
}
function unavailable(url: string, message: string) {
  return new ScrapeFailure({ kind: "cooldown", url, message });
}

export async function waitForGoogleBooksRequest(
  cache: ScraperCache,
  url: string,
) {
  if (!isBooksApi(url)) return;
  for (;;) {
    const until = Number(await cache.get(cooldownKey));
    if (until > Date.now())
      throw unavailable(
        url,
        "Google Books quota cooldown active. Try again later.",
      );
    const delay = await claimScraperRateLimit(
      cache,
      "google-books:pace",
      1,
      GOOGLE_BOOKS_LIMITS.intervalMs,
    );
    if (delay) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const daily = await claimScraperRateLimit(
      cache,
      "google-books:daily:" + pacificDate.format(new Date()),
      GOOGLE_BOOKS_LIMITS.requestsPerDay,
      26 * 3600 * 1000,
    );
    if (daily)
      throw unavailable(
        url,
        "Google Books daily request budget reached. Other sources remain available.",
      );
    return;
  }
}

export async function observeGoogleBooksResponse(
  cache: ScraperCache,
  url: string,
  status: number,
  headers: Headers,
  body: string,
) {
  if (
    !isBooksApi(url) ||
    (status !== 429 &&
      !(
        status === 403 &&
        /(?:dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded|quotaExceeded)/i.test(
          body,
        )
      ))
  )
    return;
  const now = Date.now();
  const retry = headers.get("retry-after") || "";
  const retryAt = /^\d+(?:\.\d+)?$/.test(retry)
    ? now + Number(retry) * 1000
    : Date.parse(retry);
  const fallback = /dailyLimitExceeded|quotaExceeded/i.test(body)
    ? 24 * 3600 * 1000
    : 15 * 60 * 1000;
  const until = Math.max(
    now + fallback,
    Number.isFinite(retryAt) ? retryAt : 0,
    Number(await cache.get(cooldownKey)) || 0,
  );
  await cache.put(cooldownKey, String(until), (until - now) / 1000);
}
