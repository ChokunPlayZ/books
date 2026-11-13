import test from "node:test";
import assert from "node:assert/strict";
import { catalogRefreshAt } from "../../lib/client/catalog-cache.ts";

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const checkedAt = "2026-11-13T00:00:00.000Z";
const checked = Date.parse(checkedAt);

test("series catalog expiry uses the source check time, including a partly used cache", () => {
  assert.equal(catalogRefreshAt({ checkedAt }, checked), checked + day);
  assert.equal(
    catalogRefreshAt({ checkedAt }, checked + 23 * hour),
    checked + day,
    "Opening a page must not grant a cached result another whole day",
  );
});

test("catalog failures retry after the scraper cooldown without repeatedly fetching old results", () => {
  const received = checked + 2 * day;
  for (const feed of [
    { checkedAt, stale: true },
    { checkedAt, error: "Source unavailable" },
    { checkedAt },
  ])
    assert.equal(catalogRefreshAt(feed, received), received + 15 * 60 * 1000);
});

test("catalog selections and invalid or future timestamps have a bounded one-day lifetime", () => {
  for (const feed of [
    {},
    { checkedAt: "" },
    { checkedAt: "invalid" },
    { checkedAt: new Date(checked + 2 * day).toISOString() },
  ])
    assert.equal(catalogRefreshAt(feed, checked), checked + day);
});
