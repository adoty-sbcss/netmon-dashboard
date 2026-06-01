/** Serves the uploaded favicon from the DB. Referenced by metadata.icons only
 *  when a favicon is configured; 404 otherwise (the static default is used). */
import { getBrandingAsset } from "@/lib/branding";

export const dynamic = "force-dynamic";

export async function GET() {
  const asset = await getBrandingAsset("favicon");
  if (!asset) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(asset.data, "base64")), {
    headers: {
      "Content-Type": asset.mime,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
