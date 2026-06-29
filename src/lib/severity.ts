/**
 * Canonical severity ordering, shared so the sort rank isn't re-declared in
 * every consumer (issues queries/reconcile, the topology + security AI panels).
 * Kept dependency-free so it's safe to import from both server and client code.
 */

/** Severity levels, most-severe first. */
export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

/**
 * Sort rank for a severity string: critical=0 … info=4. An unknown/missing value
 * returns 9 so it sorts after the known levels (matches the prior `?? 9` callers).
 */
export function severityRank(severity: string | null | undefined): number {
  if (!severity) return 9;
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
  return i === -1 ? 9 : i;
}
