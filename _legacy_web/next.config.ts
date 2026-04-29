import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
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
