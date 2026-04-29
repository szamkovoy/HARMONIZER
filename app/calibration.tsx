import { Audio } from "expo-av";
import { getInfoAsync, readAsStringAsync } from "expo-file-system/legacy";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import { extractCalibration, transcribeCommunicatorAudio } from "@/services/communicator-client";

type CalibrationPhase = "idle" | "recording" | "transcribing" | "editing" | "extracting" | "complete" | "error";

const MIN_VOICE_MS = 450;

function phaseLabel(phase: CalibrationPhase): string {
  switch (phase) {
    case "recording":
      return "Слушаю обратную связь";
    case "transcribing":
      return "Расшифровываю голос";
    case "editing":
      return "Проверь текст перед калибровкой";
    case "extracting":
      return "Уточняю фундамент";
    case "complete":
      return "Фундамент уточнён";
    case "error":
      return "Нужна повторная попытка";
    default:
      return "Готов к калибровке";
  }
}

export default function CalibrationScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordStartRef = useRef(0);
  const [phase, setPhase] = useState<CalibrationPhase>("idle");
  const [feedbackText, setFeedbackText] = useState("");
  const [summary, setSummary] = useState<string | null>(null);

  const reportError = useCallback((err: Error) => {
    setPhase("error");
    Alert.alert("Калибровка не завершена", err.message);
  }, []);

  const startRecording = useCallback(async () => {
    if (phase === "recording" || phase === "extracting") return;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        reportError(new Error("Нет доступа к микрофону."));
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      recordStartRef.current = Date.now();
      setSummary(null);
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
      const transcript = await transcribeCommunicatorAudio({ mimeType, base64, language: "ru" });
      setFeedbackText(transcript.text);
      setPhase("editing");
    } catch (e) {
      setPhase("editing");
      reportError(
        new Error(
          `Не удалось расшифровать запись автоматически. Можно вставить текст вручную. ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
    }
  }, [phase, reportError]);

  const runExtraction = useCallback(async () => {
    const text = feedbackText.trim();
    if (!text) {
      Alert.alert("Добавь текст", "Нужен текст обратной связи, чтобы пересобрать калибровку.");
      return;
    }

    try {
      setPhase("extracting");
      const result = await extractCalibration({
        source: "initial",
        feedbackText: text,
        language: "ru",
      });
      const calibration = result.calibration as { version?: number } | undefined;
      const ultraUntil = result.ultraMode?.enabledUntil
        ? new Date(result.ultraMode.enabledUntil).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
        : null;
      setSummary(
        `Калибровка сохранена${calibration?.version ? `, версия ${calibration.version}` : ""}. ${
          ultraUntil ? `Ultra-режим активен до ${ultraUntil}.` : "Ultra-режим активирован на 3 дня."
        }`,
      );
      setPhase("complete");
    } catch (e) {
      reportError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [feedbackText, reportError]);

  const busy = phase === "recording" || phase === "transcribing" || phase === "extracting";

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: isDark ? "#0a0a0a" : "#fafafa" }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top + 18, 32),
          paddingBottom: Math.max(insets.bottom + 24, 40),
        },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={{ color: isDark ? "#e5e5e5" : "#262626" }}>Назад</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={[styles.kicker, { color: isDark ? "#a7f3d0" : "#047857" }]}>Calibration</Text>
        <Text style={[styles.title, { color: isDark ? "#fafafa" : "#111827" }]}>Уточнение фундамента</Text>
        <Text style={[styles.description, { color: isDark ? "#d4d4d4" : "#525252" }]}>
          Расскажи голосом или текстом, что в портрете попало точно, что не откликается и что важно добавить.
        </Text>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: isDark ? "#171717" : "#fff",
            borderColor: isDark ? "#404040" : "#e5e5e5",
          },
        ]}
      >
        <Text style={[styles.status, { color: isDark ? "#f5f5f5" : "#171717" }]}>{phaseLabel(phase)}</Text>
        <Text style={[styles.statusHint, { color: isDark ? "#a3a3a3" : "#737373" }]}>
          {phase === "extracting"
            ? "Сверяю твои слова с картой состояний и пересчитываю силу планет."
            : "Это не редактирование текста, а настройка основы, из которой строится рекомендация."}
        </Text>

        <TextInput
          value={feedbackText}
          onChangeText={(text) => {
            setFeedbackText(text);
            if (phase === "idle" || phase === "error" || phase === "complete") setPhase("editing");
          }}
          editable={!busy}
          multiline
          placeholder="Например: про голос и самовыражение очень точно, а про тревожность я бы усилил..."
          placeholderTextColor={isDark ? "#737373" : "#a3a3a3"}
          style={[
            styles.input,
            {
              color: isDark ? "#fafafa" : "#171717",
              borderColor: isDark ? "#404040" : "#d4d4d4",
              backgroundColor: isDark ? "#0f0f0f" : "#fafafa",
            },
          ]}
        />

        {summary ? <Text style={styles.summary}>{summary}</Text> : null}

        <View style={styles.actions}>
          <Pressable
            disabled={busy && phase !== "recording"}
            onPress={phase === "recording" ? () => void stopRecording() : () => void startRecording()}
            style={[styles.secondaryButton, busy && phase !== "recording" && styles.disabled]}
          >
            <Text style={styles.secondaryButtonText}>{phase === "recording" ? "Завершить запись" : "Записать голос"}</Text>
          </Pressable>
          <Pressable disabled={busy || !feedbackText.trim()} onPress={() => void runExtraction()} style={[styles.primaryButton, (busy || !feedbackText.trim()) && styles.disabled]}>
            <Text style={styles.primaryButtonText}>Уточнить фундамент</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    gap: 20,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  header: {
    gap: 8,
  },
  kicker: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 14,
  },
  status: {
    fontSize: 20,
    fontWeight: "800",
  },
  statusHint: {
    fontSize: 14,
    lineHeight: 20,
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
  summary: {
    color: "#16a34a",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: "#16a34a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "800",
  },
  secondaryButton: {
    borderRadius: 999,
    backgroundColor: "#0ea5e9",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: "#fff",
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.45,
  },
});
