import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AppError, type Store } from "./store.ts";
import { ScrapeInterrupted, withScrapeRuntime } from "./scrape-runtime.ts";
import {
  JOB_STATUSES,
  type QueueQuery,
  type QueueOverview,
  type ScrapeJob,
  type JobDetail,
} from "../queue.ts";

type Handler = (payload: any) => Promise<unknown>;
const CONCURRENCY = 2;
const LEASE_MS = 60_000;
const RETRY_MS = 15 * 60_000;
const WAIT_MS = 90_000;
const QUEUE_LOCK = 726005;

function jobRecord(row): ScrapeJob {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    userId: row.user_id,
    username: row.username,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  };
}

// A job is a serializable application operation, never a stored closure, cookie
// or publisher handshake. Workers re-read the account's role before each run.
export function createScrapeQueue(
  store: Store,
  handlers: Record<string, Handler>,
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking: Promise<void> | undefined;
  let stopped = false;
  const active = new Set<Promise<void>>();
  const event = async (
    id: string,
    message: string,
    actorId: number | null = null,
  ) => {
    await store.db
      .prepare(
        "INSERT INTO scrape_job_events(job_id,created_at,message,actor_id) VALUES (?,?,?,?)",
      )
      .run(id, Date.now(), message, actorId);
  };
  async function locked<T>(action: () => Promise<T>) {
    return store.transaction(async () => {
      await store.db.query("SELECT pg_advisory_xact_lock($1)", [QUEUE_LOCK]);
      return action();
    });
  }
  async function enqueue(
    kind: string,
    payload: unknown,
    label: string,
    priority = 0,
  ) {
    if (typeof kind !== "string" || !Object.hasOwn(handlers, kind))
      throw new AppError("Unknown scraping task.");
    const user = store.currentUser();
    const json = JSON.stringify(payload ?? null);
    if (json.length > 32_000) throw new AppError("Scraping task is too large.");
    const canonical = JSON.stringify(JSON.parse(json), (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : value,
    );
    const key = createHash("sha256")
      .update(JSON.stringify([user.id, kind, canonical]))
      .digest("hex");
    const id = randomUUID();
    const now = Date.now();
    return locked(async () => {
      const existing = await store.db
        .prepare(
          "SELECT id FROM scrape_jobs WHERE dedupe_key=? AND status IN ('queued','running')",
        )
        .get(key);
      if (existing) return existing.id as string;
      const backlog = await store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM scrape_jobs WHERE user_id=? AND status IN ('queued','running')",
        )
        .get(user.id);
      if (backlog.count >= 200)
        throw new AppError(
          "Too many scraping tasks are waiting for this account. Try again after some finish.",
          429,
        );
      const row = await store.db
        .prepare(
          `
      INSERT INTO scrape_jobs(id,dedupe_key,kind,payload,label,user_id,status,priority,available_at,created_at)
      VALUES (?,?,?,?::jsonb,?,?,'queued',?,?,?)
      ON CONFLICT(dedupe_key) WHERE status IN ('queued','running')
      DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING *
    `,
        )
        .get(
          id,
          key,
          kind,
          json,
          label.slice(0, 500),
          user.id,
          priority,
          now,
          now,
        );
      if (row.id === id) await event(id, "Queued", user.id);
      return row.id as string;
    });
  }
  async function claim() {
    return locked(async () => {
      const now = Date.now();
      const abandoned = await store.db
        .prepare(
          `
        UPDATE scrape_jobs SET status=CASE WHEN attempts<max_attempts THEN 'queued' ELSE 'failed' END,
          lease_token=NULL,lease_until=NULL,available_at=?,
          finished_at=CASE WHEN attempts>=max_attempts THEN ?::bigint ELSE NULL END,
          error='Worker lease expired; recovered after interruption.'
        WHERE status='running' AND lease_until<=? RETURNING id,status
      `,
        )
        .all(now, now, now);
      for (const row of abandoned)
        await event(
          row.id,
          `Worker interrupted; ${row.status === "queued" ? "requeued" : "attempt limit reached"}`,
        );
      const settings = await store.db
        .prepare("SELECT paused FROM scrape_queue_settings WHERE id=1")
        .get();
      if (settings.paused) return null;
      const count = await store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM scrape_jobs WHERE status='running'",
        )
        .get();
      if (count.count >= CONCURRENCY) return null;
      return store.db
        .prepare(
          `
        UPDATE scrape_jobs SET status='running',attempts=attempts+1,started_at=?,finished_at=NULL,
          lease_token=?,lease_until=?
        WHERE id=(SELECT id FROM scrape_jobs WHERE status='queued' AND available_at<=?
          AND (kind<>'crawlPublisher' OR (
            NOT EXISTS(SELECT 1 FROM scrape_jobs WHERE kind='crawlPublisher' AND status='running')
            AND NOT EXISTS(SELECT 1 FROM scrape_jobs WHERE kind<>'crawlPublisher' AND status IN ('queued','running') AND available_at<=?)
          ))
          ORDER BY priority DESC,sequence LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *
      `,
        )
        .get(now, randomUUID(), now + LEASE_MS, now, now);
    });
  }
  async function perform(row) {
    async function checkpoint() {
      for (;;) {
        if (stopped) throw new ScrapeInterrupted("Worker stopping.");
        const job = await store.db
          .prepare("SELECT status,lease_token FROM scrape_jobs WHERE id=?")
          .get(row.id);
        if (job?.status !== "running" || job.lease_token !== row.lease_token)
          throw new ScrapeInterrupted("Worker lease changed.");
        const crawl = await store.db
          .prepare("SELECT status FROM publisher_crawls WHERE id=?")
          .get(row.payload.id);
        if (!crawl || ["cancelled", "failed"].includes(crawl.status))
          throw new AppError("Publisher crawl stopped.", 409);
        const user = await store.db
          .prepare("SELECT role,disabled FROM users WHERE id=?")
          .get(row.user_id);
        if (user?.role !== "admin" || user.disabled)
          throw new AppError("Administrator access revoked.", 403);
        const settings = await store.db
          .prepare("SELECT paused FROM scrape_queue_settings WHERE id=1")
          .get();
        const foreground = await store.db
          .prepare(
            "SELECT 1 FROM scrape_jobs WHERE kind<>'crawlPublisher' AND status IN ('queued','running') AND available_at<=? LIMIT 1",
          )
          .get(Date.now());
        if (!settings.paused && crawl.status !== "paused" && !foreground)
          return;
        await delay(250);
      }
    }
    // Serializes parallel adapter requests as well as pacing across app instances.
    let tail: Promise<unknown> = Promise.resolve();
    let minimumDelay = 10_000;
    function request<T>(url: string, load: () => Promise<T>): Promise<T> {
      const work = tail.then(async () => {
        const host = new URL(url).hostname;
        const owner = randomUUID();
        for (;;) {
          await checkpoint();
          const now = Date.now();
          const slot = await store.db
            .prepare(
              `INSERT INTO publisher_request_slots(host,available_at,owner) VALUES (?,?,?)
            ON CONFLICT(host) DO UPDATE SET available_at=EXCLUDED.available_at,owner=EXCLUDED.owner
            WHERE publisher_request_slots.available_at<=? RETURNING host`,
            )
            .get(host, now + 120_000, owner, now);
          if (slot) break;
          await delay(250);
        }
        let cooldown = minimumDelay;
        try {
          await checkpoint();
          const result = await load();
          const response = result as any;
          if (response?.status === 429 || response?.status >= 500) {
            const retry = response.headers?.["retry-after"];
            const seconds = /^\d+$/.test(retry || "")
              ? Number(retry) * 1000
              : Date.parse(retry) - Date.now();
            cooldown = Math.max(
              15 * 60_000,
              Number.isFinite(seconds) ? seconds : 0,
            );
          }
          return result;
        } catch (error) {
          if (!(error instanceof ScrapeInterrupted)) cooldown = 15 * 60_000;
          throw error;
        } finally {
          await store.db
            .prepare(
              "UPDATE publisher_request_slots SET available_at=? WHERE host=? AND owner=?",
            )
            .run(Date.now() + cooldown, host, owner);
        }
      });
      tail = work.catch(() => {});
      return work;
    }
    const heartbeat = setInterval(() => {
      void store.db
        .prepare(
          "UPDATE scrape_jobs SET lease_until=? WHERE id=? AND status='running' AND lease_token=?",
        )
        .run(Date.now() + LEASE_MS, row.id, row.lease_token)
        .catch((error) =>
          console.error("Scraping queue heartbeat failed:", error.message),
        );
    }, LEASE_MS / 4);
    heartbeat.unref();
    try {
      await event(row.id, `Started attempt ${row.attempts}`);
      const result = await store.forUser(
        { id: row.user_id } as any,
        async () => {
          if (!Object.hasOwn(handlers, row.kind))
            throw new AppError("This task is no longer supported.");
          return row.kind === "crawlPublisher"
            ? withScrapeRuntime(
                {
                  checkpoint,
                  request,
                  minimumDelay: (ms) => {
                    minimumDelay = Math.max(minimumDelay, ms);
                  },
                },
                () => handlers[row.kind](row.payload),
              )
            : handlers[row.kind](row.payload);
        },
      );
      const value = result as any;
      const failed =
        value?.stale ||
        value?.error ||
        (value?.found === false && value?.warnings?.length > 0) ||
        value?.status === "failed" ||
        value?.status === "unavailable";
      // Fence an old worker after lease recovery. Network work is at-least-once;
      // stale workers cannot overwrite the current job's result or status.
      await store.transaction(async () => {
        const changed = await store.db
          .prepare(
            `UPDATE scrape_jobs SET status=?,result=?::jsonb,
          error=?,finished_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?`,
          )
          .run(
            failed ? "failed" : "succeeded",
            JSON.stringify(result ?? null),
            failed
              ? String(
                  value.error ||
                    value.message ||
                    "Source unavailable; previous results retained.",
                ).slice(0, 2000)
              : "",
            Date.now(),
            row.id,
            row.lease_token,
          );
        if (changed.changes)
          await event(
            row.id,
            failed ? "Source failed; fallback result retained" : "Completed",
          );
      });
    } catch (error) {
      if (error instanceof ScrapeInterrupted) {
        await store.db
          .prepare(
            `UPDATE scrape_jobs SET status='queued',attempts=GREATEST(0,attempts-1),
          lease_token=NULL,lease_until=NULL,available_at=? WHERE id=? AND status='running' AND lease_token=?`,
          )
          .run(Date.now(), row.id, row.lease_token);
        return;
      }
      const retry =
        !(error instanceof AppError && error.status < 500) &&
        row.attempts < row.max_attempts;
      await store.transaction(async () => {
        const changed = await store.db
          .prepare(
            `UPDATE scrape_jobs SET status=?,error=?,available_at=?,finished_at=?,
          lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?`,
          )
          .run(
            retry ? "queued" : "failed",
            String(error.message || "Scraping failed.").slice(0, 2000),
            Date.now() + RETRY_MS,
            retry ? null : Date.now(),
            row.id,
            row.lease_token,
          );
        if (changed.changes)
          await event(
            row.id,
            retry
              ? "Failed; retry scheduled after source cooldown"
              : "Failed; no automatic attempts remain",
          );
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
  async function tick() {
    if (stopped) return;
    if (ticking) return ticking;
    ticking = (async () => {
      while (!stopped && active.size < CONCURRENCY) {
        const row = await claim();
        if (!row) break;
        const work = perform(row)
          .catch((error) =>
            console.error("Scraping worker failed:", error.message),
          )
          .finally(() => active.delete(work));
        active.add(work);
      }
    })().finally(() => {
      ticking = undefined;
    });
    return ticking;
  }
  function start() {
    if (timer || stopped) return;
    timer = setInterval(() => {
      void tick().catch((error) =>
        console.error("Scraping queue failed:", error.message),
      );
    }, 1000);
    timer.unref();
    void tick().catch((error) =>
      console.error("Scraping queue startup failed:", error.message),
    );
  }
  async function stop() {
    stopped = true;
    clearInterval(timer);
    await ticking;
    await Promise.all(active);
  }
  async function wait(id: string) {
    const until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
      const row = await store.db
        .prepare(
          "SELECT status,result,error,user_id,available_at FROM scrape_jobs WHERE id=?",
        )
        .get(id);
      if (!row || row.user_id !== store.currentUser().id)
        throw new AppError("Scraping task not found.", 404);
      if (
        row.status === "succeeded" ||
        (row.status === "failed" && row.result !== null)
      )
        return row.result;
      if (row.status === "failed" || row.status === "cancelled")
        throw new AppError(row.error || "Scraping task cancelled.", 409);
      if (row.status === "queued" && row.available_at > Date.now())
        throw new AppError(
          "The source is unavailable. Your task will retry after the cooldown.",
          503,
        );
      // Requests do not hold open for a fifteen-minute retry delay or a paused queue.
      const settings = await store.db
        .prepare("SELECT paused FROM scrape_queue_settings WHERE id=1")
        .get();
      if (settings.paused && row.status === "queued")
        throw new AppError(
          "Scraping is paused. Your task is queued for later.",
          503,
        );
      await tick();
      await delay(200);
    }
    throw new AppError(
      "Scraping is still queued or running. It will continue in the background; check again shortly.",
      503,
    );
  }
  async function run(kind: string, payload: unknown, label: string) {
    return wait(await enqueue(kind, payload, label, 10));
  }
  async function getScrapeQueue(
    request: QueueQuery = {},
  ): Promise<QueueOverview> {
    store.requireAdmin();
    if (!request || typeof request !== "object" || Array.isArray(request))
      throw new AppError("Choose queue filters.");
    const status = request.status || "all";
    if (status !== "all" && !JOB_STATUSES.includes(status))
      throw new AppError("Choose a task status.");
    const search = String(request.search || "")
      .trim()
      .slice(0, 200)
      .toLowerCase();
    const params = [status, status, search, "%" + search + "%"];
    const where =
      "(?='all' OR j.status=?) AND (?='' OR lower(j.label || ' ' || j.kind || ' ' || u.username || ' ' || j.id) LIKE ?)";
    const count = await store.db
      .prepare(
        `SELECT COUNT(*) AS count FROM scrape_jobs j JOIN users u ON u.id=j.user_id WHERE ${where}`,
      )
      .get(...params);
    const pages = Math.max(1, Math.ceil(count.count / 20));
    const page = Math.min(
      pages,
      Math.max(1, Number.isSafeInteger(request.page) ? request.page : 1),
    );
    const rows = await store.db
      .prepare(
        `SELECT j.id,j.kind,j.label,j.user_id,j.status,j.priority,j.attempts,j.max_attempts,
          j.available_at,j.created_at,j.started_at,j.finished_at,j.error,u.username
          FROM scrape_jobs j JOIN users u ON u.id=j.user_id
       WHERE ${where} ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
        j.priority DESC,CASE WHEN j.status='queued' THEN j.sequence END ASC,j.created_at DESC,j.id LIMIT 20 OFFSET ?`,
      )
      .all(...params, (page - 1) * 20);
    const counts = Object.fromEntries(
      JOB_STATUSES.map((s) => [s, 0]),
    ) as QueueOverview["counts"];
    for (const row of await store.db
      .prepare(
        "SELECT status,COUNT(*) AS count FROM scrape_jobs GROUP BY status",
      )
      .all())
      counts[row.status] = row.count;
    const settings = await store.db
      .prepare("SELECT paused FROM scrape_queue_settings WHERE id=1")
      .get();
    return {
      paused: settings.paused,
      concurrency: CONCURRENCY,
      counts,
      jobs: rows.map(jobRecord),
      total: count.count,
      page,
      pages,
    };
  }
  async function getScrapeJob(request: { id: string }): Promise<JobDetail> {
    store.requireAdmin();
    if (typeof request?.id !== "string")
      throw new AppError("Choose a scraping task.");
    const row = await store.db
      .prepare(
        "SELECT j.*,u.username FROM scrape_jobs j JOIN users u ON u.id=j.user_id WHERE j.id=?",
      )
      .get(request.id);
    if (!row) throw new AppError("Scraping task not found.", 404);
    const events = await store.db
      .prepare(
        `SELECT e.id,e.created_at AS "createdAt",e.message,u.username AS actor
      FROM scrape_job_events e LEFT JOIN users u ON u.id=e.actor_id WHERE job_id=? ORDER BY e.id`,
      )
      .all(row.id);
    return {
      ...jobRecord(row),
      payload: row.payload,
      result: row.result,
      events,
    };
  }
  async function manageScrapeQueue(request: { paused: boolean }) {
    store.requireAdmin();
    if (typeof request?.paused !== "boolean")
      throw new AppError("Choose whether to pause scraping.");
    await locked(async () => {
      await store.db
        .prepare("UPDATE scrape_queue_settings SET paused=? WHERE id=1")
        .run(request.paused);
    });
    return { paused: request.paused };
  }
  async function manageScrapeJob(request: {
    id: string;
    action: "fasttrack" | "cancel" | "retry";
  }) {
    store.requireAdmin();
    if (
      typeof request?.id !== "string" ||
      !["fasttrack", "cancel", "retry"].includes(request.action)
    )
      throw new AppError("Choose a task action.");
    return locked(async () => {
      const row = await store.db
        .prepare("SELECT * FROM scrape_jobs WHERE id=? FOR UPDATE")
        .get(request.id);
      if (!row) throw new AppError("Scraping task not found.", 404);
      if (row.kind === "crawlPublisher")
        throw new AppError(
          "Use Publisher crawls to manage this background task.",
          409,
        );
      if (request.action === "retry") {
        if (!["failed", "cancelled", "succeeded"].includes(row.status))
          throw new AppError("Only a finished task can be queued again.", 409);
        const id = await store.forUser({ id: row.user_id } as any, () =>
          enqueue(row.kind, row.payload, row.label),
        );
        await event(id, `Requeued from ${row.id}`, store.currentUser().id);
        return { id };
      }
      if (row.status !== "queued")
        throw new AppError(
          "Only waiting tasks can be fast-tracked or cancelled. Running tasks finish safely.",
          409,
        );
      if (request.action === "fasttrack") {
        // Never bypass source cooldowns or preempt work already in flight.
        await store.db
          .prepare("UPDATE scrape_jobs SET priority=100 WHERE id=?")
          .run(row.id);
      } else {
        await store.db
          .prepare(
            "UPDATE scrape_jobs SET status='cancelled',finished_at=?,error='Cancelled by an administrator.' WHERE id=?",
          )
          .run(Date.now(), row.id);
      }
      await event(
        row.id,
        request.action === "fasttrack"
          ? "Fast-tracked by administrator"
          : "Cancelled by administrator",
        store.currentUser().id,
      );
      return { id: row.id };
    });
  }
  store.onClose(stop);
  return {
    enqueue,
    run,
    wait,
    tick,
    start,
    stop,
    updateHandlers: (next: Record<string, Handler>) => {
      handlers = next;
    },
    getScrapeQueue,
    getScrapeJob,
    manageScrapeQueue,
    manageScrapeJob,
  };
}
