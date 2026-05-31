import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal, self-contained server bundle (.next/standalone) that
  // copies only the runtime deps it actually uses — ideal for a small Docker
  // image on Azure Container Apps.
  output: "standalone",
  // The "Sync now" admin action runs the SFTP pull inline. Keep these native-ish
  // packages external (required from node_modules at runtime) rather than bundled
  // by the compiler, which avoids ssh2's optional-binary resolution issues.
  serverExternalPackages: ["ssh2", "ssh2-sftp-client", "adm-zip"],
};

export default nextConfig;
