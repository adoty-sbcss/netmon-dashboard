import { redirect } from "next/navigation";

// Findings are now the persistent Issues tracker.
export default async function FindingsRedirect({
  params,
}: {
  params: Promise<{ district: string }>;
}) {
  const { district } = await params;
  redirect(`/${district}/issues`);
}
