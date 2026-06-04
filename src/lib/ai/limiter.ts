/**
 * Process-wide pacing for outbound model calls so a burst of analyses (the
 * scheduled sweep across many schools, or rapid manual re-runs) stays under the
 * provider's per-minute rate limit instead of tripping 429s.
 *
 * Two intentionally-simple mechanisms:
 *   - a CONCURRENCY GATE (AI_CONCURRENCY, default 1) so calls don't fan out all
 *     at once;
 *   - an ADAPTIVE COOLDOWN: when a call returns 429 we read the provider's
 *     Retry-After and make every subsequent call wait that long. This self-tunes
 *     to the real quota — important for Azure OpenAI, which reserves
 *     max_completion_tokens against TPM — without hardcoding a TPM number.
 *
 * The provider SDKs already retry 429s with Retry-After-aware backoff (maxRetries,
 * set per adapter); this gate handles SUSTAINED over-quota by spacing the sweep.
 * No `server-only`: the cron Job imports it under tsx.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_CONCURRENCY = Math.max(1, Number(process.env.AI_CONCURRENCY) || 1);

let active = 0;
const waiters: (() => void)[] = [];
let cooldownUntil = 0;

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) {
    active++;
    next();
  }
}

/** Note that a 429 was seen; pause new dispatch for at least `seconds`. */
export function noteRateLimit(seconds: number): void {
  const until = Date.now() + Math.max(1, seconds) * 1000;
  if (until > cooldownUntil) cooldownUntil = until;
}

/** Retry-After seconds from a provider error, or null when it isn't a 429. */
export function retryAfterSeconds(err: unknown): number | null {
  const e = err as { status?: number; headers?: unknown } | null;
  if (!e || e.status !== 429) return null;
  const h = e.headers;
  let raw: string | null | undefined;
  if (h && typeof (h as { get?: unknown }).get === "function") {
    raw = (h as { get: (k: string) => string | null }).get("retry-after");
  } else if (h && typeof h === "object") {
    raw = (h as Record<string, string>)["retry-after"];
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30; // default when header absent
}

/** Run `fn` under the concurrency gate, waiting out any active cooldown first. */
export async function schedule<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await sleep(wait);
    return await fn();
  } finally {
    release();
  }
}

/** Test/diagnostic hook — current cooldown remaining in ms (0 when clear). */
export function cooldownRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}
