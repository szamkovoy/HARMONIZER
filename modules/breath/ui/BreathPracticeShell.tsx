import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  type SharedValue,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";

import {
  type PlannedCycle,
} from "@/modules/breath/core/breath-phase-planner";
import {
  computeBreathPosition,
  phaseAtTimeInCycle,
} from "@/modules/breath/core/rhythm-easing";

/**
 * Контракт компонента:
 *  - Родитель передаёт «замороженный» план текущего цикла (`plannedCycle`) и время
 *    его старта (`cycleStartMs`, Date.now() в момент начала цикла).
 *  - Shell рендерит индикатор строго по этому плану: trapezoid-easing внутри фаз,
 *    continuous пересчёт только внутри активного цикла.
 *  - По окончании цикла (когда `t ≥ plannedCycle.cycleMs`) shell вызывает
 *    `onCycleEnd` — один раз на цикл. Родитель ОБЯЗАН в ответ обновить пару
 *    `{plannedCycle, cycleStartMs}` (новый план + `cycleStartMs + previousCycleMs`).
 *    Пока JS не обновил props, worklet удерживает позицию на конечной точке цикла
 *    (без «скачков назад»).
 *
 * Это «cycle-delayed playback»: план следующего цикла строится планировщиком, но
 * применяется только на границе, что устраняет дёрганье индикатора из-за смены
 * `cycleMs` внутри фазы.
 */
export interface BreathPracticeShellProps {
  /** Центральный контент (инструкция / мандала). */
  center: ReactNode;
  underlay?: ReactNode;
  dimOpacity?: number;
  /** Идёт ли отсчёт фаз дыхания (после старта практики). Если false — индикатор замирает. */
  isBreathTimingActive: boolean;
  /**
   * План текущего дыхательного цикла. Shell читает его as-is в worklet-колбэке;
   * обновления применяются только по границе (ожидается, что родитель меняет
   * plan + cycleStartMs атомарно в ответ на `onCycleEnd`).
   */
  plannedCycle: PlannedCycle | null;
  /** `Date.now()` в момент старта текущего цикла. Авторитет для worklet. */
  cycleStartMs: number | null;
  /**
   * Вызывается один раз на каждый завершённый цикл (на UI-потоке → runOnJS).
   * Родитель должен в ответ установить новый `plannedCycle` и сдвинутый `cycleStartMs`.
   */
  onCycleEnd?: () => void;
  /** Нижняя полоса (например optical-сигнал как в пробе ППГ). */
  footer?: ReactNode;
}

function BreathPhaseRail({ progress }: { progress: SharedValue<number> }) {
  const animatedFillStyle = useAnimatedStyle(() => ({
    height: `${Math.min(1, Math.max(0, progress.value)) * 100}%`,
  }));

  return (
    <View style={styles.railOuter} accessibilityLabel="Breath rhythm indicator">
      <View style={styles.railTrack}>
        <Animated.View style={[styles.railFill, animatedFillStyle]} />
      </View>
    </View>
  );
}

/**
 * Примитивная «plain» копия плана — чтобы Reanimated SV гарантированно сериализовался
 * на worklet-сторону. Функция-чистая; вызывается только по смене плана.
 */
function planToSv(plan: PlannedCycle | null): PlannedCycle | null {
  if (!plan) return null;
  return {
    cycleMs: plan.cycleMs,
    phases: plan.phases.map((ph) => ({
      kind: ph.kind,
      beats: ph.beats,
      startMsInCycle: ph.startMsInCycle,
      endMsInCycle: ph.endMsInCycle,
      phaseMs: ph.phaseMs,
      bpmForPhase: ph.bpmForPhase,
    })),
    baselineBpm: plan.baselineBpm,
    rsaInfo: plan.rsaInfo ? { ...plan.rsaInfo } : null,
    shape: {
      phases: plan.shape.phases.map((p) => ({ kind: p.kind, beats: p.beats })),
      baseIndex: plan.shape.baseIndex,
    },
  };
}

export function BreathPracticeShell({
  center,
  underlay,
  dimOpacity = 0,
  isBreathTimingActive,
  plannedCycle,
  cycleStartMs,
  onCycleEnd,
  footer,
}: BreathPracticeShellProps) {
  const progressSV = useSharedValue(0);
  const runSV = useSharedValue(0);
  const startSV = useSharedValue(0);
  const planSV = useSharedValue<PlannedCycle | null>(null);
  /** Флаг: репорт onCycleEnd для текущего плана уже выслан. Сбрасывается при смене плана. */
  const endReportedSV = useSharedValue(0);

  const planRef = useRef(onCycleEnd);
  planRef.current = onCycleEnd;

  const planMaterialized = useMemo(() => planToSv(plannedCycle), [plannedCycle]);

  useEffect(() => {
    planSV.value = planMaterialized;
    endReportedSV.value = 0;
  }, [planMaterialized, planSV, endReportedSV]);

  useEffect(() => {
    if (isBreathTimingActive && cycleStartMs != null) {
      startSV.value = cycleStartMs;
      runSV.value = 1;
    } else {
      runSV.value = 0;
      progressSV.value = 0;
    }
  }, [isBreathTimingActive, cycleStartMs, runSV, startSV, progressSV]);

  useFrameCallback(() => {
    "worklet";
    if (runSV.value < 0.5) {
      return;
    }
    const plan = planSV.value;
    if (!plan || plan.cycleMs <= 0) {
      return;
    }
    const start = startSV.value;
    const t = Date.now() - start;

    if (t >= plan.cycleMs) {
      // Удерживаем позицию на конечной точке цикла до апдейта плана родителем.
      progressSV.value = computeBreathPosition(plan, plan.cycleMs);
      if (endReportedSV.value === 0) {
        endReportedSV.value = 1;
        const cb = planRef.current;
        if (cb) runOnJS(cb)();
      }
      return;
    }

    progressSV.value = computeBreathPosition(plan, Math.max(0, t));
  });

  return (
    <View style={styles.root}>
      {underlay}
      <View style={styles.centerWrap} pointerEvents="box-none">
        {center}
      </View>
      {footer ? (
        <View style={styles.footer} pointerEvents="box-none">
          {footer}
        </View>
      ) : null}
      <BreathPhaseRail progress={progressSV} />
      <View style={[styles.dim, { opacity: dimOpacity }]} pointerEvents="none" />
    </View>
  );
}

/**
 * Для подписей «вдох/выдох» по текущему плану без 60 Гц setState.
 * Возвращает `isInhale` (true, если фаза — вдох; hold трактуется как "поддержание последней фазы").
 */
export function useBreathPhaseLabel(
  elapsedMs: number,
  plannedCycle: PlannedCycle | null,
): { isInhale: boolean; phaseKind: "inhale" | "exhale" | "hold" | "idle" } {
  if (!plannedCycle || plannedCycle.cycleMs <= 0) {
    return { isInhale: true, phaseKind: "idle" };
  }
  const tInCycle = elapsedMs % plannedCycle.cycleMs;
  const res = phaseAtTimeInCycle(plannedCycle, tInCycle);
  if (!res) return { isInhale: true, phaseKind: "idle" };
  return {
    isInhale: res.phase.kind === "inhale",
    phaseKind: res.phase.kind,
  };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#07080c",
  },
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingRight: 56,
    paddingBottom: 140,
  },
  footer: {
    position: "absolute",
    left: 12,
    right: 56,
    bottom: 20,
    zIndex: 4,
  },
  railOuter: {
    position: "absolute",
    right: 18,
    top: 120,
    bottom: 120,
    width: 14,
    justifyContent: "center",
  },
  railTrack: {
    flex: 1,
    width: 14,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  railFill: {
    width: "100%",
    backgroundColor: "rgba(186, 230, 200, 0.85)",
    borderRadius: 7,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
});
