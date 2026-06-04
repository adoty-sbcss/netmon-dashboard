/**
 * Minimal, dependency-free evaluator for standard 5-field cron expressions
 * (minute hour day-of-month month day-of-week), interpreted in UTC.
 *
 * WHY THIS EXISTS: the AI analysis Job wakes on a FIXED platform schedule (hourly
 * — see infra/main.bicep `aiCron`) and then decides IN CODE whether the user's
 * IN-APP schedule (ai_settings.schedule_cron, edited at /settings/ai) is due. That
 * keeps the editable schedule authoritative without a redeploy — the same
 * "wake often, gate in code" pattern src/ingest/sync.ts uses for the SFTP Job.
 *
 * Scope: enough for the schedule presets (all on-the-hour) plus typed-in standard
 * crons with *, lists, ranges, and steps. NOT a full vixie-cron implementation
 * (no @keywords, month/day NAMES, or 'L'/'W'/'#'). No `server-only` so the cron
 * Job can import it under tsx.
 */

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** Whether the day-of-month / day-of-week fields are constrained (not "*"). */
  domRestricted: boolean;
  dowRestricted: boolean;
}

// Expand one field to its allowed ints. Supports "*", a single value, "a-b"
// ranges, comma lists, and step syntax (e.g. a quarter-hourly minute field).
function parseField(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : parseInt(stepPart, 10);
    if (!Number.isFinite(step) || step < 1) throw new Error(`bad step "${part}"`);

    let lo = min;
    let hi = max;
    if (rangePart !== "*") {
      const m = rangePart.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error(`bad field "${part}"`);
      lo = parseInt(m[1], 10);
      // "5/10" means 5..max step 10; "5" alone means exactly 5; "5-9" is a range.
      hi = m[2] !== undefined ? parseInt(m[2], 10) : stepPart !== undefined ? max : lo;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`out of range "${part}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Parse a 5-field cron, or null if it isn't a shape we support. */
export function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    const minute = parseField(parts[0], 0, 59);
    const hour = parseField(parts[1], 0, 23);
    const dom = parseField(parts[2], 1, 31);
    const month = parseField(parts[3], 1, 12);
    let dow = parseField(parts[4], 0, 7);
    if (dow.has(7)) {
      dow = new Set(dow);
      dow.delete(7); // both 0 and 7 mean Sunday
      dow.add(0);
    }
    return {
      minute,
      hour,
      dom,
      month,
      dow,
      domRestricted: parts[2] !== "*",
      dowRestricted: parts[4] !== "*",
    };
  } catch {
    return null;
  }
}

function matches(f: CronFields, d: Date): boolean {
  if (!f.minute.has(d.getUTCMinutes())) return false;
  if (!f.hour.has(d.getUTCHours())) return false;
  if (!f.month.has(d.getUTCMonth() + 1)) return false;
  const domOk = f.dom.has(d.getUTCDate());
  const dowOk = f.dow.has(d.getUTCDay());
  // Standard cron rule: when BOTH day fields are restricted, match on EITHER.
  if (f.domRestricted && f.dowRestricted) return domOk || dowOk;
  if (f.domRestricted) return domOk;
  if (f.dowRestricted) return dowOk;
  return true; // both "*"
}

// Backward scan bound: 366 days of minutes covers daily/weekly/monthly/yearly
// presets. We break on the first match, so daily/weekly resolve in <= 8 days.
const MAX_SCAN_MINUTES = 366 * 24 * 60;

/** The most recent instant at or before `now` (UTC) that the cron fires, or null. */
export function previousFireTime(f: CronFields, now: Date): Date | null {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    if (matches(f, d)) return new Date(d);
    d.setUTCMinutes(d.getUTCMinutes() - 1);
  }
  return null;
}

/** Fallback used when the stored expression can't be parsed. */
const DEFAULT_CRON = "0 2 * * *";

/**
 * True when a scheduled run is due now: the cron's most recent fire time is newer
 * than the last scheduled run. This runs once per slot, is robust to wake jitter
 * (the Job rarely fires exactly on the minute), and catches up a missed wake.
 *
 * An unparseable expression falls back to the default (daily 02:00 UTC) rather
 * than silently never running.
 */
export function isScheduledRunDue(
  expr: string,
  now: Date,
  lastRunAt: Date | null,
): boolean {
  const fields = parseCron(expr) ?? parseCron(DEFAULT_CRON);
  if (!fields) return false; // unreachable: DEFAULT_CRON always parses
  const prev = previousFireTime(fields, now);
  if (!prev) return false;
  return lastRunAt === null || lastRunAt.getTime() < prev.getTime();
}
