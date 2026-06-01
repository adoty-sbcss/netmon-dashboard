"use server";

/**
 * Superadmin server actions for /settings/branding. Text + colors save together;
 * logo and favicon upload separately (stored base64 in the DB). All audit-logged.
 * Branding is applied at runtime by the dynamic layout, so a save is reflected on
 * the next navigation; we revalidate the layout to be prompt.
 */
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import {
  saveBrandingText,
  saveBrandingAsset,
  clearBrandingAsset,
} from "@/lib/branding";

const PATH = "/settings/branding";
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const MAX_BYTES = 512 * 1024; // 512 KB — plenty for an SVG/PNG/ICO
const LOGO_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const FAVICON_TYPES = new Set([
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/png",
  "image/svg+xml",
]);

export interface BrandingActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function requireSuperadmin() {
  const u = await getSessionUser();
  return u && u.role === "superadmin" ? u : null;
}

async function audit(
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db
    .insert(auditLog)
    .values({ actorType: "user", actor, action, detail })
    .catch(() => {});
}

function refresh() {
  revalidatePath(PATH);
  revalidatePath("/", "layout");
}

export async function saveBrandingTextAction(
  _prev: BrandingActionState,
  formData: FormData,
): Promise<BrandingActionState> {
  const user = await requireSuperadmin();
  if (!user) return { error: "Not authorized." };

  const appName = String(formData.get("appName") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const primaryColor = String(formData.get("primaryColor") ?? "").trim();
  const logoColorA = String(formData.get("logoColorA") ?? "").trim();
  const logoColorB = String(formData.get("logoColorB") ?? "").trim();

  if (!appName) return { error: "App name is required." };
  for (const [label, c] of [
    ["Primary", primaryColor],
    ["Logo color A", logoColorA],
    ["Logo color B", logoColorB],
  ] as const) {
    if (c && !HEX6.test(c)) {
      return { error: `${label} must be a 6-digit hex like #2563eb.` };
    }
  }

  await saveBrandingText(
    {
      appName,
      tagline,
      description,
      primaryColor: primaryColor || undefined,
      logoColorA: logoColorA || undefined,
      logoColorB: logoColorB || undefined,
    },
    user.id,
  );
  await audit(user.email, "branding_saved", { appName });
  refresh();
  return { ok: true, message: "Branding saved." };
}

export async function uploadBrandingAssetAction(
  _prev: BrandingActionState,
  formData: FormData,
): Promise<BrandingActionState> {
  const user = await requireSuperadmin();
  if (!user) return { error: "Not authorized." };

  const kind = String(formData.get("kind")) === "favicon" ? "favicon" : "logo";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file first." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "File too large (max 512 KB)." };
  }
  const allowed = kind === "favicon" ? FAVICON_TYPES : LOGO_TYPES;
  if (!allowed.has(file.type)) {
    return {
      error: `Unsupported file type${file.type ? ` (${file.type})` : ""}. Allowed: ${[...allowed].join(", ")}.`,
    };
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  await saveBrandingAsset(kind, file.type, base64, user.id);
  await audit(user.email, "branding_asset_uploaded", { kind, mime: file.type });
  refresh();
  return { ok: true, message: `${kind === "favicon" ? "Favicon" : "Logo"} updated.` };
}

export async function clearBrandingAssetAction(
  _prev: BrandingActionState,
  formData: FormData,
): Promise<BrandingActionState> {
  const user = await requireSuperadmin();
  if (!user) return { error: "Not authorized." };
  const kind = String(formData.get("kind")) === "favicon" ? "favicon" : "logo";
  await clearBrandingAsset(kind, user.id);
  await audit(user.email, "branding_asset_cleared", { kind });
  refresh();
  return {
    ok: true,
    message: `${kind === "favicon" ? "Favicon" : "Logo"} removed — using the default.`,
  };
}
