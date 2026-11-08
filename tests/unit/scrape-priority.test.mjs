import test from "node:test";
import assert from "node:assert/strict";
import { createScrapeCache } from "../../lib/server/scrape-cache.ts";
import { withScrapeRuntime } from "../../lib/server/scrape-runtime.ts";

test(
  "a user lookup never shares a paused background cache loader",
  { timeout: 2000 },
  async () => {
    const values = new Map();
    const cache = createScrapeCache({
      get: (key) => values.get(key) ?? null,
      put: (key, value) => values.set(key, value),
    });
    const started = Promise.withResolvers(),
      release = Promise.withResolvers();
    const background = withScrapeRuntime(
      {
        checkpoint: async () => {},
        request: (_url, load) => load(),
        minimumDelay: () => {},
      },
      () =>
        cache.get("same-book", { maxAge: 60 }, async () => {
          started.resolve();
          await release.promise;
          return "background";
        }),
    );
    try {
      await started.promise;
      assert.equal(
        await cache.get("same-book", { maxAge: 60 }, async () => "foreground"),
        "foreground",
      );
    } finally {
      release.resolve();
      await background;
    }
  },
);
