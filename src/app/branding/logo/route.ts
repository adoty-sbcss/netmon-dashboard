/** Serves the uploaded brand logo from the DB. The sidebar requests this only
 *  when a logo is configured; 404 otherwise (the generated star is used). */
import { getBrandingAsset } from "@/lib/branding";

export const dynamic = "force-dynamic";

export async function GET() {
  const asset = await getBrandingAsset("logo");
  if (!asset) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(asset.data, "base64")), {
    headers: {
      "Content-Type": asset.mime,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
