import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Map Supabase Edge `https://esm.sh/...` imports to local npm packages for Vitest parity tests. */
export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.ts"],
  },
  resolve: {
    alias: {
      "https://esm.sh/luxon@3.7.2": "luxon",
      "https://esm.sh/astronomia@4.2.0/julian": "astronomia/julian",
      "https://esm.sh/astronomia@4.2.0/solar": "astronomia/solar",
      "https://esm.sh/astronomia@4.2.0/moonposition": "astronomia/moonposition",
      "https://esm.sh/astronomia@4.2.0/planetposition": "astronomia/planetposition",
      "https://esm.sh/astronomia@4.2.0/elliptic": "astronomia/elliptic",
      "https://esm.sh/astronomia@4.2.0/nutation": "astronomia/nutation",
      "https://esm.sh/astronomia@4.2.0/coord": "astronomia/coord",
      "https://esm.sh/astronomia@4.2.0/sidereal": "astronomia/sidereal",
      "https://esm.sh/astronomia@4.2.0/data/vsop87Bearth": "astronomia/data/vsop87Bearth",
      "https://esm.sh/astronomia@4.2.0/data/vsop87Bmercury": "astronomia/data/vsop87Bmercury",
      "https://esm.sh/astronomia@4.2.0/data/vsop87Bvenus": "astronomia/data/vsop87Bvenus",
      "https://esm.sh/astronomia@4.2.0/data/vsop87Bmars": "astronomia/data/vsop87Bmars",
      "https://esm.sh/astronomia@4.2.0/data/vsop87Bjupiter": "astronomia/data/vsop87Bjupiter",
      "https://esm.sh/astronomia@4.2.0/data/vsop87Bsaturn": "astronomia/data/vsop87Bsaturn",
      "@": root,
    },
  },
});
