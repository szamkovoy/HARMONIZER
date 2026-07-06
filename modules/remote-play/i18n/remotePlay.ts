import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";

export type RemotePlayLocale = AppContentLocale;

type ConnectTvStrings = {
  closeA11y: string;
  title: string;
  description: string;
  linked: string;
  submitButton: string;
  closeButton: string;
  startPracticeButton: string;
};

type TvRemoteStrings = {
  closeA11y: string;
  idleCode: string;
  titleFallback: string;
  meta: (pairingCode: string) => string;
  description: string;
  openOnTvHint: string;
  durationUnknown: string;
  durationMinutes: (minutes: number) => string;
  status: (value: string) => string;
  pauseButton: string;
  resumeButton: string;
  replayButton: string;
  stopButton: string;
  disconnectButton: string;
  finishingButton: string;
  alertTitle: string;
  pauseFailed: string;
  stopFailed: string;
  replayFailed: string;
  disconnectFailed: string;
};

const ruConnectTv: ConnectTvStrings = {
  closeA11y: "Закрыть окно подключения ТВ",
  title: "Подключить ТВ",
  description:
    "Откройте ссылку https://zamkovoi.yoga/tv на телевизоре или на компьютере, а затем введите ниже 4-символьный код с этой страницы.",
  linked: "ТВ подключен",
  submitButton: "Подключить",
  closeButton: "Закрыть",
  startPracticeButton: "Начать практику",
};

const enConnectTv: ConnectTvStrings = {
  closeA11y: "Close TV pairing screen",
  title: "Connect TV",
  description:
    "Open https://zamkovoi.yoga/tv on your TV or computer, then enter the 4-character code shown there.",
  linked: "TV connected",
  submitButton: "Connect",
  closeButton: "Close",
  startPracticeButton: "Start practice",
};

const ruTvRemote: TvRemoteStrings = {
  closeA11y: "Закрыть пульт",
  idleCode: "не активен",
  titleFallback: "Практика на ТВ",
  meta: (pairingCode) => `ТВ-пульт · код ${pairingCode}`,
  description: "Видео запущено на телевизоре. Телефон работает только как пульт управления.",
  openOnTvHint: "Откройте на телевизоре или на компьютере страницу https://zamkovoi.yoga/tv/",
  durationUnknown: "Длительность уточняется",
  durationMinutes: (minutes) => `${minutes} мин`,
  status: (value) => `Статус: ${({ playing: "запущено", paused: "пауза", stopped: "остановлено", waiting: "ожидание", closed: "закрыто" } as Record<string, string>)[value] ?? value}`,
  pauseButton: "Пауза",
  resumeButton: "Продолжить",
  replayButton: "Запустить заново",
  stopButton: "Стоп",
  disconnectButton: "Отключить ТВ",
  finishingButton: "Завершаем…",
  alertTitle: "Remote Play",
  pauseFailed: "Не удалось обновить статус ТВ.",
  stopFailed: "Не удалось остановить видео на ТВ.",
  replayFailed: "Не удалось запустить видео на ТВ.",
  disconnectFailed: "Не удалось отключить ТВ.",
};

const enTvRemote: TvRemoteStrings = {
  closeA11y: "Close remote",
  idleCode: "inactive",
  titleFallback: "Practice on TV",
  meta: (pairingCode) => `TV remote · code ${pairingCode}`,
  description: "The video is playing on the TV. Your phone works only as a remote.",
  openOnTvHint: "Open https://zamkovoi.yoga/tv/ on your TV or computer",
  durationUnknown: "Duration pending",
  durationMinutes: (minutes) => `${minutes} min`,
  status: (value) => `Status: ${({ playing: "playing", paused: "paused", stopped: "stopped", waiting: "waiting", closed: "closed" } as Record<string, string>)[value] ?? value}`,
  pauseButton: "Pause",
  resumeButton: "Resume",
  replayButton: "Replay",
  stopButton: "Stop",
  disconnectButton: "Disconnect TV",
  finishingButton: "Finishing…",
  alertTitle: "Remote Play",
  pauseFailed: "Could not update the TV status.",
  stopFailed: "Could not stop playback on the TV.",
  replayFailed: "Could not start playback on the TV.",
  disconnectFailed: "Could not disconnect the TV.",
};

export function getConnectTvStrings(locale: RemotePlayLocale = "ru"): ConnectTvStrings {
  return inlineBaseLocale(locale) === "en" ? enConnectTv : ruConnectTv;
}

export function getTvRemoteStrings(locale: RemotePlayLocale = "ru"): TvRemoteStrings {
  return inlineBaseLocale(locale) === "en" ? enTvRemote : ruTvRemote;
}
