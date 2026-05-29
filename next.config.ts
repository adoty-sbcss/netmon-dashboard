import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal, self-contained server bundle (.next/standalone) that
  // copies only the runtime deps it actually uses — ideal for a small Docker
  // image on Azure Container Apps.
  output: "standalone",
};

export default nextConfig;
