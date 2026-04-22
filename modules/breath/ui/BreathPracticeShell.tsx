import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";

import {
  type PlannedCycle,
} from "@/modules/breath/core/breath-phase-planner";
import type { BreathIndicatorKind } from "@/modules/breath/core/practices";
import { phaseAtTimeInCycle } from "@/modules/breath/core/rhythm-easing";
import { BreathIndicatorView } from "@/modules/breath/ui/BreathIndicatorView";

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
   * Вызывается на каждой границе фазы (на UI-потоке → runOnJS).
   *  - `nextPhaseIndex === 0` — переход из последней фазы в первую, т.е. конец цикла.
   *    Родитель должен построить новый план и сдвинуть `cycleStartMs`.
   *  - `nextPhaseIndex > 0` — обычный переход между фазами внутри цикла. Родитель может
   *    решить, надо ли что-то пересобрать (например, применить новое `baseBeats`), или
   *    проигнорировать — тогда текущий план продолжит работать.
   */
  onPhaseChange?: (nextPhaseIndex: number) => void;
  /** Нижняя полоса (например optical-сигнал как в пробе ППГ). */
  footer?: ReactNode;
  /**
   * Какой визуальный индикатор фаз рисуется. По умолчанию — `bar` (одиночный
   * вертикальный столбик когерентного дыхания).
   */
  indicatorKind?: BreathIndicatorKind;
  /**
   * Колбэк на «тап по экрану мимо слотов-контролов» — используется для того, чтобы
   * показать/скрыть всплывающую панель управления. Если не передан — слой-перехватчик
   * тапов не создаётся, все тапы идут в underlay/center/footer как раньше.
   */
  onScreenTap?: () => void;
  /**
   * Слот поверх всех визуальных слоёв: панель управления, тост, баннер и т.п.
   * Элемент должен сам позиционироваться абсолютно (панель обычно `bottom`).
   */
  overlay?: ReactNode;
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
      channel: ph.channel,
    })),
    baselineBpm: plan.baselineBpm,
    rsaInfo: plan.rsaInfo ? { ...plan.rsaInfo } : null,
    shape: {
      phases: plan.shape.phases.map((p) => ({
        kind: p.kind,
        beats: p.beats,
        channel: p.channel,
      })),
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
  onPhaseChange,
  footer,
  indicatorKind = "bar",
  onScreenTap,
  overlay,
}: BreathPracticeShellProps) {
  const runSV = useSharedValue(0);
  const startSV = useSharedValue(0);
  const planSV = useSharedValue<PlannedCycle | null>(null);
  /**
   * Следим за уже «разрешённой» границей фаз: значение = `phaseIndex + 1`, чтобы отличать
   * «не репортилось ни разу» (0) от «репорт для phase 0» (1). Сбрасывается при смене плана.
   */
  const boundaryReportedIndexSV = useSharedValue(0);

  /**
   * Нельзя читать `ref.current` из worklet — ref сериализуется в UI-runtime, а на JS
   * `current` меняется каждый рендер → спам WARN Worklets («modify key current…»).
   * Стабильная функция вызывается через `runOnJS` и уже на JS читает актуальный колбэк.
   */
  const onPhaseChangeRef = useRef(onPhaseChange);
  onPhaseChangeRef.current = onPhaseChange;
  const emitPhaseChangeOnJs = useCallback((nextPhaseIndex: number) => {
    onPhaseChangeRef.current?.(nextPhaseIndex);
  }, []);

  const planMaterialized = useMemo(() => planToSv(plannedCycle), [plannedCycle]);

  useEffect(() => {
    planSV.value = planMaterialized;
    boundaryReportedIndexSV.value = 0;
  }, [planMaterialized, planSV, boundaryReportedIndexSV]);

  useEffect(() => {
    if (isBreathTimingActive && cycleStartMs != null) {
      startSV.value = cycleStartMs;
      runSV.value = 1;
    } else {
      runSV.value = 0;
    }
  }, [isBreathTimingActive, cycleStartMs, runSV, startSV]);

  useFrameCallback(() => {
    "worklet";
    if (runSV.value < 0.5) return;
    const plan = planSV.value;
    if (!plan || plan.cycleMs <= 0) return;
    const t = Date.now() - startSV.value;
    // Вычисляем текущую «следующую» границу фаз. -1 — ничего не пересекли.
    let nextPhaseIndex = -1;
    if (t >= plan.cycleMs) {
      nextPhaseIndex = 0; // конец цикла
    } else {
      for (let i = 0; i < plan.phases.length - 1; i += 1) {
        if (t >= plan.phases[i]!.endMsInCycle) {
          nextPhaseIndex = i + 1;
        } else {
          break;
        }
      }
    }
    if (
      nextPhaseIndex >= 0 &&
      boundaryReportedIndexSV.value !== nextPhaseIndex + 1
    ) {
      boundaryReportedIndexSV.value = nextPhaseIndex + 1;
      runOnJS(emitPhaseChangeOnJs)(nextPhaseIndex);
    }
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
      <BreathIndicatorView
        kind={indicatorKind}
        plannedCycle={plannedCycle}
        cycleStartMs={cycleStartMs}
      />
      {onScreenTap ? (
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.tapBackdrop}
          onPress={onScreenTap}
        />
      ) : null}
      {overlay}
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
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  tapBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    zIndex: 30,
  },
});
