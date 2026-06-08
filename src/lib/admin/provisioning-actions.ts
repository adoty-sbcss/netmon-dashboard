"use server";

/**
 * PROV-2a: superadmin actions to pre-create a district + school "landing spot"
 * before any sensor has reported. (Today districts/schools also materialize
 * automatically at ingest from a bundle's slugs; this lets an admin create the
 * spot up front so a tech can deploy a sensor INTO it via the deploy page.)
 *
 * SFTP-2b (auto-mint a per-district scoped SFTP user on district create) layers
 * in next; for now a new district uses the shared fleet SFTP config.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import { districts, schools } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import { clientIp } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/events";

export interface ProvisionActionState {
  error?: string;
  ok?: boolean;
  message?: string;
  /** Slug of the just-created entity (lets the client navigate to it). */
  slug?: string;
}

/** lowercase, ASCII, dash-separated — matches the collector's slug rules. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

async function requireSuperadmin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user.role === "superadmin" ? user : null;
}

async function adminEvent(
  actor: string,
  action: string,
  detail: Record<string, unknown>,
) {
  const hdrs = await headers();
  await recordSecurityEvent({
    category: "admin",
    action,
    severity: "info",
    actorType: "user",
    actor,
    sourceIp: clientIp(hdrs),
    userAgent: hdrs.get("user-agent"),
    target: detail.slug ? `district:${detail.slug}` : null,
    detail,
  });
}

/** Create a district landing spot. Idempotent-ish: errors if the slug exists. */
export async function createDistrictAction(
  _prev: ProvisionActionState,
  formData: FormData,
): Promise<ProvisionActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "District name is required." };
  const slug = slugify(name);
  if (!slug) return { error: "Couldn’t derive a slug — use plain letters/numbers." };

  const [existing] = await db
    .select({ id: districts.id })
    .from(districts)
    .where(eq(districts.slug, slug))
    .limit(1);
  if (existing) return { error: `A district with slug “${slug}” already exists.` };

  await db.insert(districts).values({ slug, name });
  await adminEvent(admin.email, "district_created", { slug, name });
  revalidatePath("/");
  // SFTP-2b will auto-mint this district's scoped SFTP user here (next phase).
  return { ok: true, message: `Created district “${name}”.`, slug };
}

/** Create a school landing spot under a district. */
export async function createSchoolAction(
  _prev: ProvisionActionState,
  formData: FormData,
): Promise<ProvisionActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const districtSlug = String(formData.get("districtSlug") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!districtSlug) return { error: "Missing district." };
  if (!name) return { error: "School name is required." };
  const slug = slugify(name);
  if (!slug) return { error: "Couldn’t derive a slug — use plain letters/numbers." };

  const [district] = await db
    .select({ id: districts.id })
    .from(districts)
    .where(eq(districts.slug, districtSlug))
    .limit(1);
  if (!district) return { error: "District not found." };

  const [existing] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(and(eq(schools.districtId, district.id), eq(schools.slug, slug)))
    .limit(1);
  if (existing) return { error: `A school with slug “${slug}” already exists in this district.` };

  await db.insert(schools).values({ districtId: district.id, slug, name });
  await adminEvent(admin.email, "school_created", { slug, name, districtSlug });
  revalidatePath(`/${districtSlug}`);
  return { ok: true, message: `Created school “${name}”.`, slug };
}
