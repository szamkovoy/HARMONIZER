import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const legacyWebRoot = path.dirname(fileURLToPath(import.meta.url));

/** Only Linux binaries for Vercel (full package globs exceeded the 250 MB function limit). */
const storyProcessBinaryIncludes = [
  "./node_modules/ffmpeg-static/ffmpeg",
  "./node_modules/ffmpeg-static/index.js",
  "./node_modules/ffmpeg-static/package.json",
  "./node_modules/ffprobe-static/bin/linux/x64/ffprobe",
  "./node_modules/ffprobe-static/index.js",
  "./node_modules/ffprobe-static/package.json",
];

const nextConfig: NextConfig = {
  // Vendored `modules/*` live under `_legacy_web/modules` for Vercel Root Directory builds.
  experimental: { externalDir: true },
  outputFileTracingRoot: legacyWebRoot,
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "sharp"],
  outputFileTracingIncludes: {
    "/api/admin/stories/process": storyProcessBinaryIncludes,
    "/app/api/admin/stories/process": storyProcessBinaryIncludes,
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
