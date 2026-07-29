/**
 * Product QA / internal-build gates (baked in at Metro/EAS bundle time).
 *
 * `EXPO_PUBLIC_HARMONIZER_TEST_MODE=true` → show test-only UI (tier switch,
 * day reset, dialog export, diagnostics, model badges, …).
 * Absent or any other value → production UI for end users.
 *
 * Do NOT use `__DEV__` for product test UI: Expo Dev Client is always `__DEV__`,
 * so release-bound QA builds and “clean” user builds must share this flag.
 * Keep `__DEV__` for console logging, HMR patches, and similar tooling only.
 */
export const HARMONIZER_TEST_MODE =
  process.env.EXPO_PUBLIC_HARMONIZER_TEST_MODE?.trim() === "true";

export const COMMUNICATOR_TEXT_MODE_ENABLED =
  process.env.EXPO_PUBLIC_COMMUNICATOR_TEXT_MODE_ENABLED?.trim() === "true";

export const COMMUNICATOR_MODEL_LABEL =
  process.env.EXPO_PUBLIC_COMMUNICATOR_MODEL_LABEL?.trim() || "standard";
