/** Serves the uploaded assistant avatar from the DB. The chat widget requests
 *  this only when one is configured; 404 otherwise (the default icon is used).
 *  Mirrors /branding/logo. */
import { getAssistantAvatar } from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const asset = await getAssistantAvatar();
  if (!asset) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(asset.data, "base64")), {
    headers: {
      "Content-Type": asset.mime,
      // Short cache so a freshly-uploaded picture shows up promptly.
      "Cache-Control": "public, max-age=60",
    },
  });
}
