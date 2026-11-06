import { digest } from "../domain.ts";

// Seconds. Keep these independent of Next's fetch cache so CLI runs and restarts
// share the same PostgreSQL entries as the web application.
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
  get(key: string): Promise<string | null> | string | null;
  put(key: string, value: string, seconds: number): Promise<void> | void;
};
const sharedPending = new WeakMap<Cache, Map<string, Promise<unknown>>>();

export function createScrapeCache(cache: Cache) {
  if (!sharedPending.has(cache)) sharedPending.set(cache, new Map());
  const pending = sharedPending.get(cache)!;
  return {
    async pin(source: string) {
      const key = "scrape:v1:" + digest(source);
      const record = JSON.parse((await cache.get(key)) || "null");
      if (record && !record.permanent && Object.hasOwn(record, "value"))
        await cache.put(
          key,
          JSON.stringify({ ...record, permanent: true }),
          Infinity,
        );
    },
    async get<T>(
      source: string,
      {
        maxAge,
        refresh = false,
        permanent,
      }: {
        maxAge: number;
        refresh?: boolean;
        permanent?: boolean | ((value: T) => boolean | Promise<boolean>);
      },
      load: () => Promise<T>,
    ): Promise<T> {
      const key = "scrape:v1:" + digest(source);
      // Share work even when a forced refresh overlaps an ordinary request.
      if (!pending.has(key)) {
        const request = (async () => {
          if (!refresh) {
            try {
              const record = JSON.parse((await cache.get(key)) || "null");
              if (
                record &&
                Object.hasOwn(record, "value") &&
                (record.permanent ||
                  Date.now() - record.checkedAt < maxAge * 1000)
              )
                return structuredClone(record.value);
            } catch {
              // An unreadable disposable entry can be fetched again.
            }
          }
          // A failed attempt must not turn every subsequent view into a retry.
          // Apply the cooldown to explicit refreshes too, including after restart.
          if (await cache.get(key + ":retry"))
            throw new Error(
              "Source unavailable. Try again after the retry cooldown.",
            );
          return Promise.resolve()
            .then(load)
            .then(async (value) => {
              const keep =
                typeof permanent === "function"
                  ? await permanent(value)
                  : permanent === true;
              await cache.put(
                key,
                JSON.stringify({
                  value,
                  checkedAt: Date.now(),
                  source,
                  maxAge,
                  permanent: keep,
                }),
                keep ? Infinity : SCRAPE_TTL.retention,
              );
              return value;
            })
            .catch(async (error) => {
              // Keep the previous successful entry and its original timestamp.
              await cache.put(key + ":retry", "1", SCRAPE_TTL.retry);
              throw error;
            });
        })().finally(() => pending.delete(key));
        pending.set(key, request);
      }
      // Callers annotate catalog records for their own shelf aliases and types.
      return structuredClone((await pending.get(key)) as T);
    },
  };
}
