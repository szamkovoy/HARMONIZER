import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { CoherenceBreathScreen } from "@/modules/breath/ui/CoherenceBreathScreen";
import { isChakra, type Chakra } from "@/modules/breath/core/chakra";
import { resolveTempoKey } from "@/modules/breath/core/breath-tempo";
import type { BreathPracticeId } from "@/modules/breath/i18n/coherence";
import { useAppLocale } from "@/modules/i18n";
import { parseSoundBedId } from "@/modules/mandala-sound";
import type { WearableDeviceProvider } from "@/modules/practices/core/types";
import { useAssistantPracticeOverlayDismiss } from "@/modules/practices/ui/useAssistantPracticeOverlayDismiss";

/**
 * Роут-обёртка для экрана дыхательной практики.
 *
 * Принимает query-параметры (все необязательные):
 *   - `practiceId` — один из `BreathPracticeId` (`coherent`, `square`, …);
 *   - `durationMs` — длительность практики в миллисекундах;
 *   - `chakra`     — 1..7, чакра для цветового профиля мандалы.
 *   - `launchSource` — откуда открыли практику: catalog / assistant / direct.
 *
 * Если что-то не парсится — используется дефолт модуля BREATH.
 * См. контракт входа — `@/modules/breath/core/practice-io`.
 */
export default function BreathCoherenceRoute() {
  const params = useLocalSearchParams<{
    practiceId?: string;
    durationMs?: string;
    chakra?: string;
    soundBed?: string;
    tempo?: string;
    launchSource?: string;
    sensorMode?: string;
    deviceId?: string;
    deviceName?: string;
    provider?: string;
    capabilityTier?: string;
    connectionHint?: string;
    autoReconnect?: string;
    usePulseSensor?: string;
  }>();
  const { locale: appLocale } = useAppLocale();

  const practiceId = useMemo<BreathPracticeId | undefined>(() => {
    const p = params.practiceId;
    if (typeof p !== "string") return undefined;
    const known: readonly BreathPracticeId[] = [
      "coherent",
      "nadi-shodhana",
      "surya-bhedana",
      "chandra-bhedana",
      "square",
      "triangle-up",
      "triangle-down",
    ];
    return (known as readonly string[]).includes(p) ? (p as BreathPracticeId) : undefined;
  }, [params.practiceId]);

  const durationMs = useMemo<number | undefined>(() => {
    const raw = params.durationMs;
    if (typeof raw !== "string") return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [params.durationMs]);

  const chakra = useMemo<Chakra | undefined>(() => {
    const raw = params.chakra;
    if (typeof raw !== "string") return undefined;
    const n = Number.parseInt(raw, 10);
    return isChakra(n) ? n : undefined;
  }, [params.chakra]);

  const launchSource = typeof params.launchSource === "string" ? params.launchSource : undefined;
  const soundBed = parseSoundBedId(typeof params.soundBed === "string" ? params.soundBed : undefined);
  const tempo = useMemo(() => {
    if (!practiceId || typeof params.tempo !== "string") return undefined;
    return resolveTempoKey(practiceId, params.tempo);
  }, [params.tempo, practiceId]);
  useAssistantPracticeOverlayDismiss(launchSource);

  return (
    <>
      <StatusBar style="light" />
      <CoherenceBreathScreen
        locale={appLocale}
        practiceId={practiceId}
        durationMs={durationMs}
        chakra={chakra}
        soundBed={soundBed}
        tempo={tempo}
        launchSource={launchSource}
        sensorMode={
          params.sensorMode === "ble" || params.sensorMode === "none" || params.sensorMode === "fingerCamera"
            ? params.sensorMode
            : undefined
        }
        deviceId={typeof params.deviceId === "string" ? params.deviceId : undefined}
        deviceName={typeof params.deviceName === "string" ? params.deviceName : undefined}
        provider={
          params.provider === "polar" ||
          params.provider === "magene" ||
          params.provider === "coospo" ||
          params.provider === "genericHrs" ||
          params.provider === "unknown"
            ? (params.provider as WearableDeviceProvider)
            : undefined
        }
        capabilityTier={typeof params.capabilityTier === "string" ? params.capabilityTier : undefined}
        connectionHint={typeof params.connectionHint === "string" ? params.connectionHint : undefined}
        autoReconnect={params.autoReconnect !== "false"}
        usePulseSensor={params.usePulseSensor !== "false"}
      />
    </>
  );
}
