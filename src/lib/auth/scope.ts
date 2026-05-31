/**
 * Authorization scope derived from a user's role + grants.
 *
 * Rule (DESIGN): trust the IdP-verified email, load grants, filter every query.
 * NEVER derive authority from email domain. superadmin (or a 'global' grant) sees
 * everything; otherwise the user sees only the districts they're granted.
 */
import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { grants, schools } from "@/db/schema/app";
import type { SessionUser } from "./current-user";

export interface UserScope {
  /** True = unrestricted (superadmin or a global grant). */
  all: boolean;
  /** District ids the user may see (empty + all=false → sees nothing). */
  districtIds: number[];
}

/** Resolve the set of districts a user may access. */
export async function getUserScope(user: SessionUser): Promise<UserScope> {
  if (user.role === "superadmin") return { all: true, districtIds: [] };

  const rows = await db
    .select({ scopeType: grants.scopeType, scopeId: grants.scopeId })
    .from(grants)
    .where(eq(grants.userId, user.id));

  if (rows.some((r) => r.scopeType === "global")) return { all: true, districtIds: [] };

  const districtIds = new Set<number>();
  for (const r of rows) {
    if (r.scopeType === "district" && r.scopeId != null) districtIds.add(r.scopeId);
  }

  // Resolve any school-scoped grants up to their district (coarse but safe).
  const schoolGrantIds = rows
    .filter((r) => r.scopeType === "school" && r.scopeId != null)
    .map((r) => r.scopeId as number);
  if (schoolGrantIds.length > 0) {
    const schoolRows = await db
      .select({ id: schools.id, districtId: schools.districtId })
      .from(schools);
    const byId = new Map(schoolRows.map((s) => [s.id, s.districtId]));
    for (const sid of schoolGrantIds) {
      const did = byId.get(sid);
      if (did != null) districtIds.add(did);
    }
  }

  return { all: false, districtIds: [...districtIds] };
}

/** Convenience: may this user access a given district id? */
export function scopeAllowsDistrict(scope: UserScope, districtId: number): boolean {
  return scope.all || scope.districtIds.includes(districtId);
}
