/**
 * Read/write the singleton branding configuration (branding_settings, id = 1).
 *
 *   getBranding()        UI-safe view: text + colors + hasLogo/hasFavicon +
 *                        updatedAt (used to cache-bust the /branding/* asset URLs).
 *   getBrandingAsset()   the raw logo/favicon bytes for the serving routes.
 *
 * DEFAULTS are the SBCSS values, so a fresh install looks right before anyone
 * visits /settings/branding.
 */
import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { brandingSettings } from "@/db/schema/branding";

const SINGLETON_ID = 1;

export const BRANDING_DEFAULTS = {
  appName: "NetMon",
  tagline: "SBCSS Network Dashboard",
  description:
    "Network visibility and sensor management for San Bernardino County Superintendent of Schools.",
  primaryColor: "#2563eb",
  logoColorA: "#FDB813",
  logoColorB: "#0093D0",
};

export interface BrandingView {
  appName: string;
  tagline: string;
  description: string;
  primaryColor: string;
  logoColorA: string;
  logoColorB: string;
  hasLogo: boolean;
  hasFavicon: boolean;
  /** Epoch ms of last change — cache-busts /branding/logo + /branding/icon. */
  version: number;
}

// Wrapped in React `cache()`: the root layout reads branding twice
// (generateMetadata + body) and the dashboard layout once, so the singleton row
// is fetched ~3× per page — cache() collapses that to a single read per request.
const getRow = cache(async () => {
  try {
    const [row] = await db
      .select()
      .from(brandingSettings)
      .where(eq(brandingSettings.id, SINGLETON_ID))
      .limit(1);
    return row ?? null;
  } catch {
    // DB unavailable (e.g. at build time when statically generating, or a
    // transient outage). Branding must never break the app — fall back to
    // defaults / no custom asset.
    return null;
  }
});


export async function getBranding(): Promise<BrandingView> {
  const row = await getRow();
  return {
    appName: row?.appName || BRANDING_DEFAULTS.appName,
    tagline: row?.tagline || BRANDING_DEFAULTS.tagline,
    description: row?.description || BRANDING_DEFAULTS.description,
    primaryColor: row?.primaryColor || BRANDING_DEFAULTS.primaryColor,
    logoColorA: row?.logoColorA || BRANDING_DEFAULTS.logoColorA,
    logoColorB: row?.logoColorB || BRANDING_DEFAULTS.logoColorB,
    hasLogo: Boolean(row?.logoData),
    hasFavicon: Boolean(row?.faviconData),
    version: row?.updatedAt ? row.updatedAt.getTime() : 0,
  };
}

export interface BrandingAsset {
  mime: string;
  /** base64-encoded bytes. */
  data: string;
}

export async function getBrandingAsset(
  kind: "logo" | "favicon",
): Promise<BrandingAsset | null> {
  const row = await getRow();
  if (!row) return null;
  if (kind === "logo") {
    return row.logoData && row.logoMime
      ? { mime: row.logoMime, data: row.logoData }
      : null;
  }
  return row.faviconData && row.faviconMime
    ? { mime: row.faviconMime, data: row.faviconData }
    : null;
}

// ---- writes ---------------------------------------------------------------

export interface BrandingTextPatch {
  appName?: string;
  tagline?: string;
  description?: string;
  primaryColor?: string;
  logoColorA?: string;
  logoColorB?: string;
}

async function upsert(
  set: Partial<typeof brandingSettings.$inferInsert>,
  updatedBy?: number | null,
): Promise<void> {
  const base = { ...set, updatedBy: updatedBy ?? null, updatedAt: new Date() };
  await db
    .insert(brandingSettings)
    .values({ id: SINGLETON_ID, ...base })
    .onConflictDoUpdate({ target: brandingSettings.id, set: base });
}

export async function saveBrandingText(
  patch: BrandingTextPatch,
  updatedBy?: number | null,
): Promise<void> {
  await upsert(
    {
      appName: patch.appName ?? null,
      tagline: patch.tagline ?? null,
      description: patch.description ?? null,
      primaryColor: patch.primaryColor ?? null,
      logoColorA: patch.logoColorA ?? null,
      logoColorB: patch.logoColorB ?? null,
    },
    updatedBy,
  );
}

export async function saveBrandingAsset(
  kind: "logo" | "favicon",
  mime: string,
  base64: string,
  updatedBy?: number | null,
): Promise<void> {
  const set =
    kind === "logo"
      ? { logoMime: mime, logoData: base64 }
      : { faviconMime: mime, faviconData: base64 };
  await upsert(set, updatedBy);
}

export async function clearBrandingAsset(
  kind: "logo" | "favicon",
  updatedBy?: number | null,
): Promise<void> {
  const set =
    kind === "logo"
      ? { logoMime: null, logoData: null }
      : { faviconMime: null, faviconData: null };
  await upsert(set, updatedBy);
}
