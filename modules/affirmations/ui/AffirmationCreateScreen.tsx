import { Audio } from "expo-av";
import { getInfoAsync, readAsStringAsync } from "expo-file-system/legacy";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import {
  createAffirmation,
  generateAffirmationOptions,
  type AffirmationHistoryTurn,
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
import { useAuth } from "@/modules/auth";
import { useAppLocale, useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { useTheme } from "@/modules/ui/theme";
import { transcribeCommunicatorAudio } from "@/services/communicator-client";

type WizardStep = "intake" | "options" | "finalize";

const MIN_VOICE_MS = 450;
const MAX_INTAKE_MS = 3 * 60_000;

export function AffirmationCreateScreen() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { locale } = useAppLocale();
  const { profile } = useAuth();

  const [step, setStep] = useState<WizardStep>("intake");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  /** Immediate visual while Audio session arms (mirrors Communicator `arming`). */
  const [arming, setArming] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<AffirmationHistoryTurn[]>([]);
  const [refineCount, setRefineCount] = useState(0);
  const [editText, setEditText] = useState("");
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [voiceMime, setVoiceMime] = useState<string | null>(null);
  const [voiceTrim, setVoiceTrim] = useState<AudioEdgeTrim | null>(null);
  const [playingVoice, setPlayingVoice] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const speechTrackerRef = useRef<RecordingSpeechTracker | null>(null);
  const recordStartRef = useRef(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<"intake" | "refine" | "voice">("intake");
  const voiceLevel = useRef(new Animated.Value(0.2)).current;
  const finishRecordingRef = useRef<() => Promise<void>>(async () => undefined);
  const startInFlightRef = useRef(false);
  const startGenerationRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  const clearMaxTimer = () => {
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
  };

  useEffect(
    () => () => {
      clearMaxTimer();
      startGenerationRef.current += 1;
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) void rec.stopAndUnloadAsync().catch(() => undefined);
    },
    [],
  );

  const closeWizard = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/practices");
  }, []);

  const stopAndGetUri = useCallback(async (): Promise<{
    uri: string | null;
    trim: AudioEdgeTrim | null;
  }> => {
    const rec = recordingRef.current;
    const tracker = speechTrackerRef.current;
    recordingRef.current = null;
    speechTrackerRef.current = null;
    setRecording(false);
    setArming(false);
    startInFlightRef.current = false;
    clearMaxTimer();
    voiceLevel.setValue(0.2);
    if (!rec) return { uri: null, trim: null };
    try {
      await rec.stopAndUnloadAsync();
      const trim = tracker?.finalize() ?? null;
      return { uri: rec.getURI(), trim };
    } catch {
      return { uri: null, trim: null };
    }
  }, [voiceLevel]);

  const runGenerate = useCallback(
    async (message: string, nextHistory: AffirmationHistoryTurn[]) => {
      setBusy(true);
      try {
        const opts = await generateAffirmationOptions({
          message,
          history: nextHistory,
          userName: profile?.display_name ?? null,
          responseLocale: locale,
        });
        setOptions(opts);
        setSelectedIndex(null);
        setHistory([
          ...nextHistory,
          { role: "user", content: message },
          { role: "assistant", content: opts.join("\n") },
        ]);
        setStep("options");
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        });
      } catch {
        Alert.alert(t("affirmation.error.generate"));
      } finally {
        setBusy(false);
      }
    },
    [locale, profile?.display_name, t],
  );

  const finishRecording = useCallback(async () => {
    const mode = modeRef.current;
    const { uri, trim } = await stopAndGetUri();
    await resetPlaybackAudioMode();
    const durationMs = Date.now() - recordStartRef.current;
    if (!uri || durationMs < MIN_VOICE_MS) return;

    if (mode === "voice") {
      const info = await getInfoAsync(uri);
      const size = info.exists && !info.isDirectory ? info.size : 0;
      if (!size || size < 16) return;
      setVoiceUri(uri);
      setVoiceMime(mimeFromRecordingUri(uri));
      setVoiceTrim(trim);
      return;
    }

    setBusy(true);
    try {
      const mimeType = mimeFromRecordingUri(uri);
      const base64 = await readAsStringAsync(uri, { encoding: "base64" });
      const transcript = await transcribeCommunicatorAudio({
        mimeType,
        base64,
        language: locale,
      });
      const text = transcript.text?.trim() ?? "";
      if (text.length < 12) {
        Alert.alert(t("affirmation.error.transcribe"));
        return;
      }
      if (mode === "refine") {
        setRefineCount((c) => c + 1);
        await runGenerate(text, history);
      } else {
        await runGenerate(text, []);
      }
    } catch {
      Alert.alert(t("affirmation.error.transcribe"));
    } finally {
      setBusy(false);
    }
  }, [history, locale, runGenerate, stopAndGetUri, t]);

  finishRecordingRef.current = finishRecording;

  const startRecording = useCallback(
    async (mode: "intake" | "refine" | "voice") => {
      if (busy || recording || startInFlightRef.current || recordingRef.current) return;
      modeRef.current = mode;
      const generation = ++startGenerationRef.current;
      startInFlightRef.current = true;
      setArming(true);
      voiceLevel.setValue(0.28);
      try {
        const perm = await Audio.requestPermissionsAsync();
        if (generation !== startGenerationRef.current) return;
        if (!perm.granted) {
          setArming(false);
          startInFlightRef.current = false;
          Alert.alert(t("affirmation.error.micPermission"));
          return;
        }
        const rec = await startWhisperRecording({ isMeteringEnabled: true });
        if (generation !== startGenerationRef.current) {
          try {
            await rec.stopAndUnloadAsync();
          } catch {
            /* ignore */
          }
          await resetPlaybackAudioMode();
          return;
        }
        recordingRef.current = rec;
        recordStartRef.current = Date.now();
        const tracker = new RecordingSpeechTracker(recordStartRef.current);
        speechTrackerRef.current = tracker;
        setRecording(true);
        setArming(false);
        startInFlightRef.current = false;
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
        if (mode !== "voice") {
          maxTimerRef.current = setTimeout(() => {
            void finishRecordingRef.current();
          }, MAX_INTAKE_MS);
        }
      } catch {
        if (generation !== startGenerationRef.current) return;
        recordingRef.current = null;
        speechTrackerRef.current = null;
        setRecording(false);
        setArming(false);
        startInFlightRef.current = false;
        await resetPlaybackAudioMode();
        Alert.alert(t("affirmation.error.generic"));
      }
    },
    [busy, recording, t, voiceLevel],
  );

  const toggleMic = useCallback(
    (mode: "intake" | "refine" | "voice") => {
      // Stop always wins once a take is live.
      if (recording) {
        void finishRecording();
        return;
      }
      if (busy || arming || startInFlightRef.current) return;
      void startRecording(mode);
    },
    [arming, busy, finishRecording, recording, startRecording],
  );

  const onSelectOption = (index: number) => {
    setSelectedIndex(index);
  };

  const goFinalize = () => {
    if (selectedIndex == null || !options[selectedIndex]) return;
    setEditText(options[selectedIndex]);
    setStep("finalize");
  };

  const playVoice = async () => {
    if (!voiceUri || playingVoice) return;
    setPlayingVoice(true);
    try {
      await playAffirmationAudio(voiceUri, {
        trim: voiceTrim,
        onFinished: () => setPlayingVoice(false),
      });
    } catch {
      setPlayingVoice(false);
      Alert.alert(t("affirmation.error.generic"));
    }
  };

  const save = async () => {
    const text = editText.trim();
    if (text.length < 8) return;
    setBusy(true);
    try {
      let audioPath: string | null = null;
      if (voiceUri && voiceMime) {
        audioPath = await uploadAffirmationAudio(voiceUri, voiceMime);
        await saveAudioEdgeTrim(audioPath, voiceTrim);
      }
      await createAffirmation({ text, audioPath });
      router.replace("/affirmation/manage");
    } catch {
      Alert.alert(t("affirmation.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const micActive = recording || arming;

  return (
    <StackScreenLayout>
      <FloatingCloseButton
        onPress={closeWizard}
        accessibilityLabel={t("common.close")}
      />
      <StackScrollView ref={scrollRef} contentContainerStyle={styles.pad}>
        <ScreenHeader title={t("affirmation.create.title")} />

        {step === "intake" ? (
          <View style={styles.block}>
            <AppText variant="screenHint" tone="muted" style={styles.instruction}>
              {t("affirmation.create.step1.instruction")}
            </AppText>
            <MicCluster
              recording={micActive}
              busy={busy}
              voiceLevel={voiceLevel}
              onPress={() => toggleMic("intake")}
              a11yLabel={t("affirmation.create.micA11y")}
              hint={
                micActive
                  ? t("affirmation.create.micHintStop")
                  : t("affirmation.create.micHintStart")
              }
            />
            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={theme.colors.accent} />
                <AppText variant="technicalCaption" tone="muted">
                  {recording
                    ? t("affirmation.create.transcribing")
                    : t("affirmation.create.generating")}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}

        {step === "options" ? (
          <View style={styles.block}>
            <AppText variant="sectionTitle">{t("affirmation.create.step3.title")}</AppText>
            {options.map((opt, index) => {
              const active = selectedIndex === index;
              return (
                <Pressable
                  key={`${index}-${opt.slice(0, 24)}`}
                  onPress={() => onSelectOption(index)}
                  style={[
                    styles.option,
                    {
                      borderColor: active ? theme.colors.accent : theme.colors.surfaceBorder,
                      backgroundColor: theme.colors.surfaceElevated,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: active ? theme.colors.accent : theme.colors.surfaceBorder,
                      },
                    ]}
                  >
                    {active ? (
                      <View style={[styles.radioDot, { backgroundColor: theme.colors.accent }]} />
                    ) : null}
                  </View>
                  <AppText variant="screenHint" style={styles.optionText}>
                    {opt}
                  </AppText>
                </Pressable>
              );
            })}
            <AppButton
              label={t("affirmation.create.select")}
              onPress={goFinalize}
              disabled={selectedIndex == null || busy}
            />

            <View style={[styles.refineBox, { borderColor: theme.colors.surfaceBorder }]}>
              <AppText variant="sectionTitle">{t("affirmation.create.step3.refineTitle")}</AppText>
              <AppText variant="screenHint" tone="muted" style={styles.instruction}>
                {t("affirmation.create.step3.refineHint")}
              </AppText>
              {refineCount >= 3 ? (
                <AppText variant="technicalCaption" tone="muted" style={styles.softHint}>
                  {t("affirmation.create.step3.softHint")}
                </AppText>
              ) : null}
              <MicCluster
                recording={micActive}
                busy={busy}
                voiceLevel={voiceLevel}
                onPress={() => toggleMic("refine")}
                a11yLabel={t("affirmation.create.micA11y")}
                hint={
                  micActive
                    ? t("affirmation.create.micHintStop")
                    : t("affirmation.create.micHintStart")
                }
              />
              {busy ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator color={theme.colors.accent} />
                  <AppText variant="technicalCaption" tone="muted">
                    {t("affirmation.create.generating")}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {step === "finalize" ? (
          <View style={styles.block}>
            <AppText variant="sectionTitle">{t("affirmation.create.step4.title")}</AppText>
            <AppText variant="technicalCaption" tone="muted">
              {t("affirmation.create.step4.editLabel")}
            </AppText>
            <TextInput
              value={editText}
              onChangeText={setEditText}
              multiline
              style={[
                styles.input,
                {
                  color: theme.colors.textPrimary,
                  borderColor: theme.colors.surfaceBorder,
                  backgroundColor: theme.colors.surfaceElevated,
                },
              ]}
            />
            <AppText variant="sectionTitle">{t("affirmation.create.step4.voiceTitle")}</AppText>
            <AppText variant="screenHint" tone="muted" style={styles.instruction}>
              {t("affirmation.create.step4.voiceHint")}
            </AppText>
            <AppText variant="screenHint" tone="muted" style={styles.micUpdateLabel}>
              {t("affirmation.manage.updateVoice")}
            </AppText>
            <MicCluster
              recording={micActive}
              busy={busy}
              voiceLevel={voiceLevel}
              onPress={() => toggleMic("voice")}
              a11yLabel={t("affirmation.create.micA11y")}
              hint={
                micActive
                  ? t("affirmation.create.micHintStop")
                  : t("affirmation.create.micHintStart")
              }
            />
            {voiceUri && !recording && !arming ? (
              <AppButton
                label={t("affirmation.create.step4.playVoice")}
                onPress={() => void playVoice()}
                variant="secondary"
                disabled={playingVoice}
                busy={playingVoice}
              />
            ) : null}
            <AppButton
              label={busy ? t("affirmation.create.saving") : t("affirmation.create.step4.save")}
              onPress={() => void save()}
              disabled={busy || editText.trim().length < 8}
            />
          </View>
        ) : null}
      </StackScrollView>
    </StackScreenLayout>
  );
}

function MicCluster({
  recording,
  busy,
  voiceLevel,
  onPress,
  a11yLabel,
  hint,
}: {
  recording: boolean;
  busy: boolean;
  voiceLevel: Animated.Value;
  onPress: () => void;
  a11yLabel: string;
  hint: string;
}) {
  return (
    <View style={styles.micCluster}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        disabled={busy && !recording}
        onPress={onPress}
        hitSlop={12}
        style={({ pressed }) => [styles.micHit, pressed ? styles.micHitPressed : null]}
      >
        {busy && !recording ? (
          <MicCancelButton />
        ) : (
          <MicRecordButton active={recording} level={voiceLevel} />
        )}
      </Pressable>
      <AppText variant="technicalCaption" tone="muted" style={styles.micHint}>
        {hint}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingBottom: 40, gap: 16, paddingTop: 8 },
  block: { gap: 12 },
  instruction: { lineHeight: 22 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center" },
  option: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  optionText: { flex: 1, lineHeight: 22 },
  refineBox: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  softHint: { lineHeight: 18 },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    textAlignVertical: "top",
  },
  micCluster: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  micHit: {
    alignItems: "center",
    justifyContent: "center",
  },
  micHitPressed: {
    opacity: 0.85,
  },
  micHint: {
    textAlign: "center",
  },
  micUpdateLabel: {
    textAlign: "center",
    marginBottom: -4,
  },
});
