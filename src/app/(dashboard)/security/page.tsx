import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { providerDescriptors } from "@/lib/ai/providers/registry";
import { startSecurityAnalysis } from "@/lib/ai/actions";
import {
  getLatestSecurityRun,
  getRecentSecurityEvents,
  getSecurityOverview,
} from "@/lib/ai/security-queries";
import { SecurityAnalysisPanel } from "./security-analysis";
import { SecurityEventsTable } from "./security-events-table";

export const metadata = { title: "Security · NetMon Dashboard" };
export const dynamic = "force-dynamic";

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-2xl font-semibold ${
            warn && value > 0 ? "text-[var(--warning)]" : ""
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function SecurityPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/");

  const [providers, latestRun, recentEvents, overview] = await Promise.all([
    providerDescriptors(),
    getLatestSecurityRun(),
    getRecentSecurityEvents(40),
    getSecurityOverview(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security analysis"
        description="AI review of the dashboard's own security signals — sign-ins, access denials, and sensor-API auth. Runs automatically each day; run on demand below."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Events (24h)" value={overview.total24h} />
        <Stat label="High / critical (24h)" value={overview.elevated24h} warn />
        <Stat label="Awaiting review" value={overview.unreviewed} />
      </div>

      <SecurityAnalysisPanel
        runAction={startSecurityAnalysis}
        providers={providers}
        initialRun={latestRun}
      />

      <SecurityEventsTable events={recentEvents} />
    </div>
  );
}
