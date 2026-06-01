"use server";

import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope } from "@/lib/auth/scope";
import { searchFleet, type SearchResults } from "@/db/fleet-queries";

const EMPTY: SearchResults = {
  districts: [],
  schools: [],
  sensors: [],
  hosts: [],
};

/**
 * Global jump-to search. Scope is resolved from the session on the SERVER —
 * the client term is the only untrusted input — so a user can never search
 * outside the districts they're granted.
 */
export async function globalSearch(term: string): Promise<SearchResults> {
  const user = await getSessionUser();
  if (!user) return EMPTY;
  const scope = await getUserScope(user);
  if (!scope.all && scope.districtIds.length === 0) return EMPTY;
  return searchFleet(term, scope.all ? null : scope.districtIds);
}
