/* DEV-ONLY design harness content — mock Overview + School pages. */
import {
  Building2,
  ChevronRight,
  Cpu,
  Globe,
  HardDrive,
  Network,
  Radio,
  School,
  ShieldAlert,
  Sparkles,
  Waypoints,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SpeedScoreboard } from "@/app/(dashboard)/[district]/[school]/iperf/speed-scoreboard";
import type {
  SpeedCardVM,
  IperfCardVM,
} from "@/app/(dashboard)/[district]/[school]/iperf/summary";
import type { UplinkGlanceProps } from "@/app/(dashboard)/[district]/[school]/iperf/uplink-glance";
import { IperfScheduleEditor } from "@/app/(dashboard)/[district]/[school]/sensor/[id]/iperf-schedule-editor";
import type { IperfScheduleEntry } from "@/lib/iperf-actions";

const DISTRICTS = [
  { name: "San Bernardino CSS", schools: 12, sensors: 18, hosts: "1,284", findings: 3, updated: "4m ago" },
  { name: "Bear Valley USD", schools: 4, sensors: 6, hosts: "402", findings: 0, updated: "11m ago" },
  { name: "Baker Valley USD", schools: 2, sensors: 3, hosts: "168", findings: 1, updated: "1h ago" },
];

const SENSORS = [
  { name: "North-IDF-Core", slug: "north-idf-core", devices: "486", scan: "4m ago", checkin: "1m ago", agent: "v2.4.1" },
  { name: "North-MDF", slug: "north-mdf", devices: "312", scan: "4m ago", checkin: "2m ago", agent: "v2.4.1" },
  { name: "Annex-Closet-2", slug: "annex-closet-2", devices: "198", scan: "9m ago", checkin: "3m ago", agent: "v2.4.0" },
];

// Mock Speed & Bandwidth scoreboard data. NOW read at module scope (not in the
// render body) so the harness mirrors the real page's purity discipline.
const NOW = Date.now();
const min = (m: number) => new Date(NOW - m * 60_000);

const MOCK_INTERNET: SpeedCardVM[] = [
  {
    sensorSlug: "north-idf",
    sensorName: "North IDF",
    ok: true,
    when: min(9),
    downloadMbps: 785.3,
    uploadMbps: 760.8,
    latencyMs: 46,
    jitterMs: 52.5,
    provider: "cloudflare",
    error: null,
    trendDown: [772, 781, 769, 790, 766, 785, 778, 792, 770, 785],
    trendUp: [744, 751, 760, 738, 755, 749, 761, 744, 758, 760],
    status: "ok",
    statusReason: "Healthy",
  },
];

const MOCK_IPERF: IperfCardVM[] = [
  {
    sensorSlug: "north-idf",
    sensorName: "North IDF",
    down: { mbps: 942.0, ok: true, when: min(12), error: null },
    up: { mbps: 488.1, ok: true, when: min(14), error: null },
    protocol: "tcp",
    retransmits: 14,
    jitterMs: null,
    lossPct: null,
    trendDown: [938, 941, 939, 942, 940, 941, 942, 940, 942, 942],
    trendUp: [902, 880, 866, 720, 640, 560, 512, 498, 491, 488],
    status: "warn",
    statusReason: "A direction is running below its recent best",
    when: min(12),
  },
];

const MOCK_UPLINK: UplinkGlanceProps = {
  committedMbps: 1000,
  inMbps: 384,
  outMbps: 121,
  inPct: 38.4,
  outPct: 12.1,
  wanName: "Te1/1/1 → ISP",
  when: min(7),
  portSpeedMbps: 10000,
};

const MOCK_IPERF_SCHEDULES: IperfScheduleEntry[] = [
  { protocol: "tcp", direction: "up", duration: 10, times: ["05:00", "17:00"], days: [0, 1, 2, 3, 4, 5, 6] },
  { protocol: "udp", direction: "both", duration: 20, times: ["01:00"], days: [0, 2, 4] },
];

export default function PreviewPage() {
  return (
    <div className="flex flex-col gap-10">
      {/* ============================= OVERVIEW ============================= */}
      <section className="flex flex-col gap-6">
        <span className="w-fit rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Overview page
        </span>
        <PageHeader title="Overview" description="Network health across all districts." />

        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          <StatCard label="Districts" value="3" icon={Building2} href="#" />
          <StatCard label="Schools" value="18" icon={School} href="#" />
          <StatCard label="Sensors" value="27" icon={Network} href="#" />
          <StatCard label="Open findings" value="4" icon={ShieldAlert} tone="warning" href="#" />
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Districts</h2>
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
            {DISTRICTS.map((d) => (
              <a
                key={d.name}
                href="#"
                className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="lift h-full hover:bg-accent/40">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="size-4 text-primary" />
                      {d.name}
                    </CardTitle>
                    <CardAction>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <School className="size-3.5" />
                        {d.schools} schools
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Network className="size-3.5" />
                        {d.sensors} sensors
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Cpu className="size-3.5" />
                        {d.hosts} hosts
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      {d.findings > 0 ? (
                        <Badge variant="outline" className="gap-1 text-[var(--warning)]">
                          <ShieldAlert className="size-3" />
                          {d.findings} findings
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          No findings
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">Updated {d.updated}</span>
                    </div>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </div>
      </section>

      <hr className="border-dashed" />

      {/* ============================== SCHOOL ============================== */}
      <section className="flex flex-col gap-6">
        <span className="w-fit rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          School page
        </span>
        <PageHeader
          title="North Elementary"
          description="San Bernardino CSS · last scan 4m ago"
        />

        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
          <StatCard label="Switches" value="14" icon={Network} href="#" />
          <StatCard label="Hosts" value="486" icon={Cpu} href="#" hint="912 sightings across scans" />
          <StatCard label="Sensors" value="2" icon={Radio} href="#" />
        </div>

        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
          <StatCard label="Neighbors (LLDP)" value="38" icon={Waypoints} href="#" />
          <StatCard label="DHCP observed" value="6" icon={HardDrive} href="#" />
          <StatCard label="DNS probes" value="124" icon={Globe} href="#" />
        </div>

        {/* AI health summary */}
        <Card className="brand-wash">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              AI health summary
            </CardTitle>
            <CardAction>
              <Badge variant="outline" className="text-muted-foreground">
                Updated 2h ago
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              All core links are healthy. One spanning-tree topology change was observed on{" "}
              <span className="font-medium">North-IDF-Core</span> — likely a switch reboot during
              the maintenance window. No rogue DHCP servers detected.
            </p>
            <p className="text-muted-foreground">
              Recommendation: confirm the STP change was planned; if unexpected, check uplink
              stability on ports 1/4–1/8.
            </p>
          </CardContent>
        </Card>

        {/* Sensors table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sensors</CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sensor</TableHead>
                    <TableHead className="text-right">Devices</TableHead>
                    <TableHead>Last scan</TableHead>
                    <TableHead className="hidden md:table-cell">Last check-in</TableHead>
                    <TableHead className="hidden lg:table-cell">Agent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SENSORS.map((s) => (
                    <TableRow key={s.slug}>
                      <TableCell className="font-medium">
                        <span className="hover:underline">{s.name}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {s.slug}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.devices}</TableCell>
                      <TableCell>{s.scan}</TableCell>
                      <TableCell className="hidden md:table-cell">{s.checkin}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                        {s.agent}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      <hr className="border-dashed" />

      {/* ====================== SPEED & BANDWIDTH ====================== */}
      <section className="flex flex-col gap-6">
        <span className="w-fit rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          School page · Speed &amp; Bandwidth (scoreboard)
        </span>
        <PageHeader
          title="Speed & Bandwidth"
          description="North Elementary · internet speed tests + internal throughput"
        />
        <SpeedScoreboard internet={MOCK_INTERNET} iperf={MOCK_IPERF} uplink={MOCK_UPLINK} />
      </section>

      <hr className="border-dashed" />

      {/* ====================== IPERF SCHEDULE EDITOR ====================== */}
      <section className="flex flex-col gap-6">
        <span className="w-fit rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Sensor page · iPerf schedule editor
        </span>
        <form className="max-w-2xl">
          <IperfScheduleEditor initial={MOCK_IPERF_SCHEDULES} />
        </form>
      </section>
    </div>
  );
}
