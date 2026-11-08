import { AppError, type Store } from "./store.ts";

// Page loads fan out to multiple publisher feeds and can overlap across tabs or
// refreshes. Give RPCs headroom without relaxing import/backup transfer limits.
export const RPC_LIMITS = Object.freeze({
  requestsPerMinute: 1_200,
  concurrentRequests: 32,
});

// Stable, server-generated keys only: do not let callers choose an unbounded
// namespace or spoof IP addresses through forwarded headers.
export async function enforceRateLimit(
  store: Store,
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  await store.db
    .prepare("DELETE FROM request_limits WHERE resets_at<=?")
    .run(now);
  const row = await store.db
    .prepare(
      `
    INSERT INTO request_limits (key,attempts,resets_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=request_limits.attempts+1
    RETURNING attempts
  `,
    )
    .get(key, now + windowMs);
  if (Number(row.attempts) > limit)
    throw new AppError("Too many requests. Please try again shortly.", 429);
}

// Route bundles and development reloads must share the same concurrency pool.
const requestGlobal = globalThis as typeof globalThis & {
  __bookCollectionActiveRequests?: Map<number, number>;
};
const active = (requestGlobal.__bookCollectionActiveRequests ||= new Map<
  number,
  number
>());
export async function limitConcurrentRequests<T>(
  userId: number,
  action: () => Promise<T>,
  limit = 4,
) {
  const count = active.get(userId) || 0;
  if (count >= limit)
    throw new AppError("Your library is busy. Please try again shortly.", 429);
  active.set(userId, count + 1);
  try {
    return await action();
  } finally {
    const remaining = (active.get(userId) || 1) - 1;
    if (remaining) active.set(userId, remaining);
    else active.delete(userId);
  }
}
