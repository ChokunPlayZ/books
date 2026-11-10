import { digest } from "../domain.ts";
import { ScrapeInterrupted, isBackgroundScrape } from "./scrape-runtime.ts";
import {
  errorMessage,
  recordScrapeError,
  ScrapeFailure,
} from "./scrape-diagnostics.ts";

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
  async function remember<T>(
    source: string,
    value: T,
    maxAge: number,
    permanent = false,
  ) {
    await cache.put(
      "scrape:v1:" + digest(source),
      JSON.stringify({
        value,
        checkedAt: Date.now(),
        source,
        maxAge,
        permanent,
      }),
      permanent ? Infinity : SCRAPE_TTL.retention,
    );
  }
  return {
    // Store independently verified data without replaying a failed/missing search.
    // This is a local write, not a bypass of a remote request's retry cooldown.
    remember,
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
      // A foreground request must never depend on a background loader that is
      // paused precisely because that foreground request is now running.
      const pendingKey = (isBackgroundScrape() ? "background:" : "") + key;
      // Share work even when a forced refresh overlaps an ordinary request.
      if (!pending.has(pendingKey)) {
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
          const retry = await cache.get(key + ":retry");
          if (retry) {
            let previous: { message?: string; url?: string; status?: number } =
              {};
            try {
              const saved = JSON.parse(retry);
              if (saved && typeof saved === "object") previous = saved;
            } catch {
              /* Legacy cooldowns did not retain their cause. */
            }
            const failure = new ScrapeFailure({
              kind: "cooldown",
              ...(previous.url ? { url: previous.url } : {}),
              ...(previous.status ? { status: previous.status } : {}),
              message: previous.message
                ? `Retry cooldown active. Previous failure: ${previous.message}`
                : "Retry cooldown active. The original failure was not recorded by the older scraper.",
            });
            recordScrapeError(failure);
            throw failure;
          }
          return Promise.resolve()
            .then(load)
            .then(async (value) => {
              const keep =
                typeof permanent === "function"
                  ? await permanent(value)
                  : permanent === true;
              await remember(source, value, maxAge, keep);
              return value;
            })
            .catch(async (error) => {
              if (error instanceof ScrapeInterrupted) throw error;
              // Keep the previous successful entry and its original timestamp.
              const diagnostic =
                error instanceof ScrapeFailure
                  ? error.diagnostic
                  : { message: errorMessage(error) };
              await cache.put(
                key + ":retry",
                JSON.stringify(diagnostic),
                SCRAPE_TTL.retry,
              );
              recordScrapeError(error);
              throw error;
            });
        })().finally(() => pending.delete(pendingKey));
        pending.set(pendingKey, request);
      }
      // Callers annotate catalog records for their own shelf aliases and types.
      return structuredClone((await pending.get(pendingKey)) as T);
    },
  };
}
