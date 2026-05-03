import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useRemotePlay } from "@/modules/remote-play/useRemotePlay";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

function durationLabel(seconds: number | null): string {
  if (!seconds) return "Длительность уточняется";
  return `${Math.max(1, Math.round(seconds / 60))} мин`;
}

export function TVRemoteScreen() {
  const theme = useTheme();
  const remotePlay = useRemotePlay();
  const params = useLocalSearchParams<{ title?: string; durationSec?: string }>();
  const title = typeof params.title === "string" && params.title.trim() ? params.title.trim() : "Практика на ТВ";
  const durationSec = useMemo(() => {
    const parsed = typeof params.durationSec === "string" ? Number.parseInt(params.durationSec, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [params.durationSec]);
  const [startedAt] = useState(() => Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (remotePlay.session?.status !== "playing") return;
    const timer = setInterval(() => {
      setElapsedSec(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [remotePlay.session?.status, startedAt]);

  const progress = durationSec ? Math.min(1, elapsedSec / durationSec) : 0;
  const status = remotePlay.session?.status ?? "waiting";

  const pauseOrResume = async () => {
    try {
      if (status === "paused") {
        await remotePlay.resume();
      } else {
        await remotePlay.pause();
      }
    } catch (error) {
      Alert.alert("Remote Play", error instanceof Error ? error.message : "Не удалось обновить статус ТВ.");
    }
  };

  const stop = async () => {
    try {
      await remotePlay.stop();
      router.back();
    } catch (error) {
      Alert.alert("Remote Play", error instanceof Error ? error.message : "Не удалось остановить видео на ТВ.");
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Закрыть пульт"
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.floatingClose,
          {
            backgroundColor: theme.colors.controlButtonBg,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
        hitSlop={12}
      >
        <AppText variant="sectionTitle">×</AppText>
      </Pressable>

      <View style={styles.content}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <View style={styles.header}>
            <AppText variant="technicalCaption" tone="muted">
              ТВ-пульт · код {remotePlay.session?.pairing_code ?? "не активен"}
            </AppText>
            <AppText variant="screenTitle" accessibilityRole="header">
              {title}
            </AppText>
            <AppText variant="screenHint" tone="muted">
              Видео запущено на телевизоре. Телефон работает только как пульт управления.
            </AppText>
          </View>

          <View style={styles.progressBlock}>
            <View style={[styles.progressTrack, { backgroundColor: theme.colors.controlButtonBg }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress * 100}%`,
                    backgroundColor: theme.colors.buttonPrimaryBg,
                  },
                ]}
              />
            </View>
            <View style={styles.progressLabels}>
              <AppText variant="technicalCaption" tone="muted">
                {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")}
              </AppText>
              <AppText variant="technicalCaption" tone="muted">
                {durationLabel(durationSec)}
              </AppText>
            </View>
          </View>

          <View style={[styles.statusPill, { borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="inlineStatus">Статус: {status}</AppText>
          </View>

          <View style={styles.actions}>
            <AppButton
              label={status === "paused" ? "Продолжить" : "Пауза"}
              onPress={pauseOrResume}
              disabled={!remotePlay.connected || remotePlay.busy || status === "stopped"}
              style={styles.actionButton}
            />
            <AppButton
              label="Стоп"
              variant="secondary"
              onPress={stop}
              disabled={!remotePlay.connected || remotePlay.busy}
              style={styles.actionButton}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  floatingClose: {
    position: "absolute",
    top: 54,
    right: 18,
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    gap: 22,
    padding: 20,
  },
  header: {
    gap: 8,
  },
  progressBlock: {
    gap: 8,
  },
  progressTrack: {
    height: 12,
    overflow: "hidden",
    borderRadius: 999,
  },
  progressFill: {
    height: "100%",
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusPill: {
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
});
