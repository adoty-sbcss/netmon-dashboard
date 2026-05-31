import { notFound } from "next/navigation";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getScanSnapshot,
  listScanSnapshotsForSchool,
  getDhcpAnalysis,
} from "@/db/queries";
import { dateTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SnapshotPicker } from "@/components/snapshot-picker";
import { DhcpAnalysisView } from "@/components/dhcp-analysis";

// Live data — render on each request.
export const dynamic = "force-dynamic";

export default async function DhcpPage({
  params,
  searchParams,
}: {
  params: Promise<{ district: string; school: string }>;
  searchParams: Promise<{ scan?: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const { scan } = await searchParams;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const scanId = scan ? Number.parseInt(scan, 10) : null;
  const validScanId = scanId != null && !Number.isNaN(scanId) ? scanId : null;

  const [snapshots, analysis, snapshot] = await Promise.all([
    listScanSnapshotsForSchool(school.id),
    getDhcpAnalysis(school.id, validScanId ? { scanId: validScanId } : {}),
    validScanId ? getScanSnapshot(school.id, validScanId) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="DHCP"
        description={
          snapshot
            ? `${school.name || titleizeSlug(school.slug)} · snapshot ${dateTime(snapshot.startedAt)}`
            : `${school.name || titleizeSlug(school.slug)} · scopes, servers & client leases`
        }
        actions={<SnapshotPicker snapshots={snapshots} value={validScanId} />}
      />

      {analysis.totalObservations === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <p className="font-medium">No DHCP traffic</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            No DHCP packets were captured
            {validScanId ? " in this scan." : " at this school yet."}
          </p>
        </div>
      ) : (
        <DhcpAnalysisView analysis={analysis} />
      )}
    </div>
  );
}
