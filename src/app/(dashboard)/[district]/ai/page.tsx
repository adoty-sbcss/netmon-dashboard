import { notFound } from "next/navigation";

import { getDistrictBySlug } from "@/db/queries";
import { titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { providerDescriptors } from "@/lib/ai/providers/registry";
import { getLatestRunForDistrict } from "@/lib/ai/queries";
import { AiAnalysisPanel } from "./ai-analysis";

export default async function DistrictAiPage({
  params,
}: {
  params: Promise<{ district: string }>;
}) {
  const { district: districtSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();

  const [providers, latestRun] = await Promise.all([
    Promise.resolve(providerDescriptors()),
    getLatestRunForDistrict(district.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI analysis"
        description={`Model-driven review of ${
          district.name || titleizeSlug(district.slug)
        }'s network data. Runs automatically once a day; run on demand below.`}
      />
      <AiAnalysisPanel
        districtSlug={district.slug}
        providers={providers}
        initialRun={latestRun}
      />
    </div>
  );
}
