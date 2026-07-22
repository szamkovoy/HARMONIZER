import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";
import { tvPageUrl } from "@/modules/remote-play/core/tvPageUrl";

export type RemotePlayLocale = AppContentLocale;

type ConnectTvTable = {
  closeA11y: string;
  title: string;
  descriptionTemplate: string;
  linked: string;
  submitButton: string;
  closeButton: string;
  startPracticeButton: string;
};

type TvRemoteTable = {
  closeA11y: string;
  idleCode: string;
  titleFallback: string;
  metaTemplate: string;
  description: string;
  /** Caption under the large TV URL on the remote screen (no URL inside). */
  openOnTvCaption: string;
  durationUnknown: string;
  durationMinutesTemplate: string;
  statusPlaying: string;
  statusPaused: string;
  statusStopped: string;
  statusWaiting: string;
  statusClosed: string;
  statusTemplate: string;
  pauseButton: string;
  resumeButton: string;
  replayButton: string;
  stopButton: string;
  disconnectButton: string;
  finishingButton: string;
  connectionLostTitle: string;
  connectionLostHint: string;
  reconnectButton: string;
  tvStoppedHint: string;
  completedTitle: string;
  completedHint: string;
  closeButton: string;
  alertTitle: string;
  pauseFailed: string;
  stopFailed: string;
  replayFailed: string;
  disconnectFailed: string;
};

type RemotePlayTable = {
  connect: ConnectTvTable;
  remote: TvRemoteTable;
};

export type ConnectTvStrings = Omit<ConnectTvTable, "descriptionTemplate"> & {
  description: string;
};

export type TvRemoteStrings = Omit<
  TvRemoteTable,
  | "metaTemplate"
  | "durationMinutesTemplate"
  | "statusPlaying"
  | "statusPaused"
  | "statusStopped"
  | "statusWaiting"
  | "statusClosed"
  | "statusTemplate"
> & {
  meta: (pairingCode: string) => string;
  /** Large-display URL for the TV page (`https://zamkovoi.yoga/tv?pt`). */
  tvUrl: string;
  durationMinutes: (minutes: number) => string;
  status: (value: string) => string;
};

const ru: RemotePlayTable = {
  connect: {
    closeA11y: "Закрыть окно подключения ТВ",
    title: "Подключить ТВ",
    descriptionTemplate:
      "Откройте ссылку {tvUrl} на телевизоре или на компьютере, а затем введите ниже 4-символьный код с этой страницы.",
    linked: "ТВ подключен",
    submitButton: "Подключить",
    closeButton: "Закрыть",
    startPracticeButton: "Начать практику",
  },
  remote: {
    closeA11y: "Закрыть пульт",
    idleCode: "не активен",
    titleFallback: "Практика на ТВ",
    metaTemplate: "ТВ-пульт · код {code}",
    description: "Видео запущено на телевизоре. Телефон работает только как пульт управления.",
    openOnTvCaption: "Откройте эту страницу на вашем телевизоре или компьютере",
    durationUnknown: "Длительность уточняется",
    durationMinutesTemplate: "{minutes} мин",
    statusPlaying: "запущено",
    statusPaused: "пауза",
    statusStopped: "остановлено",
    statusWaiting: "ожидание",
    statusClosed: "закрыто",
    statusTemplate: "Статус: {value}",
    pauseButton: "Пауза",
    resumeButton: "Продолжить",
    replayButton: "Запустить заново",
    stopButton: "Стоп",
    disconnectButton: "Отключить ТВ",
    finishingButton: "Завершаем…",
    connectionLostTitle: "Связь с ТВ потеряна",
    connectionLostHint:
      "Вкладка браузера закрыта или ТВ выключен. Подключите ТВ заново и запустите практику повторно.",
    reconnectButton: "Подключить ТВ заново",
    tvStoppedHint:
      "Практика на ТВ остановлена. Откройте страницу на телевизоре и нажмите «Запустить заново». Если открыли новую вкладку — подключите ТВ заново.",
    completedTitle: "Практика завершена",
    completedHint: "Поздравляем — практика засчитана. Закройте окно, чтобы вернуться назад.",
    closeButton: "Закрыть",
    alertTitle: "Remote Play",
    pauseFailed: "Не удалось обновить статус ТВ.",
    stopFailed: "Не удалось остановить видео на ТВ.",
    replayFailed: "Не удалось запустить видео на ТВ.",
    disconnectFailed: "Не удалось отключить ТВ.",
  },
};

const en: RemotePlayTable = {
  connect: {
    closeA11y: "Close TV pairing screen",
    title: "Connect TV",
    descriptionTemplate:
      "Open {tvUrl} on your TV or computer, then enter the 4-character code shown there.",
    linked: "TV connected",
    submitButton: "Connect",
    closeButton: "Close",
    startPracticeButton: "Start practice",
  },
  remote: {
    closeA11y: "Close remote",
    idleCode: "inactive",
    titleFallback: "Practice on TV",
    metaTemplate: "TV remote · code {code}",
    description: "The video is playing on the TV. Your phone works only as a remote.",
    openOnTvCaption: "Open this page on your TV or computer",
    durationUnknown: "Duration pending",
    durationMinutesTemplate: "{minutes} min",
    statusPlaying: "playing",
    statusPaused: "paused",
    statusStopped: "stopped",
    statusWaiting: "waiting",
    statusClosed: "closed",
    statusTemplate: "Status: {value}",
    pauseButton: "Pause",
    resumeButton: "Resume",
    replayButton: "Replay",
    stopButton: "Stop",
    disconnectButton: "Disconnect TV",
    finishingButton: "Finishing…",
    connectionLostTitle: "TV connection lost",
    connectionLostHint:
      "The browser tab was closed or the TV turned off. Reconnect the TV and start the practice again.",
    reconnectButton: "Reconnect TV",
    tvStoppedHint:
      "Playback on the TV has stopped. Open the page on your TV and tap Replay. If you opened a new browser tab, reconnect the TV.",
    completedTitle: "Practice completed",
    completedHint: "Well done — the practice has been recorded. Close the window to return.",
    closeButton: "Close",
    alertTitle: "Remote Play",
    pauseFailed: "Could not update the TV status.",
    stopFailed: "Could not stop playback on the TV.",
    replayFailed: "Could not start playback on the TV.",
    disconnectFailed: "Could not disconnect the TV.",
  },
};

function statusLabel(table: TvRemoteTable, value: string): string {
  const map: Record<string, string> = {
    playing: table.statusPlaying,
    paused: table.statusPaused,
    stopped: table.statusStopped,
    waiting: table.statusWaiting,
    closed: table.statusClosed,
  };
  return map[value] ?? value;
}

export function getConnectTvStrings(locale: RemotePlayLocale = "ru"): ConnectTvStrings {
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  const table = mergeTypedLocale("remotePlay", base, locale).connect;
  const url = tvPageUrl(locale);
  return {
    closeA11y: table.closeA11y,
    title: table.title,
    description: table.descriptionTemplate.replace("{tvUrl}", url),
    linked: table.linked,
    submitButton: table.submitButton,
    closeButton: table.closeButton,
    startPracticeButton: table.startPracticeButton,
  };
}

export function getTvRemoteStrings(locale: RemotePlayLocale = "ru"): TvRemoteStrings {
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  const table = mergeTypedLocale("remotePlay", base, locale).remote;
  return {
    closeA11y: table.closeA11y,
    idleCode: table.idleCode,
    titleFallback: table.titleFallback,
    meta: (pairingCode) => table.metaTemplate.replace("{code}", pairingCode),
    description: table.description,
    openOnTvCaption: table.openOnTvCaption,
    tvUrl: tvPageUrl(locale),
    durationUnknown: table.durationUnknown,
    durationMinutes: (minutes) => table.durationMinutesTemplate.replace("{minutes}", String(minutes)),
    status: (value) => table.statusTemplate.replace("{value}", statusLabel(table, value)),
    pauseButton: table.pauseButton,
    resumeButton: table.resumeButton,
    replayButton: table.replayButton,
    stopButton: table.stopButton,
    disconnectButton: table.disconnectButton,
    finishingButton: table.finishingButton,
    connectionLostTitle: table.connectionLostTitle,
    connectionLostHint: table.connectionLostHint,
    reconnectButton: table.reconnectButton,
    tvStoppedHint: table.tvStoppedHint,
    completedTitle: table.completedTitle,
    completedHint: table.completedHint,
    closeButton: table.closeButton,
    alertTitle: table.alertTitle,
    pauseFailed: table.pauseFailed,
    stopFailed: table.stopFailed,
    replayFailed: table.replayFailed,
    disconnectFailed: table.disconnectFailed,
  };
}
