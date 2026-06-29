/**
 * Shared input coercers for the bearer-authenticated sensor result routes
 * (iperf / latency / speedtest). These parse UNTRUSTED collector JSON, so keeping
 * a single copy stops the validation from drifting between the three routes.
 */

/** Finite number, else null. */
export const coerceNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Integer, else null. */
export const coerceInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) ? v : null;

/** String, else null. */
export const coerceStr = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

/** Caller-supplied ISO timestamp string → Date, or null if absent/unparseable. */
export const parseStartedAt = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
