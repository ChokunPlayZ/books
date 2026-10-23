import test from "node:test";
import assert from "node:assert/strict";
import { collectionStatistics } from "../../lib/domain/statistics.ts";

const book = (changes = {}) => ({
  isbn: "",
  series: "A story",
  type: "Manga (TH)",
  publisher: "A press",
  status: "Sealed",
  volume: 1,
  source: "A shop",
  price: "",
  date: "",
  note: "",
  coverUrl: "",
  publisherUrl: "",
  ...changes,
});
const today = "2026-10-23";

test("all-time spending preserves free versus unknown prices and accounts for undated purchases and missing metadata", () => {
  const stats = collectionStatistics(
    [
      book({ price: 0.1, date: "2026-01-01", status: "Read" }),
      book({ price: 0.2, date: "2026-01-02", source: "" }),
      book({ price: 0, date: "2025-12-01" }),
      book({ price: 100, series: "Another story", publisher: "", source: "" }),
      book({ date: "2026-02-30" }),
    ],
    "all",
    today,
  );
  assert.equal(stats.total, 100.3);
  assert.equal(stats.average, 25.08);
  assert.equal(stats.count, 5);
  assert.equal(stats.priced, 4);
  assert.equal(stats.missingPrices, 1);
  assert.equal(stats.free, 1);
  assert.equal(stats.undatedCount, 2);
  assert.equal(stats.undatedTotal, 100);
  assert.deepEqual(
    stats.trend.map(({ key, total, count }) => ({ key, total, count })),
    [
      { key: "2025", total: 0, count: 1 },
      { key: "2026", total: 0.3, count: 2 },
    ],
  );
  assert.equal(stats.stores[0].name, "Store not recorded");
  assert.equal(stats.stores[0].total, 100.2);
  for (const groups of [
    stats.series,
    stats.stores,
    stats.publishers,
    stats.types,
  ]) {
    assert.equal(
      Math.round(groups.reduce((sum, group) => sum + group.total, 0) * 100),
      10030,
    );
    assert.equal(
      groups.reduce((sum, group) => sum + group.count, 0),
      5,
    );
  }
  assert.equal(stats.read, 1);
  assert.equal(stats.unreadSpending, 100.2);
});

test("year filters include boundary dates and zero-spend months, exclude undated books, and keep whole-shelf reading insights", () => {
  const stats = collectionStatistics(
    [
      book({ price: 10, date: "2025-12-31", status: "Read" }),
      book({ price: 20, date: "2026-01-01" }),
      book({ price: 0, date: "2026-12-31" }),
      book({ date: "2026-02-01" }),
      book({ price: 40, date: "2027-01-01" }),
      book({ price: 50 }),
    ],
    "2026",
    today,
  );
  assert.equal(stats.total, 20);
  assert.equal(stats.count, 3);
  assert.equal(stats.average, 10);
  assert.equal(stats.trend.length, 12);
  assert.deepEqual(
    stats.trend.slice(0, 3).map(({ total, count }) => [total, count]),
    [
      [20, 1],
      [0, 1],
      [0, 0],
    ],
  );
  assert.equal(stats.trend[11].count, 1);
  assert.equal(stats.read, 1);
  assert.equal(
    stats.reading.reduce((sum, status) => sum + status.count, 0),
    6,
  );
});

test("last 12 months crosses the year boundary and includes the current calendar month", () => {
  const stats = collectionStatistics(
    [
      book({ price: 100, date: "2025-10-31" }),
      book({ price: 10, date: "2025-11-01" }),
      book({ price: 20, date: "2026-10-31" }),
      book({ price: 200, date: "2026-11-01" }),
      book({ price: 300 }),
    ],
    "12m",
    today,
  );
  assert.equal(stats.count, 2);
  assert.equal(stats.total, 30);
  assert.equal(stats.trend.length, 12);
  assert.equal(stats.trend[0].key, "2025-11");
  assert.equal(stats.trend[11].key, "2026-10");
});

test("empty, unpriced, and undated libraries produce usable statistics without inventing averages or dates", () => {
  const empty = collectionStatistics([], "all", today);
  assert.equal(empty.total, 0);
  assert.equal(empty.average, null);
  assert.deepEqual(empty.trend, []);
  assert.deepEqual(empty.reading, []);
  const unknown = collectionStatistics([book()], "not-a-period", today);
  assert.equal(unknown.period, "all");
  assert.equal(unknown.average, null);
  assert.equal(unknown.free, 0);
  assert.equal(unknown.undatedCount, 1);
  assert.deepEqual(unknown.trend, []);
});
