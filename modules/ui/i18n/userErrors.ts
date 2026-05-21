export type AppLocale = "ru" | "en";

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
  retryButton: "Try again",
  dismissButton: "Close",
};

export function getUserErrorStrings(locale: AppLocale): UserErrorStrings {
  return locale === "en" ? en : ru;
}
