import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type AsanaScreenLocale = AppContentLocale;

export type AsanaPlaybackMode = "phone" | "tv";

type AsanaScreenTable = {
  defaultTitle: string;
  closeA11y: string;
  practiceNotFound: string;
  loadFailed: string;
  modePhone: string;
  modeTv: string;
  phoneHint: string;
  phoneVideoMissing: string;
  tvNotConnectedHint: string;
  tvConnectedHint: string;
  tvConnectedMetaTemplate: string;
  tvStatusTemplate: string;
  connectTvButton: string;
  launchOnTvButton: string;
  launchingButton: string;
  openRemoteButton: string;
  videoReadyTitle: string;
  completeButton: string;
  completingButton: string;
  completedTitle: string;
  completedHint: string;
  closeButton: string;
};

export type AsanaScreenStrings = Omit<AsanaScreenTable, "tvConnectedMetaTemplate" | "tvStatusTemplate"> & {
  tvConnectedMeta: (pairingCode: string) => string;
  tvStatus: (value: string) => string;
};

const ru: AsanaScreenTable = {
  defaultTitle: "Практика асан",
  closeA11y: "Закрыть практику",
  practiceNotFound: "Практика не найдена.",
  loadFailed: "Не удалось загрузить практику.",
  modePhone: "Телефон",
  modeTv: "ТВ",
  phoneHint: "Видео откроется во встроенном плеере Vimeo прямо на экране.",
  phoneVideoMissing: "У этой практики пока нет Vimeo ID — воспроизведение недоступно.",
  tvNotConnectedHint:
    "Откройте zamkovoi.yoga/tv на телевизоре или компьютере и введите код подключения.",
  tvConnectedHint: "ТВ подключён. Нажмите «Запустить на ТВ», и видео начнётся на большом экране.",
  tvConnectedMetaTemplate: "ТВ подключён · код {code}",
  tvStatusTemplate: "Статус: {value}",
  connectTvButton: "Подключить ТВ",
  launchOnTvButton: "Запустить на ТВ",
  launchingButton: "Запускаем...",
  openRemoteButton: "Открыть пульт",
  videoReadyTitle: "Видео готово к запуску на ТВ",
  completeButton: "Завершить практику",
  completingButton: "Сохраняем...",
  completedTitle: "Практика завершена",
  completedHint: "Поздравляем — практика засчитана. Закройте окно, чтобы вернуться назад.",
  closeButton: "Закрыть",
};

const en: AsanaScreenTable = {
  defaultTitle: "Asana practice",
  closeA11y: "Close practice",
  practiceNotFound: "Practice not found.",
  loadFailed: "Could not load the practice.",
  modePhone: "Phone",
  modeTv: "TV",
  phoneHint: "The video opens in the built-in Vimeo player right on this screen.",
  phoneVideoMissing: "This practice has no Vimeo ID yet — playback is unavailable.",
  tvNotConnectedHint:
    "Open zamkovoi.yoga/tv on your TV or computer and enter the pairing code shown there.",
  tvConnectedHint: "TV is connected. Press “Launch on TV” and the video will start on the big screen.",
  tvConnectedMetaTemplate: "TV connected · code {code}",
  tvStatusTemplate: "Status: {value}",
  connectTvButton: "Connect TV",
  launchOnTvButton: "Launch on TV",
  launchingButton: "Launching...",
  openRemoteButton: "Open remote",
  videoReadyTitle: "Video is ready to launch on TV",
  completeButton: "Complete practice",
  completingButton: "Saving...",
  completedTitle: "Practice completed",
  completedHint: "Well done — the practice has been recorded. Close the window to return.",
  closeButton: "Close",
};

export function getAsanaScreenStrings(locale: AsanaScreenLocale = "ru"): AsanaScreenStrings {
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  const table = mergeTypedLocale("asanaScreen", base, locale);
  return {
    ...table,
    tvConnectedMeta: (pairingCode) => table.tvConnectedMetaTemplate.replace("{code}", pairingCode),
    tvStatus: (value) => table.tvStatusTemplate.replace("{value}", value),
  };
}
