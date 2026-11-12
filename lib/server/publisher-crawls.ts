import { randomUUID } from "node:crypto";
import { CRAWL_MODES, type CrawlMode, type CrawlOverview } from "../crawls.ts";
import { safeProductUrl, safePublisherTitleUrl } from "../domain/urls.ts";
import { CATALOG_CRAWLER, type createCatalogService } from "./catalogs.ts";
import {
  scrapeCheckpoint,
  scrapeProgress,
  ScrapeInterrupted,
} from "./scrape-runtime.ts";
import { errorMessage } from "./scrape-diagnostics.ts";
import { AppError, type Store } from "./store.ts";

type Task = {
  kind: "series" | "book" | "complete";
  url: string;
  title: string;
  isbn?: string;
  books?: string[];
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
        `SELECT id,publisher_id,mode,status,job_id,processed,discovered,current_label,warnings,error,
          CASE WHEN jsonb_typeof(frontier)='array' THEN jsonb_array_length(frontier)-frontier_offset END AS remaining
          FROM publisher_crawls ORDER BY created_at DESC LIMIT 50`,
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
        remaining: row.remaining,
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
  async function managePublisherCrawl(
    request: {
      id: string;
      action: "pause" | "resume" | "cancel";
    },
    enqueue?: (id: string, label: string) => Promise<string>,
  ) {
    store.requireAdmin();
    if (
      typeof request?.id !== "string" ||
      !["pause", "resume", "cancel"].includes(request.action)
    )
      throw new AppError("Choose a crawl action.");
    return store.transaction(async () => {
      await store.db.query("SELECT pg_advisory_xact_lock(726005::bigint)");
      const row = await store.db
        .prepare("SELECT * FROM publisher_crawls WHERE id=? FOR UPDATE")
        .get(request.id);
      const retry = row?.status === "failed" && request.action === "resume";
      if (!row || (!retry && !["running", "paused"].includes(row.status)))
        throw new AppError("This crawl is no longer active.", 409);
      if (retry) {
        if (!enqueue)
          throw new AppError("Start a new publisher crawl to retry.", 409);
        const active = await store.db
          .prepare(
            "SELECT 1 FROM publisher_crawls WHERE publisher_id=? AND status IN ('running','paused')",
          )
          .get(row.publisher_id);
        const job = await store.db
          .prepare("SELECT status FROM scrape_jobs WHERE id=?")
          .get(row.job_id);
        if (active || ["running", "queued"].includes(job?.status))
          throw new AppError(
            "Wait for the active publisher task to finish before retrying.",
            409,
          );
      }
      const status =
        request.action === "cancel"
          ? "cancelled"
          : request.action === "pause"
            ? "paused"
            : "running";
      await store.db
        .prepare(
          `UPDATE publisher_crawls SET status=?,error='',updated_at=?${retry ? ",warnings='[]'" : ""} WHERE id=?`,
        )
        .run(status, Date.now(), row.id);
      if (retry) {
        // Also recover an older fatal crawl stopped partway through its cursor.
        // Retry failed products before their dependent completion markers.
        const remaining: Task[] | null =
          row.frontier === null
            ? null
            : [
                ...new Map<string, Task>(
                  [
                    ...row.frontier.slice(row.frontier_offset),
                    ...row.failed_tasks,
                  ].map((task: Task) => [
                    JSON.stringify([task.kind, task.url]),
                    task,
                  ]),
                ).values(),
              ].sort(
                (a, b) =>
                  Number(a.kind === "complete") - Number(b.kind === "complete"),
              );
        await store.db
          .prepare(
            "UPDATE publisher_crawls SET frontier=?::jsonb,frontier_offset=0,failed_tasks='[]' WHERE id=?",
          )
          .run(JSON.stringify(remaining), row.id);
        const jobId = await enqueue(
          row.id,
          `Retry publisher crawl · ${row.publisher_id}`,
        );
        await store.db
          .prepare("UPDATE publisher_crawls SET job_id=? WHERE id=?")
          .run(jobId, row.id);
      }
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
    if (!["running", "paused"].includes(row.status))
      throw new AppError("This publisher crawl is no longer active.", 409);
    let frontier: Task[] | null = row.frontier;
    let cursor: number = row.frontier_offset;
    const failedTasks: Task[] = row.failed_tasks;
    let stage = "Discovering publisher directory";
    let target = "";
    const warnings: string[] = row.warnings;
    const publisherId = row.publisher_id;
    // One indexed read replaces a lookup per book/category on a full crawl.
    const known = new Set(
      (
        await store.db
          .prepare(
            "SELECT kind,url FROM publisher_crawl_seen WHERE publisher_id=?",
          )
          .all(publisherId)
      ).map((item) => JSON.stringify([item.kind, item.url])),
    );
    const warn = (value: string) => {
      if (value && !warnings.includes(value) && warnings.length < 30)
        warnings.push(value);
    };
    function seen(task: Task) {
      return known.has(JSON.stringify([task.kind, task.url]));
    }
    async function mark(task: Task) {
      await store.db
        .prepare(
          "INSERT INTO publisher_crawl_seen(publisher_id,url,kind) VALUES (?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(publisherId, task.url, task.kind);
      known.add(JSON.stringify([task.kind, task.url]));
    }
    function books(items): Task[] {
      return [
        ...new Map<string, Task>(
          items
            .map((item) => ({
              ...item,
              url: safeProductUrl(item.url, publisherId),
            }))
            .filter((item) => item.url)
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
        await scrapeProgress(`Stage started · ${publisherId} · ${stage}`);
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
          if (result.stale)
            throw new Error(result.failureReason || result.error);
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
          if (result.stale)
            throw new Error(result.failureReason || result.error);
          if (!result.complete) {
            warn(result.error || "The shop listing is incomplete.");
            failedTasks.push({
              kind: "series",
              url: "https://lily-house.com/shop-2/",
              title: "Lily House shop listing",
            });
          }
          frontier = books(result.items);
          if (row.mode === "new-series") {
            const selected = new Set<string>();
            for (const item of result.items) {
              const key = {
                kind: "series" as const,
                url: "series:" + item.series,
                title: item.series,
              };
              if (!seen(key)) selected.add(item.url);
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
                books: books(
                  result.items.filter((item) => item.series === title),
                ).map((task) => task.url),
              })),
            );
        } else {
          const result = await catalogs.getSeriesCategories({
            publisherId,
            refresh: true,
          });
          await scrapeCheckpoint();
          if (result.stale)
            throw new Error(result.failureReason || result.error);
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
            for (const task of frontier) if (!seen(task)) fresh.push(task);
            frontier = fresh;
          }
        }
        await store.db
          .prepare(
            "UPDATE publisher_crawls SET frontier=?::jsonb,frontier_offset=0,discovered=?,warnings=?::jsonb,failed_tasks=?::jsonb,updated_at=? WHERE id=?",
          )
          .run(
            JSON.stringify(frontier),
            frontier.length,
            JSON.stringify(warnings),
            JSON.stringify(failedTasks),
            Date.now(),
            row.id,
          );
        cursor = 0;
        await scrapeProgress(
          `Directory discovered · ${frontier.length} tasks · ${publisherId}`,
        );
      }
      const taskKey = (task: Task) => JSON.stringify([task.kind, task.url]);
      const scheduled = new Set(frontier.map(taskKey));
      while (cursor < frontier.length) {
        await scrapeCheckpoint();
        const task = frontier[cursor];
        stage =
          task.kind === "series"
            ? "Read series catalog"
            : task.kind === "book"
              ? "Warm product details"
              : "Complete series";
        target = task.url;
        await store.db
          .prepare(
            "UPDATE publisher_crawls SET current_label=?,updated_at=? WHERE id=?",
          )
          .run(task.title, Date.now(), row.id);
        await scrapeProgress(
          `Stage started · ${stage} · ${task.title} · ${task.url}`,
        );
        let added: Task[] = [];
        const failedBefore = failedTasks.length;
        try {
          if (task.kind === "series") {
            const result = await catalogs.getPublisherCatalog({
              url: task.url,
              refresh: true,
            });
            await scrapeCheckpoint();
            if (result.stale)
              throw new Error(result.failureReason || result.error);
            if (!result.complete) {
              warn(
                `${task.title}: ${result.error || "Incomplete catalog; not all pages were available."}`,
              );
              failedTasks.push(task);
              await scrapeProgress(
                `Stage incomplete · ${stage} · ${task.url} · ${result.error || "Not all catalog pages were available."}`,
              );
            }
            added = books(result.items);
            // A partial series must remain eligible for a future new-series run.
            if (result.complete)
              added.push({
                ...task,
                kind: "complete",
                books: added.map((book) => book.url),
              });
          } else if (task.kind === "complete") {
            if (
              failedTasks.some(
                (failed) =>
                  failed.kind === "book" &&
                  (!task.books || task.books.includes(failed.url)),
              )
            )
              failedTasks.push(task);
            else await mark({ ...task, kind: "series" });
          } else if (row.mode === "all" || !seen(task)) {
            await internal.warm(publisherId, {
              url: task.url,
              isbn: task.isbn || "",
            });
            await scrapeCheckpoint();
            await mark(task);
          }
        } catch (error) {
          if (
            error instanceof ScrapeInterrupted ||
            (error instanceof AppError &&
              [401, 403, 409].includes(error.status))
          )
            throw error;
          const reason = `${stage} · ${task.title} · ${task.url}: ${errorMessage(error)}`;
          warn(reason);
          failedTasks.push(task);
          await scrapeProgress(`Stage failed · ${reason}`);
        }
        added = added.filter((task) => {
          const key = taskKey(task);
          if (scheduled.has(key)) return false;
          scheduled.add(key);
          return true;
        });
        frontier.push(...added);
        cursor++;
        // Advance a small cursor for products; rewrite/TOAST the large frontier
        // only when a series actually discovers additional tasks.
        await store.db
          .prepare(
            `UPDATE publisher_crawls SET frontier_offset=?,processed=processed+1,
          discovered=discovered+?,warnings=?::jsonb,updated_at=?
          ${added.length ? ",frontier=frontier || ?::jsonb" : ""}
          ${failedTasks.length !== failedBefore ? ",failed_tasks=?::jsonb" : ""} WHERE id=?`,
          )
          .run(
            cursor,
            added.length,
            JSON.stringify(warnings),
            Date.now(),
            ...(added.length ? [JSON.stringify(added)] : []),
            ...(failedTasks.length !== failedBefore
              ? [JSON.stringify(failedTasks)]
              : []),
            row.id,
          );
        await scrapeProgress(
          `Stage finished · ${stage} · ${task.url} · ${cursor}/${frontier.length}`,
        );
      }
      await scrapeCheckpoint();
      const failures = failedTasks.filter(
        (task) => task.kind !== "complete",
      ).length;
      const error = failures
        ? `${failures} publisher task(s) failed. Successful items were retained; resume this crawl to retry failed items. See job events for stage, URL and cause.`
        : "";
      await store.db
        .prepare(
          "UPDATE publisher_crawls SET status=?,frontier=?::jsonb,frontier_offset=0,failed_tasks='[]',current_label='',error=?,updated_at=? WHERE id=?",
        )
        .run(
          failures ? "failed" : "completed",
          JSON.stringify(failedTasks),
          error,
          Date.now(),
          row.id,
        );
      if (failures) return { status: "failed", error, warnings };
      return { message: "Publisher cache warm-up completed.", warnings };
    } catch (error) {
      if (error instanceof ScrapeInterrupted) throw error;
      const reason = `${stage}${target ? " · " + target : ""}: ${errorMessage(error)}`;
      await scrapeProgress(`Crawl failed · ${publisherId} · ${reason}`);
      await store.db
        .prepare(
          "UPDATE publisher_crawls SET status=CASE WHEN status='cancelled' THEN status ELSE 'failed' END,error=?,updated_at=? WHERE id=?",
        )
        .run(reason.slice(0, 2000), Date.now(), row.id);
      throw new AppError(reason, 409);
    }
  }
  return {
    getPublisherCrawls,
    startPublisherCrawl,
    managePublisherCrawl,
    crawlPublisher,
  };
}
