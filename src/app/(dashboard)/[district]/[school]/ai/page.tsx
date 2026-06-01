import { notFound } from "next/navigation";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { providerDescriptors } from "@/lib/ai/providers/registry";
import { getLatestRunForDistrict } from "@/lib/ai/queries";
import { startSchoolAnalysis } from "@/lib/ai/actions";
import { AiAnalysisPanel } from "../../ai/ai-analysis";

export const metadata = { title: "AI analysis · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function SchoolAiPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const [providers, latestRun] = await Promise.all([
    providerDescriptors(),
    getLatestRunForDistrict(district.id, "school", school.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="AI analysis"
        description={`Model-driven review of ${
          school.name || titleizeSlug(school.slug)
        } — ${
          district.name || titleizeSlug(district.slug)
        }. Included in the daily run; run on demand below.`}
      />
      <AiAnalysisPanel
        runAction={startSchoolAnalysis.bind(null, district.slug, school.slug)}
        providers={providers}
        initialRun={latestRun}
      />
    </div>
  );
}
