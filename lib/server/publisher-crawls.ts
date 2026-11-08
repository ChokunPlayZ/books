import { randomUUID } from "node:crypto";
import { CRAWL_MODES, type CrawlMode, type CrawlOverview } from "../crawls.ts";
import { safeProductUrl, safePublisherTitleUrl } from "../domain/urls.ts";
import { CATALOG_CRAWLER, type createCatalogService } from "./catalogs.ts";
import { scrapeCheckpoint, ScrapeInterrupted } from "./scrape-runtime.ts";
import { AppError, type Store } from "./store.ts";

type Task = {
  kind: "series" | "book" | "complete";
  url: string;
  title: string;
  isbn?: string;
};
export function createPublisherCrawls(
  store: Store,
  catalogs: ReturnType<typeof createCatalogService>,
) {
  const internal = catalogs[CATALOG_CRAWLER];
  async function getPublisherCrawls(): Promise<CrawlOverview> {
    store.requireAdmin();
    const rows = await store.db
      .prepare(
        "SELECT * FROM publisher_crawls ORDER BY created_at DESC LIMIT 50",
      )
      .all();
    return {
      sources: internal.sources,
      crawls: rows.map((row) => ({
        id: row.id,
        publisherId: row.publisher_id,
        mode: row.mode,
        status: row.status,
        jobId: row.job_id,
        processed: row.processed,
        discovered: row.discovered,
        remaining: row.frontier?.length ?? null,
        currentLabel: row.current_label,
        warnings: row.warnings,
        error: row.error,
      })),
    };
  }
  async function startPublisherCrawl(
    request: { publisherId: string; mode: CrawlMode },
    enqueue: (id: string, label: string) => Promise<string>,
  ) {
    store.requireAdmin();
    const source = internal.sources.find((s) => s.id === request?.publisherId);
    if (!source || !Object.hasOwn(CRAWL_MODES, request?.mode || ""))
      throw new AppError("Choose a publisher and crawl mode.");
    if (request.mode !== "latest" && !source.full)
      throw new AppError(
        "This source only supports latest-release crawling; a full directory is not available.",
      );
    return store.transaction(async () => {
      await store.db.query("SELECT pg_advisory_xact_lock(726005::bigint)");
      const active = await store.db
        .prepare(
          "SELECT id FROM publisher_crawls WHERE publisher_id=? AND status IN ('running','paused')",
        )
        .get(source.id);
      if (active)
        throw new AppError(
          "This publisher already has an active crawl. Resume or cancel it first.",
          409,
        );
      const id = randomUUID(),
        now = Date.now();
      await store.db
        .prepare(
          `INSERT INTO publisher_crawls(id,publisher_id,mode,status,user_id,created_at,updated_at)
        VALUES (?,?,?,'running',?,?,?)`,
        )
        .run(id, source.id, request.mode, store.currentUser().id, now, now);
      const jobId = await enqueue(
        id,
        `Publisher crawl · ${source.name} · ${CRAWL_MODES[request.mode]}`,
      );
      await store.db
        .prepare("UPDATE publisher_crawls SET job_id=? WHERE id=?")
        .run(jobId, id);
      return { id };
    });
  }
  async function managePublisherCrawl(request: {
    id: string;
    action: "pause" | "resume" | "cancel";
  }) {
    store.requireAdmin();
    if (
      typeof request?.id !== "string" ||
      !["pause", "resume", "cancel"].includes(request.action)
    )
      throw new AppError("Choose a crawl action.");
    return store.transaction(async () => {
      const row = await store.db
        .prepare("SELECT * FROM publisher_crawls WHERE id=? FOR UPDATE")
        .get(request.id);
      if (!row || !["running", "paused"].includes(row.status))
        throw new AppError("This crawl is no longer active.", 409);
      const status =
        request.action === "cancel"
          ? "cancelled"
          : request.action === "pause"
            ? "paused"
            : "running";
      await store.db
        .prepare("UPDATE publisher_crawls SET status=?,updated_at=? WHERE id=?")
        .run(status, Date.now(), row.id);
      if (status === "cancelled")
        await store.db
          .prepare(
            "UPDATE scrape_jobs SET status='cancelled',finished_at=? WHERE id=? AND status='queued'",
          )
          .run(Date.now(), row.job_id);
      return { id: row.id };
    });
  }
  async function crawlPublisher(request: { id: string }) {
    store.requireAdmin();
    const row = await store.db
      .prepare("SELECT * FROM publisher_crawls WHERE id=?")
      .get(request.id);
    if (!row) throw new AppError("Publisher crawl not found.", 404);
    let frontier: Task[] | null = row.frontier;
    const warnings: string[] = row.warnings;
    const publisherId = row.publisher_id;
    const warn = (value: string) => {
      if (value && !warnings.includes(value) && warnings.length < 30)
        warnings.push(value);
    };
    async function seen(task: Task) {
      return !!(await store.db
        .prepare(
          "SELECT 1 FROM publisher_crawl_seen WHERE publisher_id=? AND url=? AND kind=?",
        )
        .get(publisherId, task.url, task.kind));
    }
    async function mark(task: Task) {
      await store.db
        .prepare(
          "INSERT INTO publisher_crawl_seen(publisher_id,url,kind) VALUES (?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(publisherId, task.url, task.kind);
    }
    function books(items): Task[] {
      return [
        ...new Map<string, Task>(
          items
            .filter((item) => safeProductUrl(item.url, publisherId))
            .map((item) => [
              item.url,
              {
                kind: "book",
                url: item.url,
                title: item.title,
                isbn: item.isbn || "",
              },
            ]),
        ).values(),
      ];
    }
    try {
      await scrapeCheckpoint();
      if (frontier === null) {
        await store.db
          .prepare(
            "UPDATE publisher_crawls SET current_label='Discovering publisher directory' WHERE id=?",
          )
          .run(row.id);
        if (row.mode === "latest") {
          const result = await catalogs.getPublisherReleases({
            publisherId,
            refresh: true,
          });
          await scrapeCheckpoint();
          if (result.stale) throw new Error(result.error);
          frontier = books(result.items);
          warn(
            "Latest-release mode is limited to the publisher's release feed, not its full catalog.",
          );
        } else if (publisherId === "lilyhouse") {
          const result = await catalogs.getPublisherCatalog({
            url: "https://lily-house.com/shop-2/",
            refresh: true,
          });
          await scrapeCheckpoint();
          if (result.stale) throw new Error(result.error);
          if (!result.complete)
            warn(result.error || "The shop listing is incomplete.");
          frontier = books(result.items);
          if (row.mode === "new-series") {
            const selected = new Set<string>();
            for (const item of result.items) {
              const key = {
                kind: "series" as const,
                url: "series:" + item.series,
                title: item.series,
              };
              if (!(await seen(key))) selected.add(item.url);
            }
            frontier = frontier.filter((task) => selected.has(task.url));
          }
          if (result.complete)
            frontier.push(
              ...[
                ...new Set<string>(result.items.map((item) => item.series)),
              ].map((title) => ({
                kind: "complete" as const,
                url: "series:" + title,
                title,
              })),
            );
        } else {
          const result = await catalogs.getSeriesCategories({
            publisherId,
            refresh: true,
          });
          await scrapeCheckpoint();
          if (result.stale) throw new Error(result.error);
          frontier = [
            ...new Map<string, Task>(
              result.categories
                .filter((c) => safePublisherTitleUrl(c.url, publisherId))
                .map((c) => [
                  c.url,
                  {
                    kind: "series",
                    url: c.url,
                    title: c.title,
                  },
                ]),
            ).values(),
          ];
          if (!frontier.length)
            throw new Error(
              "No series could be discovered. The publisher's directory may have changed.",
            );
          if (row.mode === "new-series") {
            const fresh: Task[] = [];
            for (const task of frontier)
              if (!(await seen(task))) fresh.push(task);
            frontier = fresh;
          }
        }
        await store.db
          .prepare(
            "UPDATE publisher_crawls SET frontier=?::jsonb,discovered=?,warnings=?::jsonb,updated_at=? WHERE id=?",
          )
          .run(
            JSON.stringify(frontier),
            frontier.length,
            JSON.stringify(warnings),
            Date.now(),
            row.id,
          );
      }
      while (frontier.length) {
        await scrapeCheckpoint();
        const task = frontier[0];
        await store.db
          .prepare(
            "UPDATE publisher_crawls SET current_label=?,updated_at=? WHERE id=?",
          )
          .run(task.title, Date.now(), row.id);
        let added: Task[] = [];
        if (task.kind === "series") {
          const result = await catalogs.getPublisherCatalog({
            url: task.url,
            refresh: true,
          });
          await scrapeCheckpoint();
          if (result.stale) throw new Error(result.error);
          if (!result.complete)
            warn(
              `${task.title}: ${result.error || "Incomplete catalog; not all pages were available."}`,
            );
          added = books(result.items);
          // A partial series must remain eligible for a future new-series run.
          if (result.complete) added.push({ ...task, kind: "complete" });
        } else if (task.kind === "complete") {
          await mark({ ...task, kind: "series" });
        } else if (row.mode === "all" || !(await seen(task))) {
          await internal.warm(publisherId, {
            url: task.url,
            isbn: task.isbn || "",
          });
          await scrapeCheckpoint();
          await mark(task);
        }
        frontier = [
          ...frontier.slice(1),
          ...added.filter(
            (task) =>
              !frontier.some(
                (other) => other.kind === task.kind && other.url === task.url,
              ),
          ),
        ];
        await store.db
          .prepare(
            `UPDATE publisher_crawls SET frontier=?::jsonb,processed=processed+1,
          discovered=discovered+?,warnings=?::jsonb,updated_at=? WHERE id=?`,
          )
          .run(
            JSON.stringify(frontier),
            added.length,
            JSON.stringify(warnings),
            Date.now(),
            row.id,
          );
      }
      await scrapeCheckpoint();
      await store.db
        .prepare(
          "UPDATE publisher_crawls SET status='completed',current_label='',updated_at=? WHERE id=?",
        )
        .run(Date.now(), row.id);
      return { message: "Publisher cache warm-up completed.", warnings };
    } catch (error) {
      if (error instanceof ScrapeInterrupted) throw error;
      await store.db
        .prepare(
          "UPDATE publisher_crawls SET status=CASE WHEN status='cancelled' THEN status ELSE 'failed' END,error=?,updated_at=? WHERE id=?",
        )
        .run(String(error.message).slice(0, 2000), Date.now(), row.id);
      throw new AppError(error.message || "Publisher crawl failed.", 409);
    }
  }
  return {
    getPublisherCrawls,
    startPublisherCrawl,
    managePublisherCrawl,
    crawlPublisher,
  };
}
