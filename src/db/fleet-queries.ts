/**
 * County-wide ("fleet") rollups + global search that span EVERY district a user
 * is scoped to — the oversight view a super/county admin needs above the
 * per-district aggregate pages. Kept in its own module (like district-queries.ts)
 * to stay clear of concurrent edits in queries.ts.
 *
 * Every function takes `scope`: an array of district ids the caller may see, or
 * `null` for unrestricted (superadmin / global grant). An EMPTY array means the
 * user can see nothing — these return empty without touching the DB.
 */
import "server-only";
import { and, desc, eq, ilike, inArray, or, type Column, type SQL } from "drizzle-orm";

import { db } from "./index";
import { districts, schools, sensors } from "./schema/app";
import { entitiesHost } from "./schema/entities";
import { scanRuns, findings } from "./schema/netmon";
import { titleizeSlug } from "../lib/format";

export type Scope = number[] | null;

/** Restrict a district-id column to the caller's scope (no clause when unrestricted). */
function scopeWhere(col: Column, scope: Scope): SQL | undefined {
  return scope ? inArray(col, scope) : undefined;
}

/** True when the scope can never match anything (empty allow-list). */
function scopeIsEmpty(scope: Scope): boolean {
  return Array.isArray(scope) && scope.length === 0;
}

// ---- fleet findings -------------------------------------------------------

export interface FleetFindingRow {
  id: number;
  severity: string;
  title: string;
  detail: string | null;
  rule: string;
  districtSlug: string;
  districtName: string;
  schoolSlug: string;
  schoolName: string | null;
  createdAt: Date | null;
}

export async function listFleetFindings(
  scope: Scope,
  limit = 300,
): Promise<FleetFindingRow[]> {
  if (scopeIsEmpty(scope)) return [];
  return db
    .select({
      id: findings.id,
      severity: findings.severity,
      title: findings.title,
      detail: findings.detail,
      rule: findings.rule,
      districtSlug: districts.slug,
      districtName: districts.name,
      schoolSlug: schools.slug,
      schoolName: schools.name,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .innerJoin(scanRuns, eq(findings.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .innerJoin(districts, eq(schools.districtId, districts.id))
    .where(scopeWhere(districts.id, scope))
    .orderBy(desc(findings.createdAt))
    .limit(limit);
}

// ---- fleet sensors --------------------------------------------------------

export interface FleetSensorRow {
  id: number;
  slug: string;
  name: string | null;
  lastCheckinAt: Date | null;
  agentVersion: string | null;
  localIp: string | null;
  reportedConfigVersion: number | null;
  schoolSlug: string;
  schoolName: string | null;
  districtSlug: string;
  districtName: string;
}

export async function listFleetSensors(scope: Scope): Promise<FleetSensorRow[]> {
  if (scopeIsEmpty(scope)) return [];
  return db
    .select({
      id: sensors.id,
      slug: sensors.slug,
      name: sensors.name,
      lastCheckinAt: sensors.lastCheckinAt,
      agentVersion: sensors.agentVersion,
      localIp: sensors.localIp,
      reportedConfigVersion: sensors.reportedConfigVersion,
      schoolSlug: schools.slug,
      schoolName: schools.name,
      districtSlug: districts.slug,
      districtName: districts.name,
    })
    .from(sensors)
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .innerJoin(districts, eq(schools.districtId, districts.id))
    .where(scopeWhere(districts.id, scope))
    .orderBy(districts.name, schools.name, sensors.slug);
}

// ---- global search --------------------------------------------------------

export interface SearchHit {
  type: "district" | "school" | "sensor" | "host";
  label: string;
  sublabel: string;
  href: string;
}

export interface SearchResults {
  districts: SearchHit[];
  schools: SearchHit[];
  sensors: SearchHit[];
  hosts: SearchHit[];
}

const EMPTY_RESULTS: SearchResults = {
  districts: [],
  schools: [],
  sensors: [],
  hosts: [],
};

/**
 * Jump-to search across the tenancy a user can see. Matches names/slugs and,
 * for sensors/hosts, IP/MAC. Each category is capped; results carry a ready-made
 * href into the existing detail pages.
 */
export async function searchFleet(
  term: string,
  scope: Scope,
  perCategory = 6,
): Promise<SearchResults> {
  const cleaned = term.trim();
  if (cleaned.length < 2 || scopeIsEmpty(scope)) return EMPTY_RESULTS;

  // Treat the term as a literal substring — escape LIKE wildcards so a stray
  // "%" or "_" the user types doesn't match everything.
  const pattern = `%${cleaned.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const within = (col: Column) => scopeWhere(col, scope);

  const [districtRows, schoolRows, sensorRows, hostRows] = await Promise.all([
    db
      .select({ slug: districts.slug, name: districts.name })
      .from(districts)
      .where(
        and(
          within(districts.id),
          or(ilike(districts.name, pattern), ilike(districts.slug, pattern)),
        ),
      )
      .orderBy(districts.name)
      .limit(perCategory),
    db
      .select({
        slug: schools.slug,
        name: schools.name,
        districtSlug: districts.slug,
        districtName: districts.name,
      })
      .from(schools)
      .innerJoin(districts, eq(schools.districtId, districts.id))
      .where(
        and(
          within(districts.id),
          or(ilike(schools.name, pattern), ilike(schools.slug, pattern)),
        ),
      )
      .orderBy(schools.name)
      .limit(perCategory),
    db
      .select({
        id: sensors.id,
        slug: sensors.slug,
        name: sensors.name,
        localIp: sensors.localIp,
        schoolSlug: schools.slug,
        schoolName: schools.name,
        districtSlug: districts.slug,
        districtName: districts.name,
      })
      .from(sensors)
      .innerJoin(schools, eq(sensors.schoolId, schools.id))
      .innerJoin(districts, eq(schools.districtId, districts.id))
      .where(
        and(
          within(districts.id),
          or(
            ilike(sensors.name, pattern),
            ilike(sensors.slug, pattern),
            ilike(sensors.localIp, pattern),
          ),
        ),
      )
      .limit(perCategory),
    db
      .select({
        id: entitiesHost.id,
        ip: entitiesHost.ip,
        mac: entitiesHost.mac,
        hostname: entitiesHost.hostname,
        schoolSlug: schools.slug,
        schoolName: schools.name,
        districtSlug: districts.slug,
      })
      .from(entitiesHost)
      .innerJoin(schools, eq(entitiesHost.schoolId, schools.id))
      .innerJoin(districts, eq(entitiesHost.districtId, districts.id))
      .where(
        and(
          within(entitiesHost.districtId),
          or(
            ilike(entitiesHost.hostname, pattern),
            ilike(entitiesHost.ip, pattern),
            ilike(entitiesHost.mac, pattern),
          ),
        ),
      )
      .limit(perCategory),
  ]);

  return {
    districts: districtRows.map((d) => ({
      type: "district" as const,
      label: d.name || titleizeSlug(d.slug),
      sublabel: "District",
      href: `/${d.slug}`,
    })),
    schools: schoolRows.map((s) => ({
      type: "school" as const,
      label: s.name || titleizeSlug(s.slug),
      sublabel: s.districtName || titleizeSlug(s.districtSlug),
      href: `/${s.districtSlug}/${s.slug}`,
    })),
    sensors: sensorRows.map((s) => ({
      type: "sensor" as const,
      label: s.name || titleizeSlug(s.slug),
      sublabel: `${s.schoolName || titleizeSlug(s.schoolSlug)} · ${s.districtName}${s.localIp ? ` · ${s.localIp}` : ""}`,
      href: `/${s.districtSlug}/${s.schoolSlug}/sensor/${s.id}`,
    })),
    hosts: hostRows.map((h) => ({
      type: "host" as const,
      label: h.hostname || h.ip || h.mac || "Unknown host",
      sublabel: `${h.ip ?? h.mac ?? ""}${h.ip || h.mac ? " · " : ""}${h.schoolName || titleizeSlug(h.schoolSlug)}`,
      href: `/${h.districtSlug}/${h.schoolSlug}/host/${h.id}`,
    })),
  };
}
