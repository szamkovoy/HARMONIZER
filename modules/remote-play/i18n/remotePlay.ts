import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";

export type RemotePlayLocale = AppContentLocale;

type ConnectTvStrings = {
  closeA11y: string;
  title: string;
  description: string;
  linked: string;
  submitButton: string;
};

type TvRemoteStrings = {
  closeA11y: string;
  idleCode: string;
  titleFallback: string;
  meta: (pairingCode: string) => string;
  description: string;
  durationUnknown: string;
  durationMinutes: (minutes: number) => string;
  status: (value: string) => string;
  pauseButton: string;
  resumeButton: string;
  stopButton: string;
  alertTitle: string;
  pauseFailed: string;
  stopFailed: string;
};

const ruConnectTv: ConnectTvStrings = {
  closeA11y: "Закрыть окно подключения ТВ",
  title: "Подключить ТВ",
  description:
    "Откройте ссылку https://zamkovoi.yoga/tv на телевизоре или на компьютере, а затем введите ниже 4-символьный код с этой страницы.",
  linked: "ТВ подключен",
  submitButton: "Подключить",
};

const enConnectTv: ConnectTvStrings = {
  closeA11y: "Close TV pairing screen",
  title: "Connect TV",
  description:
    "Open https://zamkovoi.yoga/tv on your TV or computer, then enter the 4-character code shown there.",
  linked: "TV connected",
  submitButton: "Connect",
};

const ruTvRemote: TvRemoteStrings = {
  closeA11y: "Закрыть пульт",
  idleCode: "не активен",
  titleFallback: "Практика на ТВ",
  meta: (pairingCode) => `ТВ-пульт · код ${pairingCode}`,
  description: "Видео запущено на телевизоре. Телефон работает только как пульт управления.",
  durationUnknown: "Длительность уточняется",
  durationMinutes: (minutes) => `${minutes} мин`,
  status: (value) => `Статус: ${value}`,
  pauseButton: "Пауза",
  resumeButton: "Продолжить",
  stopButton: "Стоп",
  alertTitle: "Remote Play",
  pauseFailed: "Не удалось обновить статус ТВ.",
  stopFailed: "Не удалось остановить видео на ТВ.",
};

const enTvRemote: TvRemoteStrings = {
  closeA11y: "Close remote",
  idleCode: "inactive",
  titleFallback: "Practice on TV",
  meta: (pairingCode) => `TV remote · code ${pairingCode}`,
  description: "The video is playing on the TV. Your phone works only as a remote.",
  durationUnknown: "Duration pending",
  durationMinutes: (minutes) => `${minutes} min`,
  status: (value) => `Status: ${value}`,
  pauseButton: "Pause",
  resumeButton: "Resume",
  stopButton: "Stop",
  alertTitle: "Remote Play",
  pauseFailed: "Could not update the TV status.",
  stopFailed: "Could not stop playback on the TV.",
};

export function getConnectTvStrings(locale: RemotePlayLocale = "ru"): ConnectTvStrings {
  return inlineBaseLocale(locale) === "en" ? enConnectTv : ruConnectTv;
}

export function getTvRemoteStrings(locale: RemotePlayLocale = "ru"): TvRemoteStrings {
  return inlineBaseLocale(locale) === "en" ? enTvRemote : ruTvRemote;
}
