import { Audio } from "expo-av";
import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { router } from "expo-router";
import Svg, { Line, Path, Rect, Text as SvgText } from "react-native-svg";

import {
  fetchActiveAffirmation,
  patchAffirmation,
  type AffirmationDto,
  uploadAffirmationAudio,
} from "@/modules/affirmations/core/affirmationsClient";
import {
  loadAudioEdgeTrim,
  RecordingSpeechTracker,
  saveAudioEdgeTrim,
  type AudioEdgeTrim,
} from "@/modules/affirmations/core/audioEdgeTrim";
import {
  resetPlaybackAudioMode,
  startWhisperRecording,
} from "@/modules/affirmations/core/startWhisperRecording";
import { playAffirmationAudio } from "@/modules/affirmations/core/playAffirmationAudio";
import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import {
  MicCancelButton,
  MicRecordButton,
} from "@/modules/communicator/ui/MicRecordButton";
import { useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { useTheme } from "@/modules/ui/theme";

const CHART_W = 320;
const CHART_H = 168;
const PAD = { l: 8, r: 8, t: 10, b: 10 };
const ZONE_LETTERS = ["A", "B", "C", "D"] as const;

export function AffirmationManageScreen() {
  const theme = useTheme();
  const { t } = useTranslate();
  const [row, setRow] = useState<AffirmationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"early" | "done" | null>(null);
  const [recording, setRecording] = useState(false);
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const speechTrackerRef = useRef<RecordingSpeechTracker | null>(null);
  const voiceLevel = useRef(new Animated.Value(0.2)).current;
  const playingSoundRef = useRef<Audio.Sound | null>(null);

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
    if (!row?.audioSignedUrl || playing) return;
    setPlaying(true);
    try {
      const trim = await loadAudioEdgeTrim(row.audioPath);
      const sound = await playAffirmationAudio(row.audioSignedUrl, {
        trim,
        onFinished: () => {
          playingSoundRef.current = null;
          setPlaying(false);
        },
      });
      playingSoundRef.current = sound;
    } catch {
      playingSoundRef.current = null;
      setPlaying(false);
      Alert.alert(t("affirmation.error.generic"));
    }
  };

  const toggleVoice = async () => {
    if (busy && !recording) return;
    if (recording) {
      const rec = recordingRef.current;
      const tracker = speechTrackerRef.current;
      recordingRef.current = null;
      speechTrackerRef.current = null;
      setRecording(false);
      setArming(false);
      voiceLevel.setValue(0.2);
      if (!rec || !row) return;
      setBusy(true);
      try {
        await rec.stopAndUnloadAsync();
        await resetPlaybackAudioMode();
        const uri = rec.getURI();
        if (!uri) return;
        const trim: AudioEdgeTrim | null = tracker?.finalize() ?? null;
        const path = await uploadAffirmationAudio(uri, mimeFromRecordingUri(uri));
        await saveAudioEdgeTrim(path, trim);
        const updated = await patchAffirmation(row.id, { audioPath: path });
        setRow(updated);
      } catch {
        Alert.alert(t("affirmation.error.generic"));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (recordingRef.current || arming || playing) return;
    setBusy(true);
    setArming(true);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t("affirmation.error.micPermission"));
        return;
      }
      const rec = await startWhisperRecording({ isMeteringEnabled: true });
      const tracker = new RecordingSpeechTracker();
      speechTrackerRef.current = tracker;
      recordingRef.current = rec;
      setRecording(true);
      rec.setOnRecordingStatusUpdate((status) => {
        const metering =
          "metering" in status && typeof status.metering === "number" ? status.metering : null;
        tracker.onMetering(metering);
        const fallbackPulse = 0.28 + 0.12 * Math.sin(Date.now() / 180);
        const normalized =
          metering == null ? fallbackPulse : Math.max(0.08, Math.min(1, (metering + 60) / 60));
        Animated.timing(voiceLevel, {
          toValue: normalized,
          duration: 90,
          useNativeDriver: true,
        }).start();
      });
      rec.setProgressUpdateInterval(90);
    } catch {
      recordingRef.current = null;
      speechTrackerRef.current = null;
      setRecording(false);
      await resetPlaybackAudioMode();
      Alert.alert(t("affirmation.error.generic"));
    } finally {
      setArming(false);
      setBusy(false);
    }
  };

  const zones = useMemo(
    () => [
      { key: "1", letter: ZONE_LETTERS[0], label: t("affirmation.manage.zone1"), hint: t("affirmation.manage.zone1Hint"), from: 1, to: 7 },
      { key: "2", letter: ZONE_LETTERS[1], label: t("affirmation.manage.zone2"), hint: t("affirmation.manage.zone2Hint"), from: 8, to: 15 },
      { key: "3", letter: ZONE_LETTERS[2], label: t("affirmation.manage.zone3"), hint: t("affirmation.manage.zone3Hint"), from: 16, to: 23 },
      { key: "4", letter: ZONE_LETTERS[3], label: t("affirmation.manage.zone4"), hint: t("affirmation.manage.zone4Hint"), from: 24, to: 30 },
    ],
    [t],
  );

  const activeZone = zones.find((z) => displayDay >= z.from && displayDay <= z.to) ?? zones[0];
  const micActive = recording || arming;

  return (
    <StackScreenLayout>
      <StackScrollView contentContainerStyle={styles.pad}>
        <ScreenHeader
          title={t("affirmation.manage.title")}
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              onPress={closeScreen}
              style={({ pressed }) => [
                styles.closeChip,
                {
                  backgroundColor: theme.colors.controlButtonBg,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <AppText variant="buttonLabel">{t("common.close")}</AppText>
            </Pressable>
          }
        />
        {loading || !row ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.colors.accent} size="large" />
          </View>
        ) : (
          <View style={styles.block}>
            <View
              style={[
                styles.affirmationCard,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                },
              ]}
            >
              <AppText variant="screenHint" style={styles.affirmationText}>
                {row.text}
              </AppText>
            </View>

            {row.audioSignedUrl ? (
              <AppButton
                label={t("affirmation.create.step4.playVoice")}
                onPress={() => void playAudio()}
                disabled={playing || micActive}
                busy={playing}
              />
            ) : (
              <AppText tone="muted" variant="technicalCaption">
                {t("affirmation.manage.noAudio")}
              </AppText>
            )}

            <View style={styles.micCluster}>
              <AppText variant="screenHint" tone="muted" style={styles.micLabel}>
                {t("affirmation.manage.updateVoice")}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("affirmation.create.micA11y")}
                disabled={(busy && !recording) || playing}
                onPress={() => void toggleVoice()}
                hitSlop={12}
                style={({ pressed }) => [styles.micHit, pressed ? styles.micHitPressed : null]}
              >
                {busy && !recording && !arming ? (
                  <MicCancelButton />
                ) : (
                  <MicRecordButton active={micActive} level={voiceLevel} />
                )}
              </Pressable>
              <AppText variant="technicalCaption" tone="muted" style={styles.micHint}>
                {micActive
                  ? t("affirmation.create.micHintStop")
                  : t("affirmation.create.micHintStart")}
              </AppText>
            </View>

            <AppText variant="sectionTitle">
              {t("affirmation.manage.chartTitleWithDay", { day: displayDay })}
            </AppText>
            <ProgressChart
              day={displayDay}
              accent={theme.colors.accent}
              muted={theme.colors.textMuted}
              border={theme.colors.surfaceBorder}
              zoneFill={theme.colors.controlButtonBg}
              labelColor={theme.colors.textPrimary}
            />
            <AppText variant="screenHint">
              {t("affirmation.manage.currentPhase", {
                label: activeZone.label,
                hint: activeZone.hint,
              })}
            </AppText>
            <View style={styles.zoneList}>
              {zones.map((z) => (
                <AppText
                  key={z.key}
                  variant="screenHint"
                  tone={z === activeZone ? undefined : "muted"}
                >
                  {t("affirmation.manage.zoneLegend", {
                    letter: z.letter,
                    label: z.label,
                  })}
                </AppText>
              ))}
            </View>

            <AppButton
              label={t("affirmation.manage.changeCta")}
              onPress={onChangePress}
              variant="secondary"
              style={styles.changeCta}
            />
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
  muted,
  border,
  zoneFill,
  labelColor,
}: {
  day: number;
  accent: string;
  muted: string;
  border: string;
  zoneFill: string;
  labelColor: string;
}) {
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const x = (d: number) => PAD.l + ((d - 1) / 29) * innerW;
  /** Equal-height phase bands (A–D), bottom → top. */
  const bandBottom = (bandIndex: number) => PAD.t + innerH - (bandIndex / 4) * innerH;
  const bandMidY = (bandIndex: number) => bandBottom(bandIndex) - innerH / 8;
  const yOnDiagonal = (d: number) => PAD.t + innerH - ((d - 1) / 29) * innerH;
  const markers = [1, 5, 10, 15, 20, 25, 30];
  const clamped = Math.min(30, Math.max(1, day));
  const cx = x(clamped);
  const cy = yOnDiagonal(clamped);
  const pastPath = `M ${x(1)} ${yOnDiagonal(1)} L ${cx} ${cy}`;
  const futurePath =
    clamped < 30 ? `M ${cx} ${cy} L ${x(30)} ${yOnDiagonal(30)}` : null;

  return (
    <View style={styles.chartWrap}>
      <Svg width={CHART_W} height={CHART_H}>
        <Rect
          x={PAD.l}
          y={PAD.t}
          width={innerW}
          height={innerH}
          fill={zoneFill}
          opacity={0.35}
          rx={8}
        />
        {[1, 2, 3].map((i) => {
          const yy = bandBottom(i);
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
        {ZONE_LETTERS.map((letter, i) => (
          <SvgText
            key={letter}
            x={PAD.l + 10}
            y={bandMidY(i) + 4}
            fill={labelColor}
            fontSize={12}
            opacity={0.55}
          >
            {letter}
          </SvgText>
        ))}
        <Path d={pastPath} stroke={accent} strokeWidth={2.5} fill="none" />
        {futurePath ? (
          <Path d={futurePath} stroke={muted} strokeWidth={2.5} fill="none" opacity={0.55} />
        ) : null}
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
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
  },
  closeChip: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  affirmationCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  affirmationText: {
    lineHeight: 24,
    fontSize: 17,
    fontWeight: "600",
  },
  micCluster: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  micLabel: { textAlign: "center" },
  micHit: { alignItems: "center", justifyContent: "center" },
  micHitPressed: { opacity: 0.85 },
  micHint: { textAlign: "center" },
  zoneList: { gap: 6 },
  chartWrap: { alignItems: "center", gap: 2 },
  markers: {
    width: CHART_W,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  marker: { width: 28, textAlign: "center" },
  changeCta: { marginTop: 16 },
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
