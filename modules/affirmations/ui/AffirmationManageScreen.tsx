import { Audio } from "expo-av";
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Alert, Modal, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Svg, { Line, Path, Rect } from "react-native-svg";

import {
  fetchActiveAffirmation,
  patchAffirmation,
  type AffirmationDto,
  uploadAffirmationAudio,
} from "@/modules/affirmations/core/affirmationsClient";
import {
  resetPlaybackAudioMode,
  startWhisperRecording,
} from "@/modules/affirmations/core/startWhisperRecording";
import { playAffirmationAudio } from "@/modules/affirmations/core/playAffirmationAudio";
import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import { useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { useTheme } from "@/modules/ui/theme";

const CHART_W = 320;
const CHART_H = 180;
const PAD = { l: 8, r: 8, t: 12, b: 24 };

export function AffirmationManageScreen() {
  const theme = useTheme();
  const { t } = useTranslate();
  const [row, setRow] = useState<AffirmationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"early" | "done" | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recordingRef = useState<{ current: Audio.Recording | null }>({ current: null })[0];

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    void fetchActiveAffirmation()
      .then((a) => {
        if (!cancelled) {
          setRow(a);
          if (!a) router.replace("/affirmation/create");
        }
      })
      .catch(() => {
        if (!cancelled) setRow(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(reload);

  const day = row?.currentDay ?? 0;
  const displayDay = Math.max(1, day || 1);

  const onChangePress = () => {
    if (!row) return;
    setModal(day >= 30 ? "done" : "early");
  };

  const archiveAndCreate = async () => {
    if (!row) return;
    setBusy(true);
    try {
      await patchAffirmation(row.id, { status: "archived" });
      setModal(null);
      router.replace("/affirmation/create");
    } catch {
      Alert.alert(t("affirmation.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const keepAndReset = async () => {
    if (!row) return;
    setBusy(true);
    try {
      const updated = await patchAffirmation(row.id, { resetCycle: true });
      setRow(updated);
      setModal(null);
    } catch {
      Alert.alert(t("affirmation.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const closeScreen = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/practices");
  }, []);

  const playAudio = async () => {
    if (!row?.audioSignedUrl) return;
    try {
      await playAffirmationAudio(row.audioSignedUrl);
    } catch {
      Alert.alert(t("affirmation.error.generic"));
    }
  };

  const toggleVoice = async () => {
    if (busy && !recording) return;
    if (recording) {
      const rec = recordingRef.current;
      recordingRef.current = null;
      setRecording(false);
      if (!rec || !row) return;
      setBusy(true);
      try {
        await rec.stopAndUnloadAsync();
        await resetPlaybackAudioMode();
        const uri = rec.getURI();
        if (!uri) return;
        const path = await uploadAffirmationAudio(uri, mimeFromRecordingUri(uri));
        const updated = await patchAffirmation(row.id, { audioPath: path });
        setRow(updated);
      } catch {
        Alert.alert(t("affirmation.error.generic"));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (recordingRef.current) return;
    setBusy(true);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t("affirmation.error.micPermission"));
        return;
      }
      const rec = await startWhisperRecording({ isMeteringEnabled: false });
      recordingRef.current = rec;
      setRecording(true);
    } catch {
      recordingRef.current = null;
      setRecording(false);
      await resetPlaybackAudioMode();
      Alert.alert(t("affirmation.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const zones = useMemo(
    () => [
      { key: "1", label: t("affirmation.manage.zone1"), hint: t("affirmation.manage.zone1Hint"), from: 1, to: 7 },
      { key: "2", label: t("affirmation.manage.zone2"), hint: t("affirmation.manage.zone2Hint"), from: 8, to: 15 },
      { key: "3", label: t("affirmation.manage.zone3"), hint: t("affirmation.manage.zone3Hint"), from: 16, to: 23 },
      { key: "4", label: t("affirmation.manage.zone4"), hint: t("affirmation.manage.zone4Hint"), from: 24, to: 30 },
    ],
    [t],
  );

  const activeZone = zones.find((z) => displayDay >= z.from && displayDay <= z.to) ?? zones[0];

  return (
    <StackScreenLayout>
      <FloatingCloseButton onPress={closeScreen} accessibilityLabel={t("common.close")} />
      <StackScrollView contentContainerStyle={styles.pad}>
        <ScreenHeader title={t("affirmation.manage.title")} />
        {loading || !row ? (
          <AppText tone="muted">{t("affirmation.create.generating")}</AppText>
        ) : (
          <View style={styles.block}>
            <AppText variant="sectionTitle" style={styles.day}>
              {t("affirmation.manage.dayCounter", { day: displayDay })}
            </AppText>
            <AppText variant="screenHint" style={styles.text}>
              {row.text}
            </AppText>

            {row.audioSignedUrl ? (
              <AppButton label={t("affirmation.create.step4.playVoice")} onPress={() => void playAudio()} />
            ) : (
              <AppText tone="muted" variant="technicalCaption">
                {t("affirmation.manage.noAudio")}
              </AppText>
            )}
            <AppButton
              label={
                recording ? t("affirmation.create.stop") : t("affirmation.manage.updateVoice")
              }
              onPress={() => void toggleVoice()}
              variant="secondary"
              disabled={busy}
              busy={busy && !recording}
            />

            <AppText variant="sectionTitle">{t("affirmation.manage.chartTitle")}</AppText>
            <ProgressChart
              day={displayDay}
              accent={theme.colors.accent}
              border={theme.colors.surfaceBorder}
              zoneFill={theme.colors.controlButtonBg}
            />
            <AppText variant="technicalCaption" tone="muted">
              {activeZone.label}: {activeZone.hint}
            </AppText>
            <View style={styles.zoneList}>
              {zones.map((z) => (
                <AppText
                  key={z.key}
                  variant="technicalCaption"
                  tone={z === activeZone ? undefined : "muted"}
                >
                  {z.from}–{z.to}: {z.label}
                </AppText>
              ))}
            </View>

            <AppButton label={t("affirmation.manage.changeCta")} onPress={onChangePress} variant="secondary" />
          </View>
        )}
      </StackScrollView>

      <Modal visible={modal === "early"} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.colors.surfaceElevated }]}>
            <AppText variant="sectionTitle">{t("affirmation.manage.warnTitle")}</AppText>
            <AppText variant="screenHint" tone="muted">
              {t("affirmation.manage.warnBody")}
            </AppText>
            <AppButton label={t("affirmation.manage.warnContinue")} onPress={() => setModal(null)} />
            <AppButton
              label={t("affirmation.manage.warnChange")}
              onPress={() => void archiveAndCreate()}
              variant="secondary"
              disabled={busy}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={modal === "done"} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.colors.surfaceElevated }]}>
            <AppText variant="sectionTitle">{t("affirmation.manage.doneTitle")}</AppText>
            <AppText variant="screenHint" tone="muted">
              {t("affirmation.manage.doneBody")}
            </AppText>
            <AppButton
              label={t("affirmation.manage.doneKeep")}
              onPress={() => void keepAndReset()}
              disabled={busy}
            />
            <AppButton
              label={t("affirmation.manage.doneNew")}
              onPress={() => void archiveAndCreate()}
              variant="secondary"
              disabled={busy}
            />
          </View>
        </View>
      </Modal>
    </StackScreenLayout>
  );
}

function ProgressChart({
  day,
  accent,
  border,
  zoneFill,
}: {
  day: number;
  accent: string;
  border: string;
  zoneFill: string;
}) {
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const x = (d: number) => PAD.l + ((d - 1) / 29) * innerW;
  const y = (d: number) => PAD.t + innerH - ((d - 1) / 29) * innerH;
  const markers = [1, 5, 10, 15, 20, 25, 30];
  const zoneEnds = [7.5, 15.5, 23.5];
  const path = `M ${x(1)} ${y(1)} L ${x(30)} ${y(30)}`;
  const cx = x(Math.min(30, Math.max(1, day)));
  const cy = y(Math.min(30, Math.max(1, day)));

  return (
    <View style={styles.chartWrap}>
      <Svg width={CHART_W} height={CHART_H}>
        {zoneEnds.map((z, i) => {
          const yy = y(z);
          return (
            <Line
              key={i}
              x1={PAD.l}
              x2={CHART_W - PAD.r}
              y1={yy}
              y2={yy}
              stroke={border}
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          );
        })}
        <Rect
          x={PAD.l}
          y={PAD.t}
          width={innerW}
          height={innerH}
          fill={zoneFill}
          opacity={0.35}
          rx={8}
        />
        <Path d={path} stroke={accent} strokeWidth={2.5} fill="none" />
        <Rect x={cx - 5} y={cy - 5} width={10} height={10} rx={5} fill={accent} />
      </Svg>
      <View style={styles.markers}>
        {markers.map((m) => (
          <AppText key={m} variant="technicalCaption" tone="muted" style={styles.marker}>
            {m}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingBottom: 48, gap: 14, paddingTop: 8 },
  block: { gap: 12 },
  /** Larger size than sectionTitle token — keep lineHeight so glyphs are not clipped. */
  day: { fontSize: 28, lineHeight: 36, marginTop: 6 },
  text: { lineHeight: 24 },
  zoneList: { gap: 4 },
  chartWrap: { alignItems: "center", gap: 4 },
  markers: {
    width: CHART_W,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  marker: { width: 28, textAlign: "center" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
});
