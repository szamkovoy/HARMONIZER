import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { CoherenceBreathScreen } from "@/modules/breath/ui/CoherenceBreathScreen";
import { isChakra, type Chakra } from "@/modules/breath/core/chakra";
import type { BreathPracticeId } from "@/modules/breath/i18n/coherence";

/**
 * Роут-обёртка для экрана дыхательной практики.
 *
 * Принимает query-параметры (все необязательные):
 *   - `practiceId` — один из `BreathPracticeId` (`coherent`, `square`, …);
 *   - `durationMs` — длительность практики в миллисекундах;
 *   - `chakra`     — 1..7, чакра для цветового профиля мандалы.
 *
 * Если что-то не парсится — используется дефолт модуля BREATH.
 * См. контракт входа — `@/modules/breath/core/practice-io`.
 */
export default function BreathCoherenceRoute() {
  const params = useLocalSearchParams<{
    practiceId?: string;
    durationMs?: string;
    chakra?: string;
  }>();

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

  return (
    <>
      <StatusBar style="light" />
      <CoherenceBreathScreen
        locale="ru"
        practiceId={practiceId}
        durationMs={durationMs}
        chakra={chakra}
      />
    </>
  );
}
