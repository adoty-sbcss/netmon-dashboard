"use server";

/**
 * Server actions to manage a district's authorized DHCP servers. Gated on
 * access to the district (same rule as viewing it); audit-logged.
 */
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { getDistrictBySlug } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict } from "@/lib/auth/scope";
import {
  addAuthorizedDhcpServer,
  removeAuthorizedDhcpServer,
} from "@/lib/dhcp-policy";

export interface DhcpPolicyActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

async function authorize(districtSlug: string) {
  const user = await getSessionUser();
  if (!user) return { error: "Not authenticated." as const };
  const district = await getDistrictBySlug(districtSlug);
  if (!district) return { error: "District not found." as const };
  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, district.id)) {
    return { error: "Not authorized for this district." as const };
  }
  return { user, district };
}

export async function addAuthorizedDhcpServerAction(
  _prev: DhcpPolicyActionState,
  formData: FormData,
): Promise<DhcpPolicyActionState> {
  const districtSlug = String(formData.get("districtSlug") ?? "");
  const auth = await authorize(districtSlug);
  if ("error" in auth) return { error: auth.error };
  const { user, district } = auth;

  const serverIp = String(formData.get("serverIp") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!IPV4.test(serverIp)) {
    return { error: "Enter a valid IPv4 address (e.g. 10.0.0.10)." };
  }

  await addAuthorizedDhcpServer({
    districtId: district.id,
    serverIp,
    label: label || null,
    note: note || null,
    addedBy: user.id,
  });
  await db
    .insert(auditLog)
    .values({
      actorType: "user",
      actor: user.email,
      action: "dhcp_authz_added",
      target: `district:${district.slug}`,
      detail: { serverIp },
    })
    .catch(() => {});
  revalidatePath(`/${district.slug}/settings`);
  revalidatePath("/settings/network");
  return { ok: true, message: `Authorized ${serverIp}.` };
}

export async function removeAuthorizedDhcpServerAction(
  _prev: DhcpPolicyActionState,
  formData: FormData,
): Promise<DhcpPolicyActionState> {
  const districtSlug = String(formData.get("districtSlug") ?? "");
  const auth = await authorize(districtSlug);
  if ("error" in auth) return { error: auth.error };
  const { user, district } = auth;

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { error: "Invalid id." };

  await removeAuthorizedDhcpServer(id, district.id);
  await db
    .insert(auditLog)
    .values({
      actorType: "user",
      actor: user.email,
      action: "dhcp_authz_removed",
      target: `district:${district.slug}`,
      detail: { id },
    })
    .catch(() => {});
  revalidatePath(`/${district.slug}/settings`);
  revalidatePath("/settings/network");
  return { ok: true, message: "Removed." };
}
