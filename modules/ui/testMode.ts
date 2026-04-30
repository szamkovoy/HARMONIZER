export const HARMONIZER_TEST_MODE =
  process.env.EXPO_PUBLIC_HARMONIZER_TEST_MODE?.trim() !== "false";

export const COMMUNICATOR_TEXT_MODE_ENABLED =
  process.env.EXPO_PUBLIC_COMMUNICATOR_TEXT_MODE_ENABLED?.trim() === "true";

export const COMMUNICATOR_MODEL_LABEL =
  process.env.EXPO_PUBLIC_COMMUNICATOR_MODEL_LABEL?.trim() || "gemini-3.1-flash-lite-preview";
