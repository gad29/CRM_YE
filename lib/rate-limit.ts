// Fixed-window counters in PostgreSQL. Shared across processes and restarts,
// so a brute-force attempt can't reset its budget by waiting for a redeploy.
import { sql, sqlOne } from '@/lib/db';

/**
 * Count one hit against `key`; returns true while the window still has budget.
 * The first hit after a window expires starts a fresh window.
 */
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number) {
  const row = await sqlOne<{ count: number }>(
    `INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowSeconds],
  );
  // Opportunistic cleanup keeps the table small without a cron job.
  if (Math.random() < 0.02) {
    void sql("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'").catch(() => undefined);
  }
  return (row?.count ?? 0) <= limit;
}

/** True when `key` has already used up `limit` hits in the current window (does not count a hit). */
export async function isRateLimited(key: string, limit: number, windowSeconds: number) {
  const row = await sqlOne<{ count: number }>(
    'SELECT count FROM rate_limits WHERE key = $1 AND window_start >= now() - make_interval(secs => $2)',
    [key, windowSeconds],
  );
  return (row?.count ?? 0) >= limit;
}

export async function clearRateLimit(key: string) {
  await sql('DELETE FROM rate_limits WHERE key = $1', [key]);
}
