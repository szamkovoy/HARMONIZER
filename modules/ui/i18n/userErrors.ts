import type { AppLocale } from "@/modules/i18n/localeStore";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type { AppLocale };

export interface UserErrorStrings {
  locale: AppLocale;
  networkTitle: string;
  networkMessage: string;
  serviceBusyTitle: string;
  serviceBusyMessage: string;
  authRequiredTitle: string;
  authRequiredMessage: string;
  genericTitle: string;
  genericMessage: string;
  timeoutTitle: string;
  timeoutMessage: string;
  retryButton: string;
  dismissButton: string;
}

const ru: UserErrorStrings = {
  locale: "ru",
  networkTitle: "Не удалось связаться с сервером",
  networkMessage: "Проверьте интернет или Wi‑Fi и попробуйте ещё раз.",
  serviceBusyTitle: "Сервис временно занят",
  serviceBusyMessage: "Подождите минуту и попробуйте снова.",
  authRequiredTitle: "Нужно войти снова",
  authRequiredMessage: "Сессия истекла. Закройте и откройте приложение или войдите заново.",
  genericTitle: "Что-то пошло не так",
  genericMessage: "Не удалось выполнить запрос. Попробуйте ещё раз чуть позже.",
  timeoutTitle: "Ответ занимает слишком много времени",
  timeoutMessage: "Сервер не успел ответить. Пожалуйста, повторите запрос.",
  retryButton: "Повторить",
  dismissButton: "Закрыть",
};

const en: UserErrorStrings = {
  locale: "en",
  networkTitle: "Could not reach the server",
  networkMessage: "Check your internet or Wi‑Fi and try again.",
  serviceBusyTitle: "Service is temporarily busy",
  serviceBusyMessage: "Please wait a minute and try again.",
  authRequiredTitle: "Please sign in again",
  authRequiredMessage: "Your session expired. Reopen the app or sign in again.",
  genericTitle: "Something went wrong",
  genericMessage: "The request could not be completed. Please try again in a moment.",
  timeoutTitle: "This is taking too long",
  timeoutMessage: "The server did not respond in time. Please try again.",
  retryButton: "Try again",
  dismissButton: "Close",
};

export function getUserErrorStrings(locale: AppLocale): UserErrorStrings {
  const base = locale === "en" ? en : ru;
  return mergeTypedLocale("userErrors", base, locale);
}
