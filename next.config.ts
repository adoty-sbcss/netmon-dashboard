import type { NextConfig } from "next";

/**
 * Security response headers applied to every route. These are the "safe set" —
 * none can break the app — so they're enforced unconditionally:
 *   - HSTS pins HTTPS for two years. NO `preload` and subdomains scoped to
 *     netmon.sbcss.net only (there are none), so it cannot affect sibling
 *     *.sbcss.net sites.
 *   - X-Frame-Options DENY + nosniff defend against clickjacking / MIME sniffing.
 *   - Referrer-Policy avoids leaking full URLs cross-origin.
 *   - Permissions-Policy disables powerful APIs the app never uses.
 * A full Content-Security-Policy (script-src lockdown) is deliberately NOT here:
 * Next's App Router injects inline bootstrap/streaming scripts, so a correct CSP
 * needs per-request nonces and must be rolled out + verified separately.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  // Produces a minimal, self-contained server bundle (.next/standalone) that
  // copies only the runtime deps it actually uses — ideal for a small Docker
  // image on Azure Container Apps.
  output: "standalone",
  // The "Sync now" admin action runs the SFTP pull inline. Keep these native-ish
  // packages external (required from node_modules at runtime) rather than bundled
  // by the compiler, which avoids ssh2's optional-binary resolution issues.
  serverExternalPackages: ["ssh2", "ssh2-sftp-client", "adm-zip"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
