import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const legacyWebRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Vendored `modules/*` live under `_legacy_web/modules` for Vercel Root Directory builds.
  experimental: { externalDir: true },
  outputFileTracingRoot: legacyWebRoot,
};

export default withSentryConfig(nextConfig, {
  org: "sergei-zamkovoi",
  project: "harmonizer-backend",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  disableLogger: true,
});
