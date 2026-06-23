import { Audio } from "expo-av";
import { getInfoAsync, readAsStringAsync } from "expo-file-system/legacy";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";

import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import { whisperRecordingOptions } from "@/modules/communicator/core/whisperRecording";
import { useAppLocale } from "@/modules/i18n";
import { useAuth } from "@/modules/auth";
import { getCalibrationStrings } from "@/modules/calibration/i18n/calibration";
import { intlLocaleTag } from "@/modules/i18n/localeCodes";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";
import { getUserErrorStrings } from "@/modules/ui/i18n/userErrors";
import { extractCalibration, transcribeCommunicatorAudio } from "@/services/communicator-client";
import { resolveUserFacingAlert } from "@/services/userFacingErrors";

type CalibrationPhase = "idle" | "recording" | "transcribing" | "editing" | "extracting" | "complete" | "error";

const MIN_VOICE_MS = 450;
const LOW_TRANSCRIPTION_CONFIDENCE = 0.65;

export default function CalibrationScreen() {
  const theme = useTheme();
  const { profile } = useAuth();
  const { locale } = useAppLocale();
  const strings = getCalibrationStrings(locale);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordStartRef = useRef(0);
  const [phase, setPhase] = useState<CalibrationPhase>("idle");
  const [feedbackText, setFeedbackText] = useState("");
  const [transcriptionConfidence, setTranscriptionConfidence] = useState<number | undefined>(undefined);
  const [summary, setSummary] = useState<string | null>(null);

  const reportError = useCallback(
    (err: Error) => {
      setPhase("error");
      const copy = resolveUserFacingAlert(err, locale, {
        genericTitle: strings.genericFailureTitle,
      });
      const userErrors = getUserErrorStrings(locale);
      Alert.alert(copy.title, copy.message, [{ text: userErrors.dismissButton }]);
    },
    [locale, strings.genericFailureTitle],
  );

  const startRecording = useCallback(async () => {
    if (phase === "recording" || phase === "extracting") return;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        reportError(new Error(strings.microphoneDenied));
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(whisperRecordingOptions());
      recordingRef.current = recording;
      recordStartRef.current = Date.now();
      setSummary(null);
      setTranscriptionConfidence(undefined);
      setPhase("recording");
    } catch (e) {
      reportError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [phase, reportError]);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec || phase !== "recording") return;
    recordingRef.current = null;

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      const durationMs = Date.now() - recordStartRef.current;
      if (!uri || durationMs < MIN_VOICE_MS) {
        setPhase("idle");
        return;
      }
      const info = await getInfoAsync(uri);
      const size = info.exists && !info.isDirectory ? info.size : 0;
      if (size < 16) {
        setPhase("idle");
        return;
      }

      setPhase("transcribing");
      const mimeType = mimeFromRecordingUri(uri);
      const base64 = await readAsStringAsync(uri, { encoding: "base64" });
      const transcript = await transcribeCommunicatorAudio({ mimeType, base64, language: locale });
      setFeedbackText(transcript.text);
      setTranscriptionConfidence(transcript.confidence);
      setPhase("editing");
    } catch (e) {
      setPhase("editing");
      reportError(
        new Error(
          `${strings.transcribeFallbackPrefix} ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
    }
  }, [locale, phase, reportError, strings.transcribeFallbackPrefix]);

  const runExtraction = useCallback(async () => {
    const text = feedbackText.trim();
    if (!text) {
      Alert.alert(strings.addTextTitle, strings.addTextMessage);
      return;
    }

    try {
      setPhase("extracting");
      const result = await extractCalibration({
        source: "initial",
        feedbackText: text,
        language: locale,
      });
      const calibration = result.calibration as { version?: number } | undefined;
      const ultraUntil = result.ultraMode?.enabledUntil
        ? new Date(result.ultraMode.enabledUntil).toLocaleDateString(intlLocaleTag(locale), {
            day: "2-digit",
            month: "2-digit",
          })
        : null;
      setSummary(strings.summarySaved(calibration?.version, ultraUntil));
      setPhase("complete");
    } catch (e) {
      reportError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [feedbackText, locale, reportError, strings.addTextMessage, strings.addTextTitle, strings.summarySaved]);

  const busy = phase === "recording" || phase === "transcribing" || phase === "extracting";

  return (
    <StackScreenLayout>
      <StackScrollView
        keyboardShouldPersistTaps="handled"
        contentOptions={{ topPadding: 24, bottomPaddingExtra: 40, gap: 20, maxWidth: 720 }}
      >
        <AppButton
          label={strings.backButton}
          variant="secondary"
          onPress={() => router.back()}
          style={styles.backButton}
        />

        <View style={styles.header}>
          <AppText variant="technicalCaption" tone="accent" style={styles.kicker}>
            {strings.kicker}
          </AppText>
          <ScreenHeader title={strings.title} subtitle={strings.description} />
        </View>

        <SurfaceCardView tone="elevated" style={styles.card}>
          <AppText variant="sectionTitle">{strings.phaseLabel[phase]}</AppText>
          <AppText variant="screenHint" tone="muted">
            {transcriptionConfidence != null && transcriptionConfidence < LOW_TRANSCRIPTION_CONFIDENCE
              ? strings.lowConfidenceHint(Math.round(transcriptionConfidence * 100))
              : phase === "extracting"
                ? strings.extractingHint
                : strings.defaultHint}
          </AppText>

          <TextInput
            value={feedbackText}
            onChangeText={(text) => {
              setFeedbackText(text);
              if (phase === "idle" || phase === "error" || phase === "complete") setPhase("editing");
            }}
            editable={!busy}
            multiline
            placeholder={strings.inputPlaceholder}
            placeholderTextColor={theme.colors.textFaint}
            style={[
              styles.input,
              {
                color: theme.colors.textPrimary,
                borderColor: theme.colors.surfaceBorder,
                backgroundColor: theme.colors.controlButtonBg,
              },
            ]}
          />

          {summary ? (
            <AppText variant="dialogBody" tone="accent">
              {summary}
            </AppText>
          ) : null}

          <View style={styles.actions}>
            <AppButton
              label={phase === "recording" ? strings.stopRecordingButton : strings.recordButton}
              variant="secondary"
              disabled={busy && phase !== "recording"}
              onPress={phase === "recording" ? () => void stopRecording() : () => void startRecording()}
              style={styles.actionButton}
            />
            <AppButton
              label={busy ? strings.runningButton : strings.runButton}
              disabled={busy || !feedbackText.trim()}
              onPress={() => void runExtraction()}
              style={styles.actionButton}
            />
          </View>
        </SurfaceCardView>
      </StackScrollView>
    </StackScreenLayout>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignSelf: "flex-start",
  },
  header: {
    gap: 8,
  },
  kicker: {
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  card: {
    gap: 14,
  },
  input: {
    minHeight: 180,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  actionButton: {
    flexGrow: 1,
  },
});
