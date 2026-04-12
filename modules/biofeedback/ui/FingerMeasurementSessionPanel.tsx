import { cacheDirectory, getContentUriAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  buildFingerSessionExport,
  FINGER_SESSION_END_ABSENT_MS,
  FINGER_SESSION_RECORDING_START_MS,
  type FingerSessionSample,
  SESSION_CHART_VIEWPORT_SECONDS,
  snapshotToSessionSample,
} from "@/modules/biofeedback/core/finger-measurement-session";
import type { FingerSignalSnapshot } from "@/modules/biofeedback/core/types";

type SessionPhase = "idle" | "arming" | "recording" | "completed";

async function shareJsonFile(path: string): Promise<void> {
  const title = "Экспорт замера пульса";
  if (Platform.OS === "android") {
    const contentUri = await getContentUriAsync(path);
    await Share.share({
      title,
      message: "finger-pulse-session.json",
      url: contentUri,
    });
    return;
  }
  await Share.share({
    title,
    url: path,
  });
}

function downsampleUniform<T>(items: readonly T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) {
    return [...items];
  }
  const out: T[] = [];
  const step = (items.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(items[Math.round(i * step)]);
  }
  return out;
}

function SessionWaveform({
  samples,
  height,
  color,
}: {
  samples: readonly FingerSessionSample[];
  height: number;
  color: string;
}) {
  const display = useMemo(
    () => downsampleUniform(samples, 600),
    [samples],
  );
  const values = useMemo(
    () => display.map((s) => s.ppgBandpassed),
    [display],
  );
  const amplitude = Math.max(...values.map((v) => Math.abs(v)), 1e-9);

  return (
    <View style={[styles.waveTrack, { height }]}>
      {display.map((_, index) => {
        const v = values[index] ?? 0;
        const normalized = Math.min(1, Math.max(0.08, Math.abs(v) / amplitude));
        return (
          <View
            key={`${index}-${display[index]?.timestampMs ?? index}`}
            style={[
              styles.waveBar,
              {
                height: `${normalized * 100}%`,
                backgroundColor: color,
                opacity: v >= 0 ? 1 : 0.45,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

type Props = {
  snapshot: FingerSignalSnapshot | null;
  onNewMeasurement: () => void;
};

export function FingerMeasurementSessionPanel({ snapshot, onNewMeasurement }: Props) {
  const screenW = Dimensions.get("window").width;
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [completedSamples, setCompletedSamples] = useState<FingerSessionSample[]>([]);
  const [userNotes, setUserNotes] = useState("");
  const [aiHint] = useState(
    "Экспорт откроет системное меню «Поделиться»: отправьте файл в Telegram/Mail/AirDrop или сохраните в «Файлы», затем на Mac откройте и перетащите JSON в чат Cursor. Пересборка dev client после добавления модулей не нужна — используется только Share и файловая система.",
  );

  const samplesRef = useRef<FingerSessionSample[]>([]);
  const absentMsRef = useRef(0);
  const lastFrameTsRef = useRef(0);
  const phaseRef = useRef<SessionPhase>("idle");
  const liveThrottleRef = useRef(0);
  const [liveTenSecondSamples, setLiveTenSecondSamples] = useState<FingerSessionSample[]>([]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (snapshot == null) {
      return;
    }
    if (phaseRef.current === "completed") {
      return;
    }

    const ts = snapshot.timestampMs;
    const deltaMs =
      lastFrameTsRef.current > 0 ? Math.min(500, Math.max(0, ts - lastFrameTsRef.current)) : 33;
    lastFrameTsRef.current = ts;

    const currentPhase = phaseRef.current;

    if (snapshot.fingerDetected) {
      absentMsRef.current = 0;

      if (snapshot.fingerContactElapsedMs < FINGER_SESSION_RECORDING_START_MS) {
        if (currentPhase === "idle") {
          setPhase("arming");
        }
        return;
      }

      if (currentPhase === "idle" || currentPhase === "arming") {
        setPhase("recording");
      }

      samplesRef.current.push(snapshotToSessionSample(snapshot));

      const now = Date.now();
      if (now - liveThrottleRef.current >= 250) {
        liveThrottleRef.current = now;
        const arr = samplesRef.current;
        if (arr.length > 0) {
          const end = arr[arr.length - 1].timestampMs;
          setLiveTenSecondSamples(arr.filter((s) => s.timestampMs >= end - 10_000));
        }
      }
      return;
    }

    if (currentPhase === "recording") {
      absentMsRef.current += deltaMs;
      if (absentMsRef.current >= FINGER_SESSION_END_ABSENT_MS) {
        const copy = samplesRef.current.slice();
        samplesRef.current = [];
        absentMsRef.current = 0;
        setLiveTenSecondSamples([]);
        setCompletedSamples(copy);
        setPhase("completed");
      }
    }
  }, [snapshot]);

  const last10sSamples = useMemo(() => {
    if (completedSamples.length === 0) {
      return [];
    }
    const end = completedSamples[completedSamples.length - 1].timestampMs;
    return completedSamples.filter((s) => s.timestampMs >= end - 10_000);
  }, [completedSamples]);

  const fullChartContentWidth = useMemo(() => {
    if (completedSamples.length < 2) {
      return screenW;
    }
    const durSec =
      (completedSamples[completedSamples.length - 1].timestampMs - completedSamples[0].timestampMs) / 1000;
    const w = (durSec / SESSION_CHART_VIEWPORT_SECONDS) * screenW;
    return Math.max(screenW, w);
  }, [completedSamples, screenW]);

  const exportJson = useCallback(async () => {
    const payload = buildFingerSessionExport(completedSamples, userNotes);
    if (payload == null) {
      Alert.alert("Нет данных", "Сначала завершите замер.");
      return;
    }
    try {
      const json = JSON.stringify(payload, null, 2);
      const base = cacheDirectory;
      if (base == null) {
        Alert.alert("Файлы", "Каталог кэша недоступен на этой платформе.");
        return;
      }
      const path = `${base}finger-pulse-session-${payload.sessionStartedAtMs}.json`;
      await writeAsStringAsync(path, json);
      try {
        await shareJsonFile(path);
      } catch (shareErr) {
        Alert.alert(
          "Файл записан — поделиться не удалось",
          `${String(shareErr)}\n\nПуть к файлу:\n${path}`,
        );
      }
    } catch (e) {
      Alert.alert("Ошибка экспорта", String(e));
    }
  }, [completedSamples, userNotes]);

  const resetLocal = useCallback(() => {
    samplesRef.current = [];
    absentMsRef.current = 0;
    lastFrameTsRef.current = 0;
    liveThrottleRef.current = 0;
    setLiveTenSecondSamples([]);
    setCompletedSamples([]);
    setUserNotes("");
    setPhase("idle");
    onNewMeasurement();
  }, [onNewMeasurement]);

  const armingSecondsLeft = snapshot
    ? Math.max(0, Math.ceil((FINGER_SESSION_RECORDING_START_MS - snapshot.fingerContactElapsedMs) / 1000))
    : 0;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Замер сессии (PPG → график)</Text>
      <Text style={styles.cardHint}>
        Значимое окно: с {FINGER_SESSION_RECORDING_START_MS / 1000} с контакта до снятия пальца более{" "}
        {FINGER_SESSION_END_ABSENT_MS / 1000} с. Красный канал ведущий; зелёный/синий вычитаются как опорные (см.
        opticalFormula в JSON). Кнопка экспорта сохраняет файл и открывает системное «Поделиться» — оттуда можно
        отправить JSON в Telegram/Mail, AirDrop на Mac или сохранить в «Файлы», затем перетащить файл в чат.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Состояние</Text>
        <Text style={styles.statusValue}>
          {phase === "idle" && "Ожидание"}
          {phase === "arming" && `Прогрев записи (~${armingSecondsLeft}s)`}
          {phase === "recording" && "Идёт запись…"}
          {phase === "completed" && "Замер завершён"}
        </Text>
      </View>

      {phase === "recording" && (
        <>
          <Text style={styles.liveHint}>Держите палец. Снятие &gt;10 с завершит замер.</Text>
          {liveTenSecondSamples.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Скользящие 10 с (обработанный PPG)</Text>
              <SessionWaveform
                samples={liveTenSecondSamples}
                height={88}
                color="#7af0c2"
              />
            </>
          )}
        </>
      )}

      {completedSamples.length > 0 && phase === "completed" && (
        <>
          <Text style={styles.sectionLabel}>Последние 10 с (обработанный PPG)</Text>
          <SessionWaveform samples={last10sSamples.length > 0 ? last10sSamples : completedSamples} height={100} color="#7af0c2" />

          <Text style={styles.sectionLabel}>Весь замер — прокрутка (~{SESSION_CHART_VIEWPORT_SECONDS}s на ширину экрана)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.hScroll}>
            <View style={{ width: fullChartContentWidth }}>
              <SessionWaveform samples={completedSamples} height={140} color="#ff8f9f" />
            </View>
          </ScrollView>
          <Text style={styles.timeHint}>
            t₀ = {new Date(completedSamples[0].timestampMs).toISOString()} … t₁ ={" "}
            {new Date(completedSamples[completedSamples.length - 1].timestampMs).toISOString()}
          </Text>

          <Text style={styles.sectionLabel}>Ваши комментарии к кривой</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Что видите на графике, какие участки подозрительны…"
            placeholderTextColor="rgba(200,210,255,0.45)"
            value={userNotes}
            onChangeText={setUserNotes}
          />

          <Text style={styles.aiHint}>{aiHint}</Text>

          <View style={styles.actions}>
            <Pressable style={styles.primaryButton} onPress={() => void exportJson()}>
              <Text style={styles.primaryButtonText}>Экспорт JSON (поделиться)</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={resetLocal}>
              <Text style={styles.secondaryButtonText}>Новый замер</Text>
            </Pressable>
          </View>
        </>
      )}

      {phase === "completed" && completedSamples.length === 0 && (
        <Text style={styles.errorText}>Нет сэмплов — попробуйте дольше держать палец после 20 с.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#101624",
    borderWidth: 1,
    borderColor: "rgba(146, 162, 255, 0.14)",
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  cardHint: {
    color: "rgba(223, 229, 255, 0.72)",
    fontSize: 13,
    lineHeight: 19,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  statusLabel: {
    color: "rgba(218, 225, 255, 0.58)",
    fontSize: 12,
    fontWeight: "700",
  },
  statusValue: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
    textAlign: "right",
  },
  liveHint: {
    color: "#8cffc8",
    fontSize: 13,
    fontWeight: "600",
  },
  sectionLabel: {
    color: "#eef2ff",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 6,
  },
  waveTrack: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1,
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(18, 24, 40, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.12)",
  },
  waveBar: {
    flex: 1,
    minHeight: 4,
    borderRadius: 999,
  },
  hScroll: {
    maxHeight: 160,
  },
  timeHint: {
    color: "rgba(200, 210, 255, 0.55)",
    fontSize: 11,
  },
  notesInput: {
    minHeight: 88,
    borderRadius: 12,
    padding: 12,
    color: "#fff",
    backgroundColor: "rgba(18, 24, 40, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.22)",
    textAlignVertical: "top",
  },
  aiHint: {
    color: "rgba(200, 210, 255, 0.65)",
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7a8cff",
  },
  primaryButtonText: {
    color: "#091123",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.22)",
  },
  secondaryButtonText: {
    color: "#ecf1ff",
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: "#ffb4a8",
    fontSize: 13,
  },
});
