import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { getBranding } from "@/lib/branding";
import { PageHeader } from "@/components/page-header";
import { BrandingForm } from "./branding-form";

export const metadata = { title: "Branding" };
export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/");

  const branding = await getBranding();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Branding"
        description="White-label the dashboard — name, tagline, colors, logo, and favicon. Changes apply across the app and the login page."
      />
      <BrandingForm branding={branding} />
    </div>
  );
}
