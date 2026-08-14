import { Audio } from "expo-av";
import { getInfoAsync, readAsStringAsync } from "expo-file-system/legacy";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import { whisperRecordingOptions } from "@/modules/communicator/core/whisperRecording";
import { useAuth } from "@/modules/auth";
import { useAppLocale, useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
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
  const [meterLevel, setMeterLevel] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<AffirmationHistoryTurn[]>([]);
  const [refineCount, setRefineCount] = useState(0);
  const [editText, setEditText] = useState("");
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [voiceMime, setVoiceMime] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordStartRef = useRef(0);
  const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<"intake" | "refine" | "voice">("intake");

  const clearMeters = () => {
    if (meterTimerRef.current) clearInterval(meterTimerRef.current);
    meterTimerRef.current = null;
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
    setMeterLevel(0);
  };

  useEffect(() => () => clearMeters(), []);

  const stopAndGetUri = useCallback(async (): Promise<string | null> => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    clearMeters();
    if (!rec) return null;
    try {
      await rec.stopAndUnloadAsync();
      return rec.getURI();
    } catch {
      return null;
    }
  }, []);

  const startRecording = useCallback(
    async (mode: "intake" | "refine" | "voice") => {
      if (busy || recording) return;
      modeRef.current = mode;
      try {
        const perm = await Audio.requestPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t("affirmation.error.generic"));
          return;
        }
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        const { recording: rec } = await Audio.Recording.createAsync(
          whisperRecordingOptions({ isMeteringEnabled: true }),
        );
        recordingRef.current = rec;
        recordStartRef.current = Date.now();
        setRecording(true);
        meterTimerRef.current = setInterval(async () => {
          try {
            const status = await rec.getStatusAsync();
            if (status.isRecording && typeof status.metering === "number") {
              // metering is typically -160..0 dB
              const norm = Math.min(1, Math.max(0, (status.metering + 50) / 50));
              setMeterLevel(norm);
            }
          } catch {
            /* ignore */
          }
        }, 120);
        if (mode !== "voice") {
          maxTimerRef.current = setTimeout(() => {
            void finishRecording();
          }, MAX_INTAKE_MS);
        }
      } catch {
        Alert.alert(t("affirmation.error.generic"));
      }
    },
    // finishRecording defined below — intentional late bind via void call
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, recording, t],
  );

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
    const uri = await stopAndGetUri();
    const durationMs = Date.now() - recordStartRef.current;
    if (!uri || durationMs < MIN_VOICE_MS) return;

    if (mode === "voice") {
      const info = await getInfoAsync(uri);
      const size = info.exists && !info.isDirectory ? info.size : 0;
      if (!size || size < 16) return;
      setVoiceUri(uri);
      setVoiceMime(mimeFromRecordingUri(uri));
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

  const onSelectOption = (index: number) => {
    setSelectedIndex(index);
  };

  const goFinalize = () => {
    if (selectedIndex == null || !options[selectedIndex]) return;
    setEditText(options[selectedIndex]);
    setStep("finalize");
  };

  const playVoice = async () => {
    if (!voiceUri) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const { sound } = await Audio.Sound.createAsync({ uri: voiceUri });
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) void sound.unloadAsync();
      });
    } catch {
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
      }
      await createAffirmation({ text, audioPath });
      router.replace("/affirmation/manage");
    } catch {
      Alert.alert(t("affirmation.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StackScreenLayout>
      <StackScrollView contentContainerStyle={styles.pad}>
        <ScreenHeader title={t("affirmation.create.title")} />

        {step === "intake" ? (
          <View style={styles.block}>
            <AppText variant="screenHint" tone="muted" style={styles.instruction}>
              {t("affirmation.create.step1.instruction")}
            </AppText>
            <MeterBar level={meterLevel} color={theme.colors.accent} track={theme.colors.surfaceBorder} />
            <AppButton
              label={recording ? t("affirmation.create.stop") : t("affirmation.create.record")}
              onPress={() => {
                if (recording) void finishRecording();
                else void startRecording("intake");
              }}
              disabled={busy}
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
              <MeterBar level={meterLevel} color={theme.colors.accent} track={theme.colors.surfaceBorder} />
              <AppButton
                label={recording ? t("affirmation.create.stop") : t("affirmation.create.record")}
                onPress={() => {
                  if (recording) void finishRecording();
                  else void startRecording("refine");
                }}
                disabled={busy}
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
            <MeterBar level={meterLevel} color={theme.colors.accent} track={theme.colors.surfaceBorder} />
            <View style={styles.row}>
              <AppButton
                label={
                  recording
                    ? t("affirmation.create.stop")
                    : voiceUri
                      ? t("affirmation.create.step4.rerecord")
                      : t("affirmation.create.step4.recordVoice")
                }
                onPress={() => {
                  if (recording) void finishRecording();
                  else void startRecording("voice");
                }}
                disabled={busy}
              />
              {voiceUri && !recording ? (
                <AppButton
                  label={t("affirmation.create.step4.playVoice")}
                  onPress={() => void playVoice()}
                  variant="secondary"
                />
              ) : null}
            </View>
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

function MeterBar({
  level,
  color,
  track,
}: {
  level: number;
  color: string;
  track: string;
}) {
  return (
    <View style={[styles.meterTrack, { backgroundColor: track }]}>
      <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingBottom: 40, gap: 16 },
  block: { gap: 12 },
  instruction: { lineHeight: 22 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
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
  row: { gap: 10 },
  meterTrack: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 999,
  },
});
