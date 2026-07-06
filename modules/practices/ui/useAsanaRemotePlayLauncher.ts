/**
 * useAsanaRemotePlayLauncher: общая логика запуска асаны на ТВ из карточки практики.
 *
 * Используется и каталогом практик, и коммуникатором, чтобы карточка асаны вела
 * себя одинаково в обоих контекстах: «Открыть на ТВ» либо открывает окно
 * подключения ТВ (если связи нет), либо запускает видео на ТВ и открывает экран
 * пульта. Аудиодорожка Vimeo выбирается по активной локали приложения.
 */
import { Alert } from "react-native";
import { router, type Href } from "expo-router";

import { useAppLocale } from "@/modules/i18n";
import { vimeoAudiotrackForLocale } from "@/modules/practices/core/vimeo";
import type { PracticeSummary } from "@/modules/practices/core/types";
import { useRemotePlay } from "@/modules/remote-play";

interface AsanaRemotePlayStrings {
  videoUnavailableTitle: string;
  videoUnavailableMessage: string;
  remotePlayErrorTitle: string;
  loadCatalogError: string;
}

export function useAsanaRemotePlayLauncher(strings: AsanaRemotePlayStrings, launchSource: string) {
  const remotePlay = useRemotePlay();
  const { locale } = useAppLocale();

  const launchOnTv = (practice: PracticeSummary) => {
    const vimeoId = practice.video?.provider === "vimeo" ? practice.video.externalId : null;
    if (!vimeoId) {
      Alert.alert(strings.videoUnavailableTitle, strings.videoUnavailableMessage);
      return;
    }
    const audiotrack = vimeoAudiotrackForLocale(locale);
    const durationSec = practice.defaultDurationSec ? String(practice.defaultDurationSec) : "";
    const practiceParams = {
      vimeoId,
      title: practice.title,
      durationSec,
      audiotrack,
      practiceId: practice.id,
      slug: practice.slug,
      chakraIds: practice.chakraIds.join(","),
      launchSource,
    };
    if (!remotePlay.connected) {
      router.push({ pathname: "/connect-tv", params: practiceParams } as Href);
      return;
    }
    void (async () => {
      try {
        await remotePlay.playVimeo(vimeoId, audiotrack);
        router.push({ pathname: "/tv-remote", params: practiceParams } as Href);
      } catch (error) {
        Alert.alert(
          strings.remotePlayErrorTitle,
          error instanceof Error ? error.message : strings.loadCatalogError,
        );
      }
    })();
  };

  return { launchOnTv, connected: remotePlay.connected, busy: remotePlay.busy };
}
