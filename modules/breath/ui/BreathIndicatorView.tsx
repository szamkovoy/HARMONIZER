/**
 * BreathIndicatorView: единый индикатор фаз дыхания для всех практик.
 *
 * Унифицированная модель:
 *  - На любой практике рисуется **path** (прямая линия для bar/dual-bar, квадрат для
 *    `square`, равносторонний треугольник — для `triangle-up`/`triangle-down`).
 *  - По path бежит «блик» (точка + светящийся хвост-трейл). Индикатор одинаковый
 *    во всех режимах, меняется только сама траектория.
 *  - Для `dual-bar` рисуется **два** независимых блика (левая/правая ноздри).
 *
 * Геометрия и семплинг сделаны вручную (без `ContourMeasureIter`), чтобы поддерживать
 * скруглённые углы на квадрате и треугольнике: sampling идёт по «сегментам»,
 * каждый из которых состоит из прямого участка + четверти окружности в конце.
 * Блик благодаря этому чётко следует по видимой линии, включая скругления.
 *
 * Маппинг фаз дыхания на сегменты:
 *  - bar (когерентное):          phase 0 = low→high (inhale), phase 1 = high→low (exhale).
 *  - dual-bar:                   у каждой линии — те же два направления, но
 *                                анимируется только та линия, чей `channel` совпадает
 *                                с фазой (другая «замирает» на текущем уровне).
 *  - square [inhale, hold, exhale, hold]:
 *      side 0 = bottom-left → top-left (inhale),
 *      side 1 = top-left → top-right (hold),
 *      side 2 = top-right → bottom-right (exhale),
 *      side 3 = bottom-right → bottom-left (hold).
 *  - triangle-up [inhale, exhale, hold]:
 *      side 0 = bottom-left → top (inhale),
 *      side 1 = top → bottom-right (exhale),
 *      side 2 = bottom-right → bottom-left (hold).
 *  - triangle-down [inhale, hold, exhale]:
 *      side 0 = bottom → top-left (inhale),
 *      side 1 = top-left → top-right (hold),
 *      side 2 = top-right → bottom (exhale).
 *
 * Результат: направление движения блика всегда совпадает с текстом текущей фазы —
 * «ВДОХ = вверх», «ВЫДОХ = вниз», «ЗАДЕРЖКА = горизонталь».
 */

import { useEffect, useMemo, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import { Canvas, Circle, Group, Path, Skia, type SkPath } from "@shopify/react-native-skia";

import type { PlannedCycle } from "@/modules/breath/core/breath-phase-planner";
import { easeTrapezoidalProgress } from "@/modules/breath/core/rhythm-easing";
import type { BreathIndicatorKind } from "@/modules/breath/core/practices";
import { useTheme } from "@/modules/ui/theme";

export interface BreathIndicatorViewProps {
  kind: BreathIndicatorKind;
  plannedCycle: PlannedCycle | null;
  cycleStartMs: number | null;
  /**
   * Цвет блика. По умолчанию — accent из темы. В будущем модуль ассистента может
   * передать сюда цвет чакры, на которую направлена практика.
   */
  bubbleColor?: string;
}

// ─── Геометрия ────────────────────────────────────────────────────────────

type XY = { x: number; y: number };

type LineSegment = { kind: "line"; from: XY; to: XY; length: number };
type ArcSegment = {
  kind: "arc";
  center: XY;
  radius: number;
  startAngle: number;
  endAngle: number;
  length: number;
};
type Segment = LineSegment | ArcSegment;

/**
 * Описание одной «фазы»-стороны индикатора. Каждая фаза состоит из
 * необязательного прямого участка и опциональной дуги-скругления в конце.
 */
interface PhaseSpan {
  segments: Segment[];
  totalLength: number;
}

interface IndicatorGeometry {
  path: SkPath;
  phases: PhaseSpan[];
}

function sampleSegment(segment: Segment, t: number): XY {
  const u = Math.max(0, Math.min(1, t));
  if (segment.kind === "line") {
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * u,
      y: segment.from.y + (segment.to.y - segment.from.y) * u,
    };
  }
  const angle = segment.startAngle + (segment.endAngle - segment.startAngle) * u;
  return {
    x: segment.center.x + segment.radius * Math.cos(angle),
    y: segment.center.y + segment.radius * Math.sin(angle),
  };
}

/** Семплирование точки внутри одной фазы по её прогрессу 0..1. */
function sampleInPhase(phase: PhaseSpan, phaseProgress: number): XY {
  const u = Math.max(0, Math.min(1, phaseProgress));
  let dLeft = u * phase.totalLength;
  for (const seg of phase.segments) {
    if (dLeft <= seg.length || seg === phase.segments[phase.segments.length - 1]) {
      return sampleSegment(seg, seg.length > 0 ? dLeft / seg.length : 0);
    }
    dLeft -= seg.length;
  }
  return { x: 0, y: 0 };
}

/** Построить geometry для линейного индикатора из 2 фаз (inhale ↑, exhale ↓). */
function buildLinearPhaseSpans(
  cx: number,
  bottomY: number,
  topY: number,
): PhaseSpan[] {
  const length = bottomY - topY;
  return [
    {
      segments: [
        { kind: "line", from: { x: cx, y: bottomY }, to: { x: cx, y: topY }, length },
      ],
      totalLength: length,
    },
    {
      segments: [
        { kind: "line", from: { x: cx, y: topY }, to: { x: cx, y: bottomY }, length },
      ],
      totalLength: length,
    },
  ];
}

function buildLinearPathWithSpans(
  cx: number,
  cy: number,
  halfLength: number,
): IndicatorGeometry {
  const topY = cy - halfLength;
  const bottomY = cy + halfLength;
  const path = Skia.Path.Make();
  path.moveTo(cx, bottomY);
  path.lineTo(cx, topY);
  return { path, phases: buildLinearPhaseSpans(cx, bottomY, topY) };
}

function buildSquareGeometry(width: number, height: number): IndicatorGeometry {
  const size = Math.min(width, height) * 0.9;
  const cx = width / 2;
  const cy = height / 2;
  const half = size / 2;
  // Менее круглые углы, чем раньше — чтобы совпадало с треугольником.
  const r = size * 0.04;
  const sideStraight = size - 2 * r;
  const arcLen = (Math.PI * r) / 2;

  // Вершины CW (на экране): BL, TL, TR, BR.
  const BL = { x: cx - half, y: cy + half };
  const TL = { x: cx - half, y: cy - half };
  const TR = { x: cx + half, y: cy - half };
  const BR = { x: cx + half, y: cy + half };

  // Центры скруглений углов.
  const cTL = { x: TL.x + r, y: TL.y + r };
  const cTR = { x: TR.x - r, y: TR.y + r };
  const cBR = { x: BR.x - r, y: BR.y - r };
  const cBL = { x: BL.x + r, y: BL.y - r };

  // Точки «входа/выхода» на прямых участках.
  const BL_top = { x: BL.x, y: BL.y - r };
  const TL_bottom = { x: TL.x, y: TL.y + r };
  const TL_right = { x: TL.x + r, y: TL.y };
  const TR_left = { x: TR.x - r, y: TR.y };
  const TR_bottom = { x: TR.x, y: TR.y + r };
  const BR_top = { x: BR.x, y: BR.y - r };
  const BR_left = { x: BR.x - r, y: BR.y };
  const BL_right = { x: BL.x + r, y: BL.y };

  const phases: PhaseSpan[] = [
    // phase 0: INHALE — снизу-слева вверх по левой стороне + скругление TL
    {
      segments: [
        { kind: "line", from: BL_top, to: TL_bottom, length: sideStraight },
        {
          kind: "arc",
          center: cTL,
          radius: r,
          startAngle: Math.PI, // левая сторона в угле TL
          endAngle: (3 * Math.PI) / 2, // верхняя сторона
          length: arcLen,
        },
      ],
      totalLength: sideStraight + arcLen,
    },
    // phase 1: HOLD — по верхней стороне + скругление TR
    {
      segments: [
        { kind: "line", from: TL_right, to: TR_left, length: sideStraight },
        {
          kind: "arc",
          center: cTR,
          radius: r,
          startAngle: (3 * Math.PI) / 2,
          endAngle: 2 * Math.PI,
          length: arcLen,
        },
      ],
      totalLength: sideStraight + arcLen,
    },
    // phase 2: EXHALE — правая сторона вниз + скругление BR
    {
      segments: [
        { kind: "line", from: TR_bottom, to: BR_top, length: sideStraight },
        {
          kind: "arc",
          center: cBR,
          radius: r,
          startAngle: 0,
          endAngle: Math.PI / 2,
          length: arcLen,
        },
      ],
      totalLength: sideStraight + arcLen,
    },
    // phase 3: HOLD — нижняя сторона + скругление BL
    {
      segments: [
        { kind: "line", from: BR_left, to: BL_right, length: sideStraight },
        {
          kind: "arc",
          center: cBL,
          radius: r,
          startAngle: Math.PI / 2,
          endAngle: Math.PI,
          length: arcLen,
        },
      ],
      totalLength: sideStraight + arcLen,
    },
  ];

  // Сам path рисуем из тех же прямых + дуг, по которым идёт sampling. Это гарантирует,
  // что блик всегда следует ровно по видимой линии (включая скругления углов).
  const path = Skia.Path.Make();
  const ARC_SUBDIVISIONS = 10;
  path.moveTo(BL_top.x, BL_top.y);
  for (const phase of phases) {
    const line = phase.segments[0] as LineSegment;
    const arc = phase.segments[1] as ArcSegment;
    path.lineTo(line.to.x, line.to.y);
    for (let k = 1; k <= ARC_SUBDIVISIONS; k += 1) {
      const t = k / ARC_SUBDIVISIONS;
      const a = arc.startAngle + (arc.endAngle - arc.startAngle) * t;
      path.lineTo(arc.center.x + arc.radius * Math.cos(a), arc.center.y + arc.radius * Math.sin(a));
    }
  }
  path.close();
  return { path, phases };
}

function buildTriangleGeometry(
  width: number,
  height: number,
  apex: "up" | "down",
): IndicatorGeometry {
  // Размер — чтобы основание ~0.9 от меньшей стороны экрана, т.е. «отступ как у квадрата».
  const minDim = Math.min(width, height);
  const R = (minDim * 0.9) / Math.sqrt(3); // радиус описанной окружности
  const cx = width / 2;
  const cy = height / 2;

  // Порядок вершин выбираем так, чтобы первая сторона была "вверх" (inhale):
  //  - apex up: [BL, TOP, BR] — side 0: BL → TOP (inhale, ↑), side 1: TOP → BR (exhale, ↓), side 2: BR → BL (hold, horiz).
  //  - apex down: [BOTTOM, TL, TR] — side 0: BOTTOM → TL (inhale, ↑), side 1: TL → TR (hold, horiz), side 2: TR → BOTTOM (exhale, ↓).
  const angles =
    apex === "up"
      ? [(5 * Math.PI) / 6, -Math.PI / 2, Math.PI / 6] // BL, TOP, BR
      : [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6]; // BOTTOM, TL, TR
  const vertices = angles.map((a) => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }));

  // Радиус скругляющей дуги. Точка касания с каждой стороной находится в
  // `touchDist = arcRadius · cot(α/2)` от вершины. Для равностороннего треугольника
  // внутренний угол α = 60°, значит `touchDist = arcRadius · √3`. Расстояние от вершины
  // до центра дуги = `arcRadius / sin(α/2) = 2 · arcRadius`.
  const arcRadius = R * 0.06;
  const touchDist = arcRadius * Math.sqrt(3);
  const centerDist = 2 * arcRadius;
  const sideLen = Math.hypot(
    vertices[1]!.x - vertices[0]!.x,
    vertices[1]!.y - vertices[0]!.y,
  );
  const sideStraight = Math.max(0, sideLen - 2 * touchDist);
  // Внешний угол при вершине (на который поворачивает путь) = π − α = 2π/3 для 60°.
  const arcSpan = (2 * Math.PI) / 3;
  const arcLen = arcRadius * arcSpan;

  const phases: PhaseSpan[] = [];
  const path = Skia.Path.Make();

  for (let i = 0; i < 3; i += 1) {
    const curr = vertices[i]!;
    const next = vertices[(i + 1) % 3]!;
    const nextNext = vertices[(i + 2) % 3]!;

    const toNextVertex = normalize({ x: next.x - curr.x, y: next.y - curr.y });
    // Точка на текущей стороне, с которой начинается ПРЯМАЯ часть (после выхода из arc
    // предыдущей вершины). В `r·√3` от `curr` по направлению к `next`.
    const straightFromCurr = {
      x: curr.x + toNextVertex.x * touchDist,
      y: curr.y + toNextVertex.y * touchDist,
    };
    // Точка на текущей стороне, где прямая часть заканчивается и начинается arc вершины `next`.
    const straightToNext = {
      x: next.x - toNextVertex.x * touchDist,
      y: next.y - toNextVertex.y * touchDist,
    };

    // Центр скругления вершины `next`: по биссектрисе внутрь треугольника на 2·arcRadius.
    const bisector = normalizedBisector(curr, next, nextNext);
    const arcCenter = {
      x: next.x + bisector.x * centerDist,
      y: next.y + bisector.y * centerDist,
    };

    // Точка «выхода» из arc на следующей стороне (начало её прямой части).
    const exitDir = normalize({ x: nextNext.x - next.x, y: nextNext.y - next.y });
    const arcExitPoint = {
      x: next.x + exitDir.x * touchDist,
      y: next.y + exitDir.y * touchDist,
    };

    // Углы дуги от arcCenter к touch-точкам. Короткий путь между ними по
    // `normalizeAngleRange` (≤ π по модулю) — это как раз вогнутая к вершине дуга, а
    // так как arcCenter лежит ВНУТРИ треугольника, дуга выгнута НАРУЖУ (к вершине),
    // что и даёт классическое скругление.
    const arcStartAngle = angleOf(straightToNext, arcCenter);
    const arcEndAngleRaw = angleOf(arcExitPoint, arcCenter);
    const arcEndAngle = normalizeAngleRange(arcStartAngle, arcEndAngleRaw);

    // Рисуем path: MoveTo на стартовой точке первой прямой, LineTo до straightToNext,
    // затем полилинейная аппроксимация дуги (те же arcCenter/arcRadius, что и у бегунка).
    if (i === 0) path.moveTo(straightFromCurr.x, straightFromCurr.y);
    path.lineTo(straightToNext.x, straightToNext.y);
    const ARC_SUBDIVISIONS = 14;
    for (let k = 1; k <= ARC_SUBDIVISIONS; k += 1) {
      const t = k / ARC_SUBDIVISIONS;
      const a = arcStartAngle + (arcEndAngle - arcStartAngle) * t;
      path.lineTo(arcCenter.x + arcRadius * Math.cos(a), arcCenter.y + arcRadius * Math.sin(a));
    }

    phases.push({
      segments: [
        {
          kind: "line",
          from: straightFromCurr,
          to: straightToNext,
          length: sideStraight,
        },
        {
          kind: "arc",
          center: arcCenter,
          radius: arcRadius,
          startAngle: arcStartAngle,
          endAngle: arcEndAngle,
          length: arcLen,
        },
      ],
      totalLength: sideStraight + arcLen,
    });
  }

  path.close();
  return { path, phases };
}

function normalize(v: XY): XY {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

/** Нормаль-биссектриса внутрь треугольника, направленная от вершины внутрь. */
function normalizedBisector(prev: XY, curr: XY, next: XY): XY {
  const a = normalize({ x: prev.x - curr.x, y: prev.y - curr.y });
  const b = normalize({ x: next.x - curr.x, y: next.y - curr.y });
  return normalize({ x: a.x + b.x, y: a.y + b.y });
}

function angleOf(point: XY, center: XY): number {
  return Math.atan2(point.y - center.y, point.x - center.x);
}

/**
 * Возвращает `end`, сдвинутый на целое число периодов 2π так, чтобы `|end − start| ≤ π`.
 * Это гарантирует кратчайшую дугу между двумя углами (короткая сторона окружности).
 * Для скруглений квадрата (90°) и треугольника (60°/120°) короткая дуга — это именно
 * та, которая «сглаживает» угол, проходя со стороны вершины.
 */
function normalizeAngleRange(start: number, end: number): number {
  let delta = end - start;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return start + delta;
}

// ─── Компонент-бубл (точка + трейл) ────────────────────────────────────────

const FADE_FALLBACK = 0.82;

/**
 * Минимальный интервал между применёнными тиками индикатора дыхания, мс (~30 FPS).
 *
 * `useFrameCallback` от Reanimated срабатывает на каждый кадр экрана (60 Hz, либо
 * 120 Hz на ProMotion). Каждый тик делает `runOnJS(setDot/setTrail)` → React
 * re-render Skia Canvas. 60-120 re-render'ов/сек при включённой камере и torch
 * приводит к нагреву и thermal throttling → индикатор начинает «прыгать».
 *
 * 30 FPS визуально неотличимо (человеческий глаз не воспринимает плавность блика
 * выше ~24-30 FPS), но нагрузка на JS-thread падает в 2-4 раза.
 */
const INDICATOR_MIN_TICK_INTERVAL_MS = 1000 / 30;

interface BubbleProps {
  color: string;
  position: XY | null;
  trail: { x: number; y: number; alpha: number }[];
  radius?: number;
}

function Bubble({ color, position, trail, radius = 3.5 }: BubbleProps) {
  if (!position) return null;
  return (
    <Group>
      {trail.map((t, idx) =>
        t.alpha > 0.04 ? (
          <Circle
            key={`trail-${idx}`}
            cx={t.x}
            cy={t.y}
            r={Math.max(1.5, radius - idx * 0.05)}
            color={color}
            opacity={Math.min(0.55, t.alpha * 0.55)}
          />
        ) : null,
      )}
      <Circle cx={position.x} cy={position.y} r={radius + 4} color={color} opacity={0.22} />
      <Circle cx={position.x} cy={position.y} r={radius + 1.5} color={color} opacity={0.6} />
      <Circle cx={position.x} cy={position.y} r={radius} color={color} />
    </Group>
  );
}

interface SingleBubbleTickerProps {
  phases: PhaseSpan[] | null;
  cycleStartMs: number | null;
  cycleMs: number | null;
  onPosition: (pos: XY | null) => void;
  /** Если передано: вместо авто-проигрывания plan-а отрисовываем «замерший» уровень 0..1 на phase 0. */
  frozenPhase?: 0 | 1;
  frozenLevel?: number;
}

function SingleBubbleTicker(props: SingleBubbleTickerProps) {
  const { phases, cycleStartMs, cycleMs, onPosition, frozenPhase, frozenLevel } = props;

  const phasesSv = useSharedValue<PhaseSpan[] | null>(null);
  const cycleMsSv = useSharedValue<number>(0);
  const startSv = useSharedValue<number>(0);
  const runningSv = useSharedValue<number>(0);

  useEffect(() => {
    phasesSv.value = phases;
  }, [phases, phasesSv]);
  useEffect(() => {
    if (cycleMs == null) {
      runningSv.value = 0;
      return;
    }
    cycleMsSv.value = cycleMs;
  }, [cycleMs, cycleMsSv, runningSv]);
  useEffect(() => {
    if (cycleStartMs == null) {
      runningSv.value = 0;
      return;
    }
    startSv.value = cycleStartMs;
    runningSv.value = 1;
  }, [cycleStartMs, runningSv, startSv]);

  const handleFramePhase = (phaseIdx: number, phaseU: number) => {
    const p = phasesSv.value;
    if (!p || p.length === 0) {
      onPosition(null);
      return;
    }
    const safeIdx = Math.max(0, Math.min(p.length - 1, phaseIdx));
    const phase = p[safeIdx]!;
    onPosition(sampleInPhase(phase, phaseU));
  };

  // Замороженный режим — для неактивных каналов в dual-bar (отображают последний уровень).
  useEffect(() => {
    if (frozenPhase == null || frozenLevel == null) return;
    const p = phases;
    if (!p || p.length === 0) {
      onPosition(null);
      return;
    }
    const idx = Math.min(p.length - 1, frozenPhase);
    onPosition(sampleInPhase(p[idx]!, Math.max(0, Math.min(1, frozenLevel))));
    // onPosition передаётся от родителя — может меняться; намеренно не в deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozenPhase, frozenLevel, phases]);

  const lastTickSv = useSharedValue(0);
  useFrameCallback(() => {
    "worklet";
    if (runningSv.value < 0.5) return;
    if (frozenPhase != null) return;
    const now = Date.now();
    if (now - lastTickSv.value < INDICATOR_MIN_TICK_INTERVAL_MS) return;
    lastTickSv.value = now;
    const p = phasesSv.value;
    if (!p || p.length === 0) return;
    const cycle = cycleMsSv.value;
    if (cycle <= 0) return;
    const t = Math.max(0, Math.min(cycle, now - startSv.value));
    const phaseDur = cycle / p.length;
    const phaseIdx = Math.min(p.length - 1, Math.floor(t / phaseDur));
    const tInPhase = t - phaseIdx * phaseDur;
    const uRaw = Math.max(0, Math.min(1, tInPhase / phaseDur));
    const u = easeTrapezoidalProgress(uRaw);
    runOnJS(handleFramePhase)(phaseIdx, u);
  });

  return null;
}

// ─── SingleBar (coherent) ─────────────────────────────────────────────────

function SingleBar({
  plannedCycle,
  cycleStartMs,
  bubbleColor,
  trailLength,
  width,
  height,
}: {
  plannedCycle: PlannedCycle | null;
  cycleStartMs: number | null;
  bubbleColor: string;
  trailLength: number;
  width: number;
  height: number;
}) {
  const theme = useTheme();
  const geometry = useMemo(() => {
    // Линию сдвигаем к правому краю — в то же место, где был старый rail-индикатор.
    const rightMargin = 24;
    const cx = width - rightMargin;
    const cy = height / 2;
    const halfLen = (Math.min(width, height) * 0.9) / 2;
    return buildLinearPathWithSpans(cx, cy, halfLen);
  }, [width, height]);

  const [dot, setDot] = useState<XY | null>(null);
  const [trail, setTrail] = useState(() => emptyTrail(trailLength));
  useEffect(() => setTrail(emptyTrail(trailLength)), [trailLength]);

  const pushPos = (pos: XY | null) => {
    setDot(pos);
    if (pos) pushTrail(pos, setTrail, trailLength);
  };

  if (width <= 0 || height <= 0) return null;
  const cycleMs = plannedCycle?.cycleMs ?? null;

  return (
    <View style={[styles.abs, { width, height }]} pointerEvents="none">
      <Canvas style={{ width, height }}>
        <Path
          path={geometry.path}
          style="stroke"
          strokeWidth={1}
          color={theme.colors.textFaint}
          opacity={0.55}
        />
        <Bubble color={bubbleColor} position={dot} trail={trail} />
      </Canvas>
      <SingleBubbleTicker
        phases={geometry.phases}
        cycleMs={cycleMs}
        cycleStartMs={cycleStartMs}
        onPosition={pushPos}
      />
    </View>
  );
}

// ─── DualBar (канальные практики) ────────────────────────────────────────────
//
// Рисуется ОДИН блик, движущийся по U-образному пути: две близкие вертикальные линии
// (левый и правый канал) + полукруг наверху, который их соединяет.
//
// Скорость движения по линии соответствует обычной bar-практике — 5 ударов вдох / 5
// ударов выдох. Полукруг проходится в начале очередного exhale как короткий «переход»
// между каналами; его длина мала относительно вертикали, поэтому визуально скорость
// выглядит равномерной. Блик один — дыхание одно.

/**
 * Геометрия для канального индикатора. Содержит прямые линии левого и правого канала,
 * полукруг между ними сверху (для alternating-дыхания) и «обратные» спаны для выдоха по
 * той же линии, на которой был вдох (для одноноздревого — Surya/Chandra).
 */
type DualChannelGeometry = {
  /** Путь, который рисуется на Canvas. Для alternating — с полукругом, для single — две прямые. */
  path: SkPath;
  /** Вдох по левой линии (низ → верх). */
  inhaleLeft: PhaseSpan;
  /** Вдох по правой линии. */
  inhaleRight: PhaseSpan;
  /** Выдох по левой линии (верх → низ), без полукруга — для Chandra Bhedana. */
  exhaleLeft: PhaseSpan;
  /** Выдох по правой линии (верх → низ), без полукруга — для Surya Bhedana. */
  exhaleRight: PhaseSpan;
  /** Выдох с переходом полукруг правая→левая + спуск по левой — для nadi shodhana. */
  exhaleRightToLeft: PhaseSpan;
  /** Выдох с переходом полукруг левая→правая + спуск по правой — для nadi shodhana. */
  exhaleLeftToRight: PhaseSpan;
};

function buildDualChannelGeometry(
  width: number,
  height: number,
  withTopArc: boolean,
): DualChannelGeometry {
  const lineHeight = Math.min(width, height) * 0.9;
  const cy = height / 2;
  const topY = cy - lineHeight / 2;
  const bottomY = cy + lineHeight / 2;
  // Сдвигаем к правому краю, как старый rail. Линии близко друг к другу.
  const rightMargin = 18;
  const gap = 10;
  const rightX = width - rightMargin;
  const leftX = rightX - gap;
  const arcRadius = gap / 2;
  const arcCenter = { x: leftX + arcRadius, y: topY };
  const arcLen = Math.PI * arcRadius;

  const lineLen = bottomY - topY;
  const inhaleLeft: PhaseSpan = {
    segments: [
      {
        kind: "line",
        from: { x: leftX, y: bottomY },
        to: { x: leftX, y: topY },
        length: lineLen,
      },
    ],
    totalLength: lineLen,
  };
  const inhaleRight: PhaseSpan = {
    segments: [
      {
        kind: "line",
        from: { x: rightX, y: bottomY },
        to: { x: rightX, y: topY },
        length: lineLen,
      },
    ],
    totalLength: lineLen,
  };
  // «Обратные» спаны для одноноздревых практик: выдох по той же линии, просто сверху вниз.
  const exhaleLeft: PhaseSpan = {
    segments: [
      {
        kind: "line",
        from: { x: leftX, y: topY },
        to: { x: leftX, y: bottomY },
        length: lineLen,
      },
    ],
    totalLength: lineLen,
  };
  const exhaleRight: PhaseSpan = {
    segments: [
      {
        kind: "line",
        from: { x: rightX, y: topY },
        to: { x: rightX, y: bottomY },
        length: lineLen,
      },
    ],
    totalLength: lineLen,
  };
  // Полукруг «правая→левая» идёт от верхней точки правой линии (angle=0 относительно
  // arcCenter) к верхней точке левой (angle=π) через верх (angle=π/2 в экранных координатах
  // означает низ, поэтому для дуги *вверх* используем угол -π/2). Чтобы дуга выгибалась
  // наружу экрана (вверх), разворачиваем её в противоположную сторону.
  const exhaleRightToLeft: PhaseSpan = {
    segments: [
      {
        kind: "arc",
        center: arcCenter,
        radius: arcRadius,
        startAngle: 0, // точка (rightX, topY)
        endAngle: -Math.PI, // точка (leftX, topY) через верх
        length: arcLen,
      },
      {
        kind: "line",
        from: { x: leftX, y: topY },
        to: { x: leftX, y: bottomY },
        length: lineLen,
      },
    ],
    totalLength: arcLen + lineLen,
  };
  const exhaleLeftToRight: PhaseSpan = {
    segments: [
      {
        kind: "arc",
        center: arcCenter,
        radius: arcRadius,
        startAngle: -Math.PI, // точка (leftX, topY)
        endAngle: 0, // точка (rightX, topY) через верх (если двигаться в обратную сторону — идём «вверх»)
        length: arcLen,
      },
      {
        kind: "line",
        from: { x: rightX, y: topY },
        to: { x: rightX, y: bottomY },
        length: lineLen,
      },
    ],
    totalLength: arcLen + lineLen,
  };

  // Рисуем путь. Для alternating-практик (nadi shodhana) — это три сегмента: left ↑, arc,
  // right ↓. Для одноноздревых (surya / chandra) — две независимые прямые без полукруга.
  const path = Skia.Path.Make();
  if (withTopArc) {
    const ARC_SUBDIVISIONS = 18;
    path.moveTo(leftX, bottomY);
    path.lineTo(leftX, topY);
    for (let k = 1; k <= ARC_SUBDIVISIONS; k += 1) {
      const t = k / ARC_SUBDIVISIONS;
      // Дуга из (leftX, topY) в (rightX, topY) через верх. y на экране растёт ВНИЗ,
      // поэтому для выгиба ВВЕРХ используем y = center.y - r*sin(a) (верхняя полуокружность).
      const a = Math.PI - Math.PI * t;
      const x = arcCenter.x + arcRadius * Math.cos(a);
      const y = arcCenter.y - arcRadius * Math.sin(a);
      path.lineTo(x, y);
    }
    path.lineTo(rightX, bottomY);
  } else {
    // Одноноздревое дыхание — две параллельные линии, соединения нет.
    path.moveTo(leftX, bottomY);
    path.lineTo(leftX, topY);
    path.moveTo(rightX, bottomY);
    path.lineTo(rightX, topY);
  }

  return {
    path,
    inhaleLeft,
    inhaleRight,
    exhaleLeft,
    exhaleRight,
    exhaleRightToLeft,
    exhaleLeftToRight,
  };
}

/**
 * Семплирование специально для верхнего полукруга U-пути: `y` инвертирован так, чтобы
 * дуга выгибалась вверх (как на экране). Используется только в DualBar.
 */
function sampleUpperArc(seg: ArcSegment, t: number): XY {
  const u = Math.max(0, Math.min(1, t));
  const angle = seg.startAngle + (seg.endAngle - seg.startAngle) * u;
  return {
    x: seg.center.x + seg.radius * Math.cos(angle),
    y: seg.center.y - seg.radius * Math.sin(Math.abs(angle)),
  };
}

/**
 * Семплирование U-фазы exhale: сначала верхний полукруг (arc), затем прямая линия вниз.
 * Прогресс `u` делится между ними пропорционально их длине, чтобы скорость блика была
 * равномерной.
 */
function sampleUPhase(phase: PhaseSpan, u: number): XY {
  const arc = phase.segments[0] as ArcSegment;
  const line = phase.segments[1] as LineSegment;
  const total = arc.length + line.length;
  const d = Math.max(0, Math.min(total, u * total));
  if (d <= arc.length) {
    return sampleUpperArc(arc, d / arc.length);
  }
  const lineT = (d - arc.length) / line.length;
  return {
    x: line.from.x + (line.to.x - line.from.x) * lineT,
    y: line.from.y + (line.to.y - line.from.y) * lineT,
  };
}

/**
 * Тип события в расписании блика: какую фазу проигрывать и в какой стороне.
 * `mode` говорит, какую из геометрических фаз использовать.
 */
type DualPhaseMode =
  | "inhale-left"
  | "inhale-right"
  | "exhale-left" // спуск по левой линии без перехода (Chandra Bhedana)
  | "exhale-right" // спуск по правой линии без перехода (Surya Bhedana)
  | "exhale-left-to-right" // полукруг L→R + спуск по правой (Nadi Shodhana)
  | "exhale-right-to-left" // полукруг R→L + спуск по левой (Nadi Shodhana)
  | "hold";

type DualPhaseSnap = {
  startMsInCycle: number;
  endMsInCycle: number;
  phaseMs: number;
  mode: DualPhaseMode;
};

type DualSchedule = {
  cycleMs: number;
  phases: DualPhaseSnap[];
  /** true если в плане хотя бы раз встречается переход между левой и правой сторонами. */
  hasChannelSwitching: boolean;
};

/**
 * Строим расписание фаз канального индикатора из `plannedCycle`.
 *
 *  - Если все фазы на одной стороне (одноноздревое дыхание: Surya / Chandra) →
 *    inhale тянет блик к верху, exhale возвращает к низу той же линии.
 *  - Если стороны чередуются (Nadi Shodhana) → exhale проходит сверху одной линии
 *    через полукруг к верху другой, затем спускается по ней.
 */
function buildDualSchedule(plannedCycle: PlannedCycle | null): DualSchedule | null {
  if (!plannedCycle) return null;

  // Сразу определяем: есть ли переключение между каналами в цикле?
  let hasSwitching = false;
  {
    let prevSide: "left" | "right" | null = null;
    for (const ph of plannedCycle.phases) {
      if (ph.kind !== "inhale" && ph.kind !== "exhale") continue;
      const ch = ph.channel ?? "both";
      const side = ch === "right" ? "right" : "left";
      if (prevSide != null && prevSide !== side) {
        hasSwitching = true;
        break;
      }
      prevSide = side;
    }
  }

  // Стабилизируем стартовую сторону: прогоняем цикл несколько раз.
  let cursorSide: "left" | "right" = "right";
  for (let iter = 0; iter < 4; iter += 1) {
    for (const ph of plannedCycle.phases) {
      if (ph.kind === "inhale" || ph.kind === "exhale") {
        const ch = ph.channel ?? "both";
        cursorSide = ch === "right" ? "right" : "left";
      }
    }
  }

  const phases: DualPhaseSnap[] = [];
  for (const ph of plannedCycle.phases) {
    const ch = ph.channel ?? "both";
    let mode: DualPhaseMode = "hold";
    if (ph.kind === "inhale") {
      const side = ch === "right" ? "right" : "left";
      mode = side === "right" ? "inhale-right" : "inhale-left";
      cursorSide = side;
    } else if (ph.kind === "exhale") {
      const target = ch === "right" ? "right" : "left";
      if (cursorSide === target || !hasSwitching) {
        // Одноноздревое дыхание или exhale на той же стороне — просто спуск по той же линии.
        mode = target === "right" ? "exhale-right" : "exhale-left";
      } else {
        // Смена канала — U-переход через полукруг.
        mode = target === "right" ? "exhale-left-to-right" : "exhale-right-to-left";
      }
      cursorSide = target;
    }
    phases.push({
      startMsInCycle: ph.startMsInCycle,
      endMsInCycle: ph.endMsInCycle,
      phaseMs: ph.phaseMs,
      mode,
    });
  }
  return { cycleMs: plannedCycle.cycleMs, phases, hasChannelSwitching: hasSwitching };
}

function DualBar({
  plannedCycle,
  cycleStartMs,
  bubbleColor,
  trailLength,
  width,
  height,
}: {
  plannedCycle: PlannedCycle | null;
  cycleStartMs: number | null;
  bubbleColor: string;
  trailLength: number;
  width: number;
  height: number;
}) {
  const theme = useTheme();
  const schedule = useMemo(() => buildDualSchedule(plannedCycle), [plannedCycle]);
  const withTopArc = schedule?.hasChannelSwitching ?? true;
  const geometry = useMemo(
    () => buildDualChannelGeometry(width, height, withTopArc),
    [width, height, withTopArc],
  );

  const [dot, setDot] = useState<XY | null>(null);
  const [trail, setTrail] = useState(() => emptyTrail(trailLength));
  useEffect(() => setTrail(emptyTrail(trailLength)), [trailLength]);

  const scheduleSv = useSharedValue<DualSchedule | null>(null);
  const startSv = useSharedValue(0);
  const runningSv = useSharedValue(0);

  useEffect(() => {
    scheduleSv.value = schedule;
  }, [schedule, scheduleSv]);
  useEffect(() => {
    if (!plannedCycle || cycleStartMs == null) {
      runningSv.value = 0;
      return;
    }
    startSv.value = cycleStartMs;
    runningSv.value = 1;
  }, [plannedCycle, cycleStartMs, runningSv, startSv]);

  /**
   * По моду и прогрессу `u` внутри фазы возвращает позицию блика на U-пути.
   * Для одноноздревых exhale-фаз (Surya / Chandra) — движение идёт «сверху вниз» по
   * активной линии, чтобы блик не делал лишнего перехода на другую сторону.
   */
  const samplePosition = (mode: DualPhaseMode, u: number): XY => {
    if (mode === "inhale-left") return sampleInPhase(geometry.inhaleLeft, u);
    if (mode === "inhale-right") return sampleInPhase(geometry.inhaleRight, u);
    if (mode === "exhale-left") return sampleInPhase(geometry.exhaleLeft, u);
    if (mode === "exhale-right") return sampleInPhase(geometry.exhaleRight, u);
    if (mode === "exhale-right-to-left") return sampleUPhase(geometry.exhaleRightToLeft, u);
    if (mode === "exhale-left-to-right") return sampleUPhase(geometry.exhaleLeftToRight, u);
    // hold — оставляем блик на месте (предыдущая позиция).
    return dot ?? sampleInPhase(geometry.inhaleLeft, 0);
  };

  const pushPos = (mode: DualPhaseMode, u: number) => {
    const pos = samplePosition(mode, u);
    setDot(pos);
    pushTrail(pos, setTrail, trailLength);
  };

  const lastTickSv = useSharedValue(0);
  useFrameCallback(() => {
    "worklet";
    if (runningSv.value < 0.5) return;
    const now = Date.now();
    if (now - lastTickSv.value < INDICATOR_MIN_TICK_INTERVAL_MS) return;
    lastTickSv.value = now;
    const snap = scheduleSv.value;
    if (!snap || snap.cycleMs <= 0) return;
    const t = Math.max(0, Math.min(snap.cycleMs, now - startSv.value));
    for (let i = 0; i < snap.phases.length; i += 1) {
      const phase = snap.phases[i]!;
      if (t < phase.endMsInCycle || i === snap.phases.length - 1) {
        const phaseDur = Math.max(1, phase.phaseMs);
        // Линейная скорость внутри фазы — иначе на границе U-перехода (arc → line)
        // получаются резкие замедления/разгоны.
        const u = Math.max(0, Math.min(1, (t - phase.startMsInCycle) / phaseDur));
        runOnJS(pushPos)(phase.mode, u);
        return;
      }
    }
  });

  if (width <= 0 || height <= 0) return null;

  return (
    <View style={[styles.abs, { width, height }]} pointerEvents="none">
      <Canvas style={{ width, height }}>
        <Path
          path={geometry.path}
          style="stroke"
          strokeWidth={1}
          color={theme.colors.textFaint}
          opacity={0.55}
        />
        <Bubble color={bubbleColor} position={dot} trail={trail} />
      </Canvas>
    </View>
  );
}

// ─── Path-based (square, triangles) ───────────────────────────────────────

/** Минимальный snapshot таймлайна фаз для path-based индикатора. */
type PathPhaseTimeline = {
  cycleMs: number;
  phases: { startMsInCycle: number; endMsInCycle: number; phaseMs: number }[];
};

function PathBasedIndicator({
  kind,
  plannedCycle,
  cycleStartMs,
  width,
  height,
  bubbleColor,
  trailLength,
}: {
  kind: "square" | "triangle-up" | "triangle-down";
  plannedCycle: PlannedCycle | null;
  cycleStartMs: number | null;
  width: number;
  height: number;
  bubbleColor: string;
  trailLength: number;
}) {
  const theme = useTheme();
  const geometry = useMemo(() => {
    if (kind === "square") return buildSquareGeometry(width, height);
    return buildTriangleGeometry(width, height, kind === "triangle-up" ? "up" : "down");
  }, [kind, width, height]);

  const [dot, setDot] = useState<XY | null>(null);
  const [trail, setTrail] = useState(() => emptyTrail(trailLength));
  useEffect(() => setTrail(emptyTrail(trailLength)), [trailLength]);

  const phasesSv = useSharedValue<PhaseSpan[] | null>(null);
  const scheduleSv = useSharedValue<PathPhaseTimeline | null>(null);

  useEffect(() => {
    phasesSv.value = geometry.phases;
  }, [geometry, phasesSv]);
  useEffect(() => {
    if (!plannedCycle) {
      scheduleSv.value = null;
      return;
    }
    scheduleSv.value = {
      cycleMs: plannedCycle.cycleMs,
      phases: plannedCycle.phases.map((p) => ({
        startMsInCycle: p.startMsInCycle,
        endMsInCycle: p.endMsInCycle,
        phaseMs: p.phaseMs,
      })),
    };
  }, [plannedCycle, scheduleSv]);

  const startSv = useSharedValue(0);
  const runningSv = useSharedValue(0);
  useEffect(() => {
    if (!plannedCycle || cycleStartMs == null) {
      runningSv.value = 0;
      setDot(null);
      setTrail(emptyTrail(trailLength));
      return;
    }
    startSv.value = cycleStartMs;
    runningSv.value = 1;
  }, [plannedCycle, cycleStartMs, runningSv, startSv, trailLength]);

  const pushDot = (phaseIdx: number, phaseU: number) => {
    const ph = phasesSv.value;
    if (!ph || ph.length === 0) return;
    const safeIdx = Math.max(0, Math.min(ph.length - 1, phaseIdx));
    const pos = sampleInPhase(ph[safeIdx]!, phaseU);
    setDot(pos);
    pushTrail(pos, setTrail, trailLength);
  };

  const lastTickSv = useSharedValue(0);
  useFrameCallback(() => {
    "worklet";
    if (runningSv.value < 0.5) return;
    const now = Date.now();
    if (now - lastTickSv.value < INDICATOR_MIN_TICK_INTERVAL_MS) return;
    lastTickSv.value = now;
    const schedule = scheduleSv.value;
    if (!schedule || schedule.cycleMs <= 0) return;
    const t = Math.max(0, Math.min(schedule.cycleMs, now - startSv.value));
    for (let i = 0; i < schedule.phases.length; i += 1) {
      const ph = schedule.phases[i]!;
      if (t < ph.endMsInCycle || i === schedule.phases.length - 1) {
        const phaseDur = Math.max(1, ph.phaseMs);
        // Для path-based индикаторов (square / triangle-up / triangle-down) движение
        // строго равномерное: blik идёт по периметру с постоянной скоростью внутри фазы.
        // Это убирает «подтормаживание» в конце каждой фазы / после скруглённого угла,
        // которое даёт `easeTrapezoidalProgress` (оно оставлено только для линейных
        // bar/dual-bar, где мягкое касание края физически оправдано).
        const u = Math.max(0, Math.min(1, (t - ph.startMsInCycle) / phaseDur));
        runOnJS(pushDot)(i, u);
        return;
      }
    }
  });

  if (width <= 0 || height <= 0) return null;

  return (
    <View style={[styles.abs, { width, height }]} pointerEvents="none">
      <Canvas style={{ width, height }}>
        <Path
          path={geometry.path}
          style="stroke"
          strokeWidth={0.7}
          strokeJoin="round"
          color={theme.colors.textFaint}
          opacity={0.28}
        />
        <Bubble color={bubbleColor} position={dot} trail={trail} />
      </Canvas>
    </View>
  );
}

// ─── Утилиты трейла ───────────────────────────────────────────────────────

function emptyTrail(length: number): { x: number; y: number; alpha: number }[] {
  return Array.from({ length }, () => ({ x: 0, y: 0, alpha: 0 }));
}

function pushTrail(
  pos: XY,
  setter: React.Dispatch<React.SetStateAction<{ x: number; y: number; alpha: number }[]>>,
  length: number,
) {
  setter((prev) => {
    const next = prev.map((p) => ({ x: p.x, y: p.y, alpha: p.alpha * FADE_FALLBACK }));
    if (next.length !== length) {
      while (next.length < length) next.push({ x: pos.x, y: pos.y, alpha: 0 });
      while (next.length > length) next.pop();
    }
    next.pop();
    next.unshift({ x: pos.x, y: pos.y, alpha: 1 });
    return next;
  });
}

// ─── Диспетчер ─────────────────────────────────────────────────────────────

/**
 * Длина трейла (количество кадров) одинаковая для всех индикаторов. Значение — то,
 * которое выбрали как оптимальное на тестах треугольника вершиной вверх (~3 диаметра).
 */
function resolveTrailLength(_kind: BreathIndicatorKind): number {
  return 22;
}

export function BreathIndicatorView({
  kind,
  plannedCycle,
  cycleStartMs,
  bubbleColor,
}: BreathIndicatorViewProps) {
  const theme = useTheme();
  const [layout, setLayout] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout((prev) =>
      Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width, height },
    );
  };
  const resolvedColor = bubbleColor ?? theme.colors.accent;
  const trailLength = resolveTrailLength(kind);

  return (
    <View style={styles.wrap} pointerEvents="none" onLayout={onLayout}>
      {kind === "bar" ? (
        <SingleBar
          plannedCycle={plannedCycle}
          cycleStartMs={cycleStartMs}
          bubbleColor={resolvedColor}
          trailLength={trailLength}
          width={layout.width}
          height={layout.height}
        />
      ) : null}
      {kind === "dual-bar" ? (
        <DualBar
          plannedCycle={plannedCycle}
          cycleStartMs={cycleStartMs}
          bubbleColor={resolvedColor}
          trailLength={trailLength}
          width={layout.width}
          height={layout.height}
        />
      ) : null}
      {kind === "square" || kind === "triangle-up" || kind === "triangle-down" ? (
        <PathBasedIndicator
          kind={kind}
          plannedCycle={plannedCycle}
          cycleStartMs={cycleStartMs}
          width={layout.width}
          height={layout.height}
          bubbleColor={resolvedColor}
          trailLength={trailLength}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
  },
  abs: {
    position: "absolute",
    left: 0,
    top: 0,
  },
});
