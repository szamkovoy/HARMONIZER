import * as Sentry from "@sentry/nextjs";

import { isExpectedLlmUnavailableError, isStreamPipeArtifactError } from "./app/api/_utils/monitoring";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
  beforeSend(event, hint) {
    const original = hint.originalException;
    if (isStreamPipeArtifactError(original)) return null;
    const combined = (event.exception?.values ?? [])
      .map((entry) => entry.value ?? "")
      .join("\n");
    if (
      /failed to pipe response/i.test(combined)
      && isExpectedLlmUnavailableError(new Error(combined))
    ) {
      return null;
    }
    return event;
  },
});
