import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/current-user";
import { getConfigBackupForDownload } from "@/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download a stored sensor config backup (ZIP). Superadmin only — the backup
 * contains the sensor's netmon.env (SFTP creds + SNMP strings). The proxy
 * already requires a valid session to reach /api/sensor/*.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (user.role !== "superadmin") return new NextResponse("Forbidden", { status: 403 });

  const { id } = await params;
  const backupId = Number.parseInt(id, 10);
  if (Number.isNaN(backupId)) return new NextResponse("Bad request", { status: 400 });

  const row = await getConfigBackupForDownload(backupId);
  if (!row) return new NextResponse("Not found", { status: 404 });

  const bytes = Buffer.from(row.contentB64, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
      "content-length": String(bytes.length),
      "cache-control": "no-store",
    },
  });
}
