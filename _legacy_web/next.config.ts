import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const localNodeModules = path.resolve(__dirname, "node_modules");

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  /** Монорепо: импорты из `../modules/*` должны резолвить `astronomia/*` из `_legacy_web/node_modules`. */
  outputFileTracingRoot: repoRoot,
  webpack(config) {
    const modules = config.resolve.modules;
    const rest = Array.isArray(modules) ? modules : modules ? [modules] : ["node_modules"];
    config.resolve.modules = [localNodeModules, path.join(repoRoot, "node_modules"), ...rest];
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: "sergei-zamkovoi",
  project: "harmonizer-backend",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  disableLogger: true,
});
