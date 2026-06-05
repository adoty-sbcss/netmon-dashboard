import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import {
  AI_PROVIDER_IDS,
  getProviderSettingsView,
  getAiSettings,
} from "@/lib/ai/settings";
import { ALL_PROVIDERS } from "@/lib/ai/providers/registry";
import {
  getAiUsageThisMonth,
  getRecentAiRuns,
  getDailyAiUsage,
} from "@/lib/ai/queries";
import { PageHeader } from "@/components/page-header";
import { AiSettingsForm } from "./ai-settings-form";

export const metadata = { title: "AI analysis settings · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/");

  const [views, settings, usage, recentRuns, dailyUsage] = await Promise.all([
    Promise.all(AI_PROVIDER_IDS.map((id) => getProviderSettingsView(id))),
    getAiSettings(),
    getAiUsageThisMonth(),
    getRecentAiRuns(30),
    getDailyAiUsage(14),
  ]);

  // Pair each provider's static metadata (label + which fields it needs) with
  // its saved view. Keep only serializable bits for the client component.
  const providers = AI_PROVIDER_IDS.map((id) => {
    const meta = ALL_PROVIDERS.find((p) => p.id === id)!;
    const view = views.find((v) => v.providerId === id)!;
    return { id, label: meta.label, fields: meta.fields, view };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI analysis"
        description="Configure the models that review network data, schedule the daily run, and track usage. API keys are encrypted at rest."
      />
      <Link
        href="/settings/ai/conversations"
        className="w-fit text-sm text-primary hover:underline"
      >
        View assistant conversations →
      </Link>
      <AiSettingsForm
        providers={providers}
        settings={settings}
        usage={usage}
        recentRuns={recentRuns}
        dailyUsage={dailyUsage}
      />
    </div>
  );
}
