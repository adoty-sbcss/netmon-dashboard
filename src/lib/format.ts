/** Small display formatters shared across server + client components. */

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago" / "in 2 days" from a Date (or null → "never"). */
export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000000],
    ["month", 2592000000],
    ["week", 604800000],
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000],
    ["second", 1000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "second") {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}

/** "May 29, 2026, 3:00 PM" */
export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Coerce a value that *should* be a timestamp into a real Date (or null).
 *
 * Drizzle + postgres.js return SQL aggregates (`max()`/`min()`) and raw
 * `sql<Date>` expressions as STRINGS even when typed `Date`, because those
 * expressions carry no column decoder. Calling a Date method (`.getTime()`) on
 * one throws and 500s the page (this is exactly what broke the Sensors page).
 * Direct table columns already arrive as real Dates and pass through untouched.
 * Null-safe and idempotent — safe to wrap any timestamp leaving the query layer.
 */
export function asDate(d: Date | string | number | null | undefined): Date | null {
  if (d == null) return null;
  if (d instanceof Date) return d;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Compact integer formatting: 1234 → "1,234". */
export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

/** Title-case a slug for display when no human name is set: "north-idf" → "North Idf". */
export function titleizeSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Acronyms that should stay upper-cased when a slug is humanized for navigation
 * chrome (breadcrumbs, tabs). Keyed by their lower-case form.
 */
const ACRONYMS = new Set([
  "ai",
  "dns",
  "dhcp",
  "stp",
  "lldp",
  "cdp",
  "sftp",
  "snmp",
  "idf",
  "vlan",
  "ip",
  "id",
]);

/**
 * Like titleizeSlug, but keeps known networking acronyms upper-cased:
 * "dns" → "DNS", "north-idf" → "North IDF".
 */
export function prettySegment(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}
