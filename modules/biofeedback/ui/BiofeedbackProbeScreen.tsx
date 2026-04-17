/**
 * BiofeedbackProbeScreen: отладочный инспектор каналов BiofeedbackBus.
 *
 * Заменяет старый 1400-строчный экран, который имел собственный анализатор и
 * множество интерпретирующих UI-блоков. Новая версия:
 *  - монтирует `BiofeedbackProvider` + источник (`FingerPpgCameraSource` или симулятор);
 *  - показывает текущее состояние всех ключевых каналов;
 *  - выводит счётчики событий и историю последних N публикаций;
 *  - умеет запустить тестовую coherence-сессию (вне дыхательного экрана) и экспортировать
 *    JSON v3 со всеми сырыми массивами и логом канальных публикаций.
 */

import Constants from "expo-constants";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cacheDirectory, getContentUriAsync, writeAsStringAsync } from "expo-file-system/legacy";

import { isFingerFrameProcessorAvailable } from "@/modules/biofeedback-finger-frame-processor/src";
import {
  BiofeedbackProvider,
  useBiofeedbackPipeline,
} from "@/modules/biofeedback/bus/biofeedback-provider";
import {
  useBiofeedbackBus,
  useBiofeedbackChannel,
} from "@/modules/biofeedback/bus/react";
import { FingerPpgCameraSource } from "@/modules/biofeedback/sensors/FingerPpgCameraSource";
import { SimulatedSensorSource } from "@/modules/biofeedback/sensors/SimulatedSensorSource";
import { FINGER_CAMERA_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";
import { buildSessionExportV3 } from "@/modules/biofeedback/export/SessionExporter";
import type { ChannelName } from "@/modules/biofeedback/bus/channels";

const isExpoGo = Constants.executionEnvironment === "storeClient";

function ProbeInner() {
  const bus = useBiofeedbackBus();
  const pipeline = useBiofeedbackPipeline();
  const useSimulated = isExpoGo || !isFingerFrameProcessorAvailable();
  const [active, setActive] = useState(false);
  const [coherenceActive, setCoherenceActive] = useState(false);

  const contact = useBiofeedbackChannel("contact");
  const session = useBiofeedbackChannel("session");
  const pulseBpm = useBiofeedbackChannel("pulseBpm");
  const rmssd = useBiofeedbackChannel("rmssd");
  const stress = useBiofeedbackChannel("stress");
  const coherence = useBiofeedbackChannel("coherence");
  const beat = useBiofeedbackChannel("beat");

  const startCoherenceTest = useCallback(() => {
    const startMs = pipeline.getLastSourceTimestampMs() || Date.now();
    pipeline.getCoherenceEngine().startSession({
      sessionStartedAtMs: startMs,
      inhaleMs: 5000,
      exhaleMs: 5000,
      mode: "test120s",
      bufferMsBeforeSession: 0,
    });
    setCoherenceActive(true);
  }, [pipeline]);

  const stopCoherenceTest = useCallback(() => {
    if (!pipeline.getCoherenceEngine().isActive()) return;
    const endMs = pipeline.getLastSourceTimestampMs() || Date.now();
    pipeline.getCoherenceEngine().finalize(endMs);
    setCoherenceActive(false);
  }, [pipeline]);

  const exportV3 = useCallback(async () => {
    try {
      const payload = buildSessionExportV3({
        bus,
        pipeline,
        dataSource: useSimulated ? "simulated" : "fingerPpg",
      });
      const json = JSON.stringify(payload, null, 2);
      const base = cacheDirectory;
      if (base == null) {
        Alert.alert("Файлы", "Каталог кэша недоступен.");
        return;
      }
      const path = `${base}biofeedback-export-v3-${Date.now()}.json`;
      await writeAsStringAsync(path, json);
      const title = "Biofeedback Probe Export v3";
      if (Platform.OS === "android") {
        const contentUri = await getContentUriAsync(path);
        await Share.share({ title, message: "biofeedback-v3.json", url: contentUri });
      } else {
        const fileUrl = path.startsWith("file://") ? path : `file://${path}`;
        await Share.share({ title, url: fileUrl });
      }
    } catch (e: unknown) {
      Alert.alert("Экспорт v3", String(e));
    }
  }, [bus, pipeline, useSimulated]);

  const beatCount = useMemo(() => bus.getHistory("beat").length, [bus, beat]);

  return (
    <SafeAreaView style={styles.safe}>
      {active && !useSimulated ? (
        <FingerPpgCameraSource isActive={active} />
      ) : null}
      {active && useSimulated ? <SimulatedSensorSource isActive={active} /> : null}

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Biofeedback Probe (Bus inspector)</Text>
        <Text style={styles.subtitle}>
          Источник: {useSimulated ? "симулятор" : "PPG камера + frame plugin"}
          {isExpoGo ? " · Expo Go" : " · Dev build"}
        </Text>

        <View style={styles.controls}>
          <Pressable
            onPress={() => setActive((v) => !v)}
            style={[styles.btn, active ? styles.btnDanger : styles.btnPrimary]}
          >
            <Text style={styles.btnText}>{active ? "Остановить" : "Старт"}</Text>
          </Pressable>
          <Pressable
            onPress={coherenceActive ? stopCoherenceTest : startCoherenceTest}
            style={[styles.btn, coherenceActive ? styles.btnWarn : styles.btnNeutral]}
          >
            <Text style={styles.btnText}>
              {coherenceActive ? "Остановить когерент.-сессию" : "Тест когерент. сессии"}
            </Text>
          </Pressable>
          <Pressable onPress={() => exportV3()} style={[styles.btn, styles.btnNeutral]}>
            <Text style={styles.btnText}>Экспорт JSON v3</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              pipeline.reset();
              setCoherenceActive(false);
            }}
            style={[styles.btn, styles.btnNeutral]}
          >
            <Text style={styles.btnText}>Сброс конвейера</Text>
          </Pressable>
        </View>

        <ChannelCard
          name="contact"
          lines={[
            `state: ${contact?.state ?? "—"}`,
            `confidence: ${formatN(contact?.confidence)}`,
            `absentForMs: ${formatI(contact?.absentForMs)}`,
          ]}
        />

        <ChannelCard
          name="session"
          lines={[
            `phase: ${session?.phase ?? "—"}`,
            `warmupElapsedMs: ${formatI(session?.warmupElapsedMs)}`,
            `settleGoodMsAccum: ${formatI(session?.settleGoodMsAccum)}`,
          ]}
        />

        <ChannelCard
          name="pulseBpm"
          lines={[
            `bpm: ${formatN(pulseBpm?.bpm)}`,
            `windowSeconds: ${formatI(pulseBpm?.windowSeconds)}`,
            `lockState: ${pulseBpm?.lockState ?? "—"}`,
            `hasFreshBeat: ${pulseBpm?.hasFreshBeat ?? "—"}`,
            `confidence: ${formatN(pulseBpm?.confidence)}`,
          ]}
        />

        <ChannelCard
          name="beat"
          lines={[
            `total: ${beatCount}`,
            `last source: ${beat?.beat?.source ?? "—"}`,
            `last ts: ${formatI(beat?.beat?.timestampMs)}`,
            `merged in pipeline: ${pipeline.getMergedBeats().length}`,
          ]}
        />

        <ChannelCard
          name="rmssd"
          lines={[
            `ms: ${formatN(rmssd?.rmssdMs)}`,
            `tier: ${rmssd?.tier ?? "—"}`,
            `validBeatCount: ${formatI(rmssd?.validBeatCount)}`,
            `segment: ${rmssd?.segment ?? "—"}`,
            `approximate: ${rmssd?.approximate ?? "—"}`,
          ]}
        />

        <ChannelCard
          name="stress"
          lines={[
            `percent: ${formatN(stress?.percent)}`,
            `rawIndex: ${formatN(stress?.rawIndex)}`,
            `tier: ${stress?.tier ?? "—"}`,
            `segment: ${stress?.segment ?? "—"}`,
          ]}
        />

        <ChannelCard
          name="coherence"
          lines={[
            `currentPercent: ${formatN(coherence?.currentPercent)}`,
            `averagePercent: ${formatN(coherence?.averagePercent)}`,
            `maxPercent: ${formatN(coherence?.maxPercent)}`,
            `entryTimeSec: ${coherence?.entryTimeSec ?? "—"}`,
            `smoothedSeries length: ${coherence?.smoothedSeries.length ?? 0}`,
          ]}
        />

        <Text style={styles.note}>
          Этот экран — отладочный «инспектор» каналов BiofeedbackBus. Каждая карточка
          показывает последнее событие в канале. Кнопка «Экспорт JSON v3» сохраняет полную
          историю каналов плюс сырые данные конвейера для оффлайн-анализа.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ChannelCard({ name, lines }: { name: ChannelName; lines: string[] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{name}</Text>
      {lines.map((l, i) => (
        <Text key={i} style={styles.cardLine}>
          {l}
        </Text>
      ))}
    </View>
  );
}

function formatN(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function formatI(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toString();
}

export function BiofeedbackProbeScreen() {
  return (
    <BiofeedbackProvider config={FINGER_CAMERA_CAPTURE_CONFIG}>
      <ProbeInner />
    </BiofeedbackProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07080c" },
  scroll: { padding: 18, paddingBottom: 80 },
  title: { color: "#f8fafc", fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#94a3b8", fontSize: 13, marginTop: 4, marginBottom: 16 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnPrimary: { backgroundColor: "#22c55e" },
  btnDanger: { backgroundColor: "#ef4444" },
  btnWarn: { backgroundColor: "#f59e0b" },
  btnNeutral: { backgroundColor: "#334155" },
  btnText: { color: "#0f172a", fontWeight: "700" },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(125,143,255,0.1)",
  },
  cardTitle: { color: "#f1f5f9", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  cardLine: { color: "#cbd5e1", fontSize: 13, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  note: { color: "#64748b", fontSize: 12, marginTop: 16, lineHeight: 18 },
});
