"use server";

import { after } from "next/server";

import { getSessionUser } from "@/lib/auth/current-user";
import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { getRun, type AnalysisRun } from "@/lib/ai/queries";
import {
  prepareTopologyRun,
  executeTopologyRun,
  type TopologyRunRequest,
} from "@/lib/ai/topology";

export interface StartTopologyState {
  runId?: string;
  providerCount: number;
  error?: string;
}

/** Kick off a topology analysis for a school (superadmin). Returns the runId so
 *  the client can poll; the model calls finish in after(). */
export async function analyzeTopologyAction(
  districtSlug: string,
  schoolSlug: string,
): Promise<StartTopologyState> {
  const user = await getSessionUser();
  if (user?.role !== "superadmin") return { providerCount: 0, error: "Not authorized." };

  const district = await getDistrictBySlug(districtSlug);
  if (!district) return { providerCount: 0, error: "District not found." };
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) return { providerCount: 0, error: "School not found." };

  const req: TopologyRunRequest = {
    schoolId: school.id,
    districtId: district.id,
    label: `${district.name} — ${school.name ?? school.slug}`,
    requestedBy: user.id,
  };
  const { runId, providerIds } = await prepareTopologyRun(req);
  if (providerIds.length === 0)
    return { providerCount: 0, error: "No AI provider is configured. Set one up in Settings → AI." };

  after(async () => {
    await executeTopologyRun(runId, req);
  });
  return { runId, providerCount: providerIds.length };
}

/** Fetch a run's current rows for polling. */
export async function getTopologyRunAction(runId: string): Promise<AnalysisRun | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return getRun(runId);
}
