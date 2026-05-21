import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logTestModeStartupWarning } = await import("./app/api/_utils/testMode");
    logTestModeStartupWarning();
    await import("./sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
