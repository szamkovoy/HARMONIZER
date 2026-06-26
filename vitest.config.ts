import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

const sharedCore = path.join(root, "_legacy_web/shared_core");

/** Map Supabase Edge `https://esm.sh/...` imports to local npm packages for Vitest parity tests. */
export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.ts"],
  },
  resolve: {
    alias: [
      { find: /^@shared\/(.+)$/, replacement: `${sharedCore}/$1` },
      { find: "@", replacement: root },
      { find: "@legacy", replacement: path.join(root, "_legacy_web") },
      { find: "https://esm.sh/luxon@3.7.2", replacement: "luxon" },
      { find: "https://esm.sh/astronomia@4.2.0/base", replacement: "astronomia/base" },
      { find: "https://esm.sh/astronomia@4.2.0/julian", replacement: "astronomia/julian" },
      { find: "https://esm.sh/astronomia@4.2.0/solar", replacement: "astronomia/solar" },
      { find: "https://esm.sh/astronomia@4.2.0/moonposition", replacement: "astronomia/moonposition" },
      { find: "https://esm.sh/astronomia@4.2.0/planetposition", replacement: "astronomia/planetposition" },
      { find: "https://esm.sh/astronomia@4.2.0/elliptic", replacement: "astronomia/elliptic" },
      { find: "https://esm.sh/astronomia@4.2.0/nutation", replacement: "astronomia/nutation" },
      { find: "https://esm.sh/astronomia@4.2.0/coord", replacement: "astronomia/coord" },
      { find: "https://esm.sh/astronomia@4.2.0/sidereal", replacement: "astronomia/sidereal" },
      { find: "https://esm.sh/astronomia@4.2.0/data/vsop87Bearth", replacement: "astronomia/data/vsop87Bearth" },
      { find: "https://esm.sh/astronomia@4.2.0/data/vsop87Bmercury", replacement: "astronomia/data/vsop87Bmercury" },
      { find: "https://esm.sh/astronomia@4.2.0/data/vsop87Bvenus", replacement: "astronomia/data/vsop87Bvenus" },
      { find: "https://esm.sh/astronomia@4.2.0/data/vsop87Bmars", replacement: "astronomia/data/vsop87Bmars" },
      { find: "https://esm.sh/astronomia@4.2.0/data/vsop87Bjupiter", replacement: "astronomia/data/vsop87Bjupiter" },
      { find: "https://esm.sh/astronomia@4.2.0/data/vsop87Bsaturn", replacement: "astronomia/data/vsop87Bsaturn" },
    ],
  },
});
