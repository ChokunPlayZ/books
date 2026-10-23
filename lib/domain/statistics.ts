import type { Book } from "../types.ts";

export type SpendingGroup = {
  name: string;
  count: number;
  priced: number;
  total: number;
};

export type SpendingPeriod = SpendingGroup & { key: string };

const money = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function recordedPrice(book: Book): number | null {
  return typeof book.price === "number" &&
    Number.isFinite(book.price) &&
    book.price >= 0
    ? book.price
    : null;
}

function purchaseDate(book: Book): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(book.date)) return null;
  const date = new Date(book.date + "T00:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === book.date
    ? book.date
    : null;
}

function monthKey(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

export function collectionStatistics(
  books: Book[],
  period: string,
  today: string,
) {
  const entries = books.map((book) => ({
    book,
    price: recordedPrice(book),
    date: purchaseDate(book),
  }));
  const years = [
    ...new Set(entries.flatMap(({ date }) => (date ? [date.slice(0, 4)] : []))),
  ].sort((a, b) => b.localeCompare(a));
  const selected = period === "12m" || years.includes(period) ? period : "all";
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7)) - 1;
  const startMonth = monthKey(currentYear, currentMonth - 11);
  const endMonth = today.slice(0, 7);
  const scoped = entries.filter(
    ({ date }) =>
      selected === "all" ||
      (date !== null &&
        (selected === "12m"
          ? date.slice(0, 7) >= startMonth && date.slice(0, 7) <= endMonth
          : date.startsWith(selected + "-"))),
  );
  const priced = scoped.filter(({ price }) => price !== null);
  const total = money(priced.reduce((sum, { price }) => sum + price!, 0));

  function groups(
    field: "series" | "source" | "publisher" | "type",
    fallback: string,
  ) {
    const result = new Map<string, SpendingGroup>();
    for (const { book, price } of scoped) {
      const name = book[field].trim() || fallback;
      const group = result.get(name) || { name, count: 0, priced: 0, total: 0 };
      group.count++;
      if (price !== null) {
        group.total += price;
        group.priced++;
      }
      result.set(name, group);
    }
    return [...result.values()]
      .map((group) => ({ ...group, total: money(group.total) }))
      .sort(
        (a, b) =>
          b.total - a.total ||
          b.count - a.count ||
          a.name.localeCompare(b.name),
      );
  }

  const keys =
    selected === "all"
      ? [...years].reverse()
      : Array.from({ length: 12 }, (_, index) =>
          selected === "12m"
            ? monthKey(currentYear, currentMonth - 11 + index)
            : monthKey(Number(selected), index),
        );
  const periods = new Map<string, SpendingPeriod>(
    keys.map((key) => [
      key,
      {
        key,
        name:
          key.length === 4
            ? key
            : new Intl.DateTimeFormat("en", {
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              }).format(new Date(key + "-01T00:00:00Z")),
        count: 0,
        priced: 0,
        total: 0,
      },
    ]),
  );
  for (const { price, date } of scoped) {
    if (!date) continue;
    const bucket = periods.get(date.slice(0, selected === "all" ? 4 : 7));
    if (!bucket) continue;
    bucket.count++;
    if (price !== null) {
      bucket.priced++;
      bucket.total += price;
    }
  }
  const trend = [...periods.values()].map((bucket) => ({
    ...bucket,
    total: money(bucket.total),
  }));
  const undated = entries.filter(({ date }) => date === null);
  const statuses = new Map<string, number>();
  for (const book of books) {
    const status = book.status.trim() || "Not recorded";
    statuses.set(status, (statuses.get(status) || 0) + 1);
  }
  return {
    period: selected,
    years,
    count: scoped.length,
    priced: priced.length,
    missingPrices: scoped.length - priced.length,
    free: priced.filter(({ price }) => price === 0).length,
    total,
    average: priced.length ? money(total / priced.length) : null,
    trend,
    datedCount: scoped.filter(({ date }) => date !== null).length,
    undatedCount: undated.length,
    undatedTotal: money(
      undated.reduce((sum, { price }) => sum + (price ?? 0), 0),
    ),
    series: groups("series", "Untitled series"),
    stores: groups("source", "Store not recorded"),
    publishers: groups("publisher", "Publisher not recorded"),
    types: groups("type", "Type not recorded"),
    reading: [...statuses]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    read: books.filter((book) => book.status === "Read").length,
    unreadSpending: money(
      entries
        .filter(({ book }) => book.status !== "Read")
        .reduce((sum, { price }) => sum + (price ?? 0), 0),
    ),
  };
}
