import { isLikelyFetchNetworkFailure } from "@/modules/auth/authNetworkErrors";
import { getUserErrorStrings, type AppLocale, type UserErrorStrings } from "@/modules/ui/i18n/userErrors";

export type UserFacingErrorKind = "network" | "service_busy" | "auth" | "timeout" | "generic";

export type UserFacingErrorContext = {
  /** Заголовок для generic-ошибок, если не задан — из общих строк. */
  genericTitle?: string;
  genericMessage?: string;
};

export class AppUserError extends Error {
  readonly userFacingKind: UserFacingErrorKind;
  readonly causeDetail?: unknown;

  constructor(kind: UserFacingErrorKind, options?: { cause?: unknown; debugMessage?: string }) {
    super(options?.debugMessage ?? kind);
    this.name = "AppUserError";
    this.userFacingKind = kind;
    this.causeDetail = options?.cause;
  }
}

export function isAppUserError(error: unknown): error is AppUserError {
  return error instanceof AppUserError;
}

export function appUserErrorKind(error: unknown): UserFacingErrorKind | null {
  if (!isAppUserError(error)) return null;
  return error.userFacingKind;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function isLegacyClientNetworkMessage(message: string): boolean {
  return /network error for https?:\/\//i.test(message) || /^Communicator network error/i.test(message);
}

function isServiceBusyMessage(message: string): boolean {
  return (
    /Сервис временно недоступен/i.test(message) ||
    /Service is temporarily busy/i.test(message) ||
    /\b503\b/i.test(message) ||
    /service unavailable/i.test(message) ||
    /high demand/i.test(message) ||
    /\b429\b/i.test(message) ||
    /rate_limit_exceeded/i.test(message) ||
    /GoogleGenerativeAI/i.test(message) ||
    /resource exhausted/i.test(message) ||
    /overloaded/i.test(message) ||
    /\bUNAVAILABLE\b/i.test(message)
  );
}

function isTimeoutMessage(message: string): boolean {
  return /timed out|timeout|занял слишком много|took too long/i.test(message);
}

function isAuthRequiredMessage(message: string): boolean {
  return (
    /Нужна авторизация/i.test(message) ||
    /authorization is required/i.test(message) ||
    /\bUnauthorized\b/i.test(message) ||
    /\bHTTP 401\b/i.test(message)
  );
}

export function classifyUserFacingError(error: unknown): UserFacingErrorKind {
  const kind = appUserErrorKind(error);
  if (kind) return kind;

  const message = errorMessage(error);
  if (isLikelyFetchNetworkFailure(error) || isLegacyClientNetworkMessage(message)) return "network";
  if (isServiceBusyMessage(message)) return "service_busy";
  if (isAuthRequiredMessage(message)) return "auth";
  if (isTimeoutMessage(message)) return "timeout";
  return "generic";
}

export function wrapConnectivityFailure(error: unknown, feature: string): Error {
  if (isAppUserError(error)) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  if (isLikelyFetchNetworkFailure(error) || isLegacyClientNetworkMessage(errorMessage(error))) {
    return new AppUserError("network", {
      cause: error,
      debugMessage: `[${feature}] transient network`,
    });
  }
  return error instanceof Error ? error : new Error(String(error));
}

export type UserFacingAlertCopy = {
  kind: UserFacingErrorKind;
  title: string;
  message: string;
  retryable: boolean;
};

export function resolveUserFacingAlert(
  error: unknown,
  locale: AppLocale,
  context?: UserFacingErrorContext,
): UserFacingAlertCopy {
  const strings = getUserErrorStrings(locale);
  const kind = classifyUserFacingError(error);

  switch (kind) {
    case "network":
      return {
        kind,
        title: strings.networkTitle,
        message: strings.networkMessage,
        retryable: true,
      };
    case "service_busy":
      return {
        kind,
        title: strings.serviceBusyTitle,
        message: strings.serviceBusyMessage,
        retryable: true,
      };
    case "auth":
      return {
        kind,
        title: strings.authRequiredTitle,
        message: strings.authRequiredMessage,
        retryable: false,
      };
    case "timeout":
      return {
        kind,
        title: strings.timeoutTitle,
        message: strings.timeoutMessage,
        retryable: true,
      };
    default:
      return {
        kind,
        title: context?.genericTitle ?? strings.genericTitle,
        message: context?.genericMessage ?? sanitizeGenericServerMessage(errorMessage(error)) ?? strings.genericMessage,
        retryable: false,
      };
  }
}

/** Убираем URL и внутренние префиксы клиентов из текста generic-ошибки. */
function sanitizeGenericServerMessage(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (isLegacyClientNetworkMessage(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (/^(Communicator|Daily forecast|Natal profile|AI monologue) /i.test(trimmed)) return null;
  if (trimmed.length > 280) return `${trimmed.slice(0, 277)}…`;
  return trimmed;
}

export function logErrorForDevelopers(scope: string, error: unknown): void {
  const message = errorMessage(error);
  const kind = classifyUserFacingError(error);
  if (kind === "network") {
    console.warn(`[${scope}]`, message, error instanceof Error ? error.stack : "");
    return;
  }
  console.error(`[${scope}]`, message, error instanceof Error ? error.stack : "");
}

export type { UserErrorStrings };
