"use client";

import { useMemo, useState } from "react";
import type { ComponentProps } from "react";
import CollectionController from "../CollectionController";
import Icon from "../Icon";
import {
  collectionStatistics,
  type SpendingGroup,
} from "../../lib/domain/statistics.ts";
import { seriesPath } from "../../lib/domain/navigation.ts";
import type { StoredBook } from "../../lib/types.ts";

const number = (value: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
const money = (value: number) => "฿" + number(value);
const bookCount = (value: number) =>
  number(value) + (value === 1 ? " book" : " books");

function Metric({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: ComponentProps<typeof Icon>["name"];
}) {
  return (
    <article className="analytics-metric">
      <span className="stat-icon">
        <Icon name={icon} />
      </span>
      <h2>{label}</h2>
      <p className="analytics-value">{value}</p>
      <p className="hint">{note}</p>
    </article>
  );
}

function Breakdown({
  title,
  groups,
  total,
  series = false,
}: {
  title: string;
  groups: SpendingGroup[];
  total: number;
  series?: boolean;
}) {
  const rows = (items: SpendingGroup[], offset = 0) => (
    <ol className="analytics-ranking" start={offset + 1}>
      {items.map((group, index) => (
        <li key={group.name}>
          <span className="analytics-rank" aria-hidden="true">
            {index + offset + 1}
          </span>
          <div className="analytics-rank-copy">
            <div className="analytics-rank-line">
              {series ? (
                <a href={seriesPath(group.name)}>{group.name}</a>
              ) : (
                <strong>{group.name}</strong>
              )}
              <span>{money(group.total)}</span>
            </div>
            <p className="hint">
              {bookCount(group.count)} · {number(group.priced)} with prices
              {total > 0 &&
                " · " + number((group.total / total) * 100) + "% of spending"}
            </p>
            <div className="analytics-track" aria-hidden="true">
              <span
                style={{
                  width: (total ? (group.total / total) * 100 : 0) + "%",
                }}
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
  return (
    <section className="analytics-card" aria-label={title}>
      <div className="analytics-card-heading">
        <h2>{title}</h2>
        <span className="hint">{number(groups.length)} total</span>
      </div>
      {groups.length ? (
        rows(groups.slice(0, 5))
      ) : (
        <p className="hint">No purchases in this period.</p>
      )}
      {groups.length > 5 && (
        <details className="analytics-details">
          <summary>See all {number(groups.length)}</summary>
          {rows(groups.slice(5), 5)}
        </details>
      )}
    </section>
  );
}

export default function StatisticsPanel({
  initialBooks,
  today,
}: {
  initialBooks: StoredBook[];
  today: string;
}) {
  const [books, setBooks] = useState(initialBooks);
  const [period, setPeriod] = useState("all");
  const [metric, setMetric] = useState<"total" | "count">("total");
  const stats = useMemo(
    () => collectionStatistics(books, period, today),
    [books, period, today],
  );
  const yearly = stats.period === "all";
  const maximum = Math.max(0, ...stats.trend.map((bucket) => bucket[metric]));
  const peak = stats.trend.reduce<(typeof stats.trend)[number] | null>(
    (best, bucket) => (bucket.total > (best?.total ?? 0) ? bucket : best),
    null,
  );
  const readPercent = books.length
    ? Math.round((stats.read / books.length) * 100)
    : 0;
  const scope =
    stats.period === "all"
      ? "All time"
      : stats.period === "12m"
        ? "Last 12 months"
        : stats.period;
  return (
    <>
      <CollectionController
        view="stats"
        series={null}
        onBooksChange={setBooks}
      />
      <section
        id="statisticsPanel"
        className="analytics"
        aria-labelledby="statisticsTitle"
      >
        <div className="analytics-heading">
          <div>
            <p className="eyebrow">Your library, in numbers</p>
            <h1 id="statisticsTitle">Statistics</h1>
            <p className="intro">
              Follow your spending, discover your habits, and watch your
              collection grow.
            </p>
          </div>
          <div className="analytics-controls">
            <label htmlFor="statisticsPeriod">Purchase period</label>
            <select
              id="statisticsPeriod"
              value={stats.period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="all">All time</option>
              <option value="12m">Last 12 months</option>
              {stats.years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="analytics-scope hint">
          Based on books currently in your collection. All amounts are in Thai
          baht (฿).
        </p>
        {!books.length ? (
          <div className="empty">
            <span className="empty-icon">
              <Icon name="chart" />
            </span>
            <h2>Your story in numbers starts here</h2>
            <p>
              Add books with prices and purchase dates to see spending trends
              and collection insights.
            </p>
            <a className="btn primary" href="/">
              Open your collection
            </a>
          </div>
        ) : (
          <>
            <div
              className="analytics-metrics"
              aria-label={scope + " spending summary"}
            >
              <Metric
                label="Total spent"
                value={money(stats.total)}
                note={scope + " · " + bookCount(stats.priced) + " with prices"}
                icon="wallet"
              />
              <Metric
                label="Books acquired"
                value={number(stats.count)}
                note={scope + " · " + number(stats.series.length) + " series"}
                icon="books"
              />
              <Metric
                label="Average paid per book"
                value={stats.average === null ? "—" : money(stats.average)}
                note={
                  stats.missingPrices
                    ? bookCount(stats.missingPrices) +
                      " without prices excluded"
                    : "Includes books recorded as free"
                }
                icon="book"
              />
              <Metric
                label={"Peak " + (yearly ? "year" : "month")}
                value={peak ? money(peak.total) : "—"}
                note={
                  peak
                    ? peak.name + " · " + bookCount(peak.count)
                    : "No dated spending in this period"
                }
                icon="chart"
              />
            </div>
            <section
              className="analytics-card analytics-trends"
              aria-labelledby="trendTitle"
            >
              <div className="analytics-card-heading">
                <div>
                  <h2 id="trendTitle">
                    {yearly ? "Yearly" : "Monthly"} spending trends
                  </h2>
                  <p className="hint">
                    {yearly
                      ? "Choose a year to explore month-by-month trends."
                      : "Each month includes all books with a recorded purchase date."}
                  </p>
                </div>
                <div
                  className="analytics-switch"
                  role="group"
                  aria-label="Trend measure"
                >
                  <button
                    type="button"
                    aria-pressed={metric === "total"}
                    onClick={() => setMetric("total")}
                  >
                    Spending
                  </button>
                  <button
                    type="button"
                    aria-pressed={metric === "count"}
                    onClick={() => setMetric("count")}
                  >
                    Books
                  </button>
                </div>
              </div>
              {!stats.datedCount ? (
                <div className="analytics-no-trend">
                  <Icon name="chart" />
                  <h3>No dated purchases in this period</h3>
                  <p className="hint">
                    Add purchase dates to your books or choose another period to
                    see trends.
                  </p>
                </div>
              ) : (
                <>
                  <div
                    className="analytics-chart-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label={
                      scope +
                      " " +
                      (metric === "total" ? "spending" : "book purchases") +
                      " chart. Exact values are in the table below."
                    }
                  >
                    <div className="analytics-chart" aria-hidden="true">
                      {stats.trend.map((bucket) => (
                        <div
                          className="analytics-column"
                          key={bucket.key}
                          title={
                            bucket.name +
                            ": " +
                            money(bucket.total) +
                            " · " +
                            bookCount(bucket.count)
                          }
                        >
                          <div className="analytics-bar-space">
                            <span className="analytics-bar-value">
                              {metric === "total"
                                ? money(bucket.total)
                                : number(bucket.count)}
                            </span>
                            <div
                              className="analytics-bar"
                              style={{
                                height:
                                  (maximum
                                    ? (bucket[metric] / maximum) * 100
                                    : 0) + "%",
                              }}
                            />
                          </div>
                          <span className="analytics-bar-label">
                            {bucket.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <details className="analytics-details">
                    <summary>View trend data table</summary>
                    <div
                      className="analytics-table-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label="Spending trend data"
                    >
                      <table className="analytics-table">
                        <caption>{scope} · dated purchases only</caption>
                        <thead>
                          <tr>
                            <th scope="col">{yearly ? "Year" : "Month"}</th>
                            <th scope="col">Spent</th>
                            <th scope="col">Books</th>
                            <th scope="col">With prices</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.trend.map((bucket) => (
                            <tr key={bucket.key}>
                              <th scope="row">{bucket.name}</th>
                              <td>{money(bucket.total)}</td>
                              <td>{number(bucket.count)}</td>
                              <td>{number(bucket.priced)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
              <p className="analytics-trend-note hint">
                Books without prices count toward purchases, but not spending.
                {stats.undatedCount > 0 &&
                  " " +
                    bookCount(stats.undatedCount) +
                    " without valid purchase dates (" +
                    money(stats.undatedTotal) +
                    ") are included only in all-time totals and breakdowns, and excluded from trends and date filters."}
              </p>
            </section>
            <div className="analytics-breakdowns">
              <Breakdown
                title="Spending by series"
                groups={stats.series}
                total={stats.total}
                series
              />
              <Breakdown
                title="Spending by store"
                groups={stats.stores}
                total={stats.total}
              />
              <Breakdown
                title="Spending by publisher"
                groups={stats.publishers}
                total={stats.total}
              />
              <Breakdown
                title="Spending by book type"
                groups={stats.types}
                total={stats.total}
              />
            </div>
            <section
              className="analytics-card"
              aria-labelledby="readingOverviewTitle"
            >
              <div className="analytics-card-heading">
                <div>
                  <h2 id="readingOverviewTitle">On your reading shelf</h2>
                  <p className="hint">
                    Your whole current collection, across all purchase dates.
                  </p>
                </div>
                <span className="analytics-reading-total">
                  {readPercent}% read
                </span>
              </div>
              <div className="analytics-reading-grid">
                <div className="analytics-statuses">
                  {stats.reading.map((status) => (
                    <div key={status.name}>
                      <div className="analytics-rank-line">
                        <span>{status.name}</span>
                        <strong>{bookCount(status.count)}</strong>
                      </div>
                      <div className="analytics-track" aria-hidden="true">
                        <span
                          style={{
                            width: (status.count / books.length) * 100 + "%",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="analytics-reading-note">
                  <Icon name="book" />
                  <h3>
                    {bookCount(books.length - stats.read)} still to finish
                  </h3>
                  <p className="hint">
                    {money(stats.unreadSpending)} recorded spending on books not
                    yet marked Read.
                  </p>
                  <p className="hint">
                    {bookCount(stats.free)} recorded as free in the selected
                    purchase period. Missing prices are never treated as free.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </section>
    </>
  );
}
