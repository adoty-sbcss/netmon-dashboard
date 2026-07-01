import Link from "next/link";
import { redirect } from "next/navigation";
import { Radar, Rocket, Settings, SlidersHorizontal } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { listAuthorizedDhcpServers } from "@/lib/dhcp-policy";
import { getDistrictIperf } from "@/lib/iperf";
import {
  listDistrictsForSettings,
  listDistrictSensorCapabilities,
  listDistrictRollout,
  type SensorCapabilityRow,
} from "@/db/settings-queries";
import { titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CapabilityMatrix } from "./capability-matrix";
import { DistrictWifiJoinSection } from "./wifi-join-section";
import { SnmpCommunityForm } from "./snmp-community-form";
import { CrawlScopeCard } from "./crawl-scope-card";
import { SftpRotationCard } from "./sftp-rotation-card";
import { DhcpServersManager } from "../../[district]/settings/dhcp-servers-manager";
import { IperfServerForm } from "../../[district]/settings/iperf-server-form";

export const metadata = { title: "School & district settings · NetMon Dashboard" };
export const dynamic = "force-dynamic";

const BASE = "/settings/network";

export default async function NetworkSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ district?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Single consolidated control plane for district + per-sensor config.
  if (user.role !== "superadmin") redirect("/");

  const districts = await listDistrictsForSettings();
  const { district: districtParam } = await searchParams;
  // Default to the first district so the page is never blank.
  const selected =
    districts.find((d) => d.slug === districtParam) ?? districts[0] ?? null;

  const basePath = selected ? `${BASE}?district=${selected.slug}` : BASE;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="School and district settings"
        description="One place for everything per district, school, and sensor — turn capabilities on for the boxes that need them, and set the shared policy they use."
      />

      {districts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No districts yet. Add one from the overview, then deploy a sensor.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* District picker — the whole page is scoped to one district at a time. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">District:</span>
            {districts.map((d) => {
              const active = selected?.id === d.id;
              return (
                <Button
                  key={d.id}
                  asChild
                  size="sm"
                  variant={active ? "default" : "outline"}
                >
                  <Link href={`${BASE}?district=${d.slug}`}>
                    {d.name || titleizeSlug(d.slug)}
                  </Link>
                </Button>
              );
            })}
          </div>

          {selected && (
            // Key on the district so a client-side district switch fully remounts
            // the subtree — otherwise the uncontrolled SNMP input keeps the prior
            // district's value (defaultValue only applies on mount).
            <NetworkSettingsForDistrict
              key={selected.id}
              districtId={selected.id}
              districtSlug={selected.slug}
              basePath={basePath}
            />
          )}
        </>
      )}
    </div>
  );
}

async function NetworkSettingsForDistrict({
  districtId,
  districtSlug,
  basePath,
}: {
  districtId: number;
  districtSlug: string;
  basePath: string;
}) {
  const [sensors, dhcpServers, iperf, rollout] = await Promise.all([
    listDistrictSensorCapabilities(districtId),
    listAuthorizedDhcpServers(districtId),
    getDistrictIperf(districtId),
    listDistrictRollout(districtId),
  ]);
  // Seed the district push field from what sensors are ACTUALLY reporting (ground
  // truth) when they agree, so the field matches what each sensor's own page
  // shows. Fall back to the last pushed/desired value if nothing's reported yet.
  const reported = [...new Set(sensors.map((s) => s.reportedSnmpCommunities).filter(Boolean))];
  const desiredFallback = sensors.find((s) => s.snmpCommunities)?.snmpCommunities ?? "";
  const currentCommunity = reported.length === 1 ? reported[0] : desiredFallback;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Per-sensor capabilities — the headline: enable each capability on the
            boxes that need it. */}
      <Card>
        <SectionHeader icon={Radar} title="Per-sensor capabilities" />
        <CardContent>
          <CapabilityMatrix basePath={basePath} sensors={sensors} />
        </CardContent>
      </Card>

      {/* 1b. Wi-Fi join configuration (WIFI-6) — one portal per Wi-Fi-capable school
            in this district. Renders nothing if no school here has a Wi-Fi radio. */}
      <DistrictWifiJoinSection districtId={districtId} />

      {/* 2. Shared settings the capabilities use. */}
      <Card>
        <SectionHeader icon={SlidersHorizontal} title="Shared settings (this district)" />
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <SnmpCommunityForm districtId={districtId} basePath={basePath} current={currentCommunity} />
            <SnmpReportedStrip sensors={sensors} pushed={currentCommunity} />
          </div>
          <div className="border-t" />
          <IperfServerForm districtSlug={districtSlug} iperf={iperf} />
        </CardContent>
      </Card>

      {/* 3. Topology crawl scope/tuning — district policy for the spine crawl. */}
      <CrawlScopeCard districtId={districtId} basePath={basePath} rows={rollout} />

      {/* 4. SFTP credential rotation — push one upload destination to the district. */}
      <SftpRotationCard districtId={districtId} basePath={basePath} rows={rollout} />

      {/* 5. District policy that tunes alerts + AI. */}
      <DhcpServersManager districtSlug={districtSlug} servers={dhcpServers} />

      {/* 6. Fleet-wide settings that live elsewhere. */}
      <Card>
        <SectionHeader icon={Settings} title="More" />
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/sensors/releases"><Rocket className="size-4" /> Release channels</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Compact ground-truth strip under the district SNMP field: what each SNMP-enabled
 * sensor is ACTUALLY reporting, vs the value in the push field. Keeps the control
 * plane (desired) honest about reality (reported) without a noisy extra column.
 * Renders nothing when no sensor uses SNMP; collapses to one line when all match.
 */
function SnmpReportedStrip({
  sensors,
  pushed,
}: {
  sensors: SensorCapabilityRow[];
  pushed: string;
}) {
  const relevant = sensors.filter(
    (s) => s.snmp_enabled || s.reportedSnmpCommunities || s.snmpCommunities,
  );
  if (relevant.length === 0) return null;

  const allMatch = relevant.every((s) => s.reportedSnmpCommunities === pushed);
  if (allMatch && pushed) {
    return (
      <p className="text-xs text-muted-foreground">
        ✓ All SNMP-enabled sensors are reporting this community.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/20 p-2">
      <p className="text-[11px] font-medium text-muted-foreground">
        Currently reported by sensors (ground truth)
      </p>
      {relevant.map((s) => {
        const reported = s.reportedSnmpCommunities;
        const drift = reported !== "" && reported !== pushed;
        return (
          <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">{s.name || s.slug}</span>
            {reported ? (
              <span className="font-mono text-muted-foreground">{reported}</span>
            ) : (
              <span className="text-muted-foreground">not reported yet</span>
            )}
            {drift && (
              <span className="rounded bg-[var(--warning)]/15 px-1.5 py-0.5 text-[10px] text-[var(--warning)]">
                differs from pushed
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
