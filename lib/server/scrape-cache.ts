import { digest } from "../domain.ts";

// Seconds. Keep these independent of Next's fetch cache so CLI runs and restarts
// share the same SQLite entries as the web application.
export const SCRAPE_TTL = {
  releases: 6 * 3600,
  catalog: 86400,
  directory: 7 * 86400,
  product: 7 * 86400,
  isbn: 86400,
  retry: 15 * 60,
  retention: 30 * 86400,
};

type Cache = {
  get(key: string): string | null;
  put(key: string, value: string, seconds: number): void;
};

export function createScrapeCache(cache: Cache) {
  const pending = new Map<string, Promise<unknown>>();
  return {
    async get<T>(
      source: string,
      { maxAge, refresh = false }: { maxAge: number; refresh?: boolean },
      load: () => Promise<T>,
    ): Promise<T> {
      const key = "scrape:v1:" + digest(source);
      // Share work even when a forced refresh overlaps an ordinary request.
      if (!pending.has(key)) {
        if (!refresh) {
          try {
            const record = JSON.parse(cache.get(key) || "null");
            if (
              record &&
              Object.hasOwn(record, "value") &&
              Date.now() - record.checkedAt < maxAge * 1000
            )
              return record.value;
          } catch {
            // An unreadable disposable entry can be fetched again.
          }
        }
        // A failed attempt must not turn every subsequent view into a retry.
        // Apply the cooldown to explicit refreshes too, including after restart.
        if (cache.get(key + ":retry"))
          throw new Error(
            "Source unavailable. Try again after the retry cooldown.",
          );
        const request = Promise.resolve()
          .then(load)
          .then((value) => {
            cache.put(
              key,
              JSON.stringify({ value, checkedAt: Date.now(), source, maxAge }),
              SCRAPE_TTL.retention,
            );
            return value;
          })
          .catch((error) => {
            // Keep the previous successful entry and its original timestamp.
            cache.put(key + ":retry", "1", SCRAPE_TTL.retry);
            throw error;
          })
          .finally(() => pending.delete(key));
        pending.set(key, request);
      }
      // Callers annotate catalog records for their own shelf aliases and types.
      return structuredClone((await pending.get(key)) as T);
    },
  };
}
