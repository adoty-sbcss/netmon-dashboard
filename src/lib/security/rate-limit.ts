import "server-only";

/**
 * Tiny in-memory fixed-window rate limiter.
 *
 * The web app runs as a single Container App replica (scale 0..1), so a
 * module-level Map is a correct, dependency-free throttle — no Redis needed.
 * It is intentionally best-effort abuse control, NOT an auth boundary: if the
 * web tier is ever scaled past one replica, move this to a shared store
 * (each replica would otherwise keep its own counters).
 */

interface Bucket {
  count: number;
  resetAt: number; // epoch ms when the window rolls over
}

const buckets = new Map<string, Bucket>();
let lastPrune = 0;

/** Drop expired buckets occasionally so the Map can't grow without bound. */
function prune(now: number): void {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Count one hit against `key`. Returns `ok: false` once `limit` hits occur
 * inside `windowMs`, with the seconds remaining until the window resets.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  prune(now);

  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, retryAfterSec: 0 };
}

/**
 * Best-effort client IP from proxy headers. Azure Container Apps' ingress sets
 * `x-forwarded-for` (client first, proxies appended). Used only as a throttle
 * key, so a spoofed value just buckets an attacker against themselves.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
