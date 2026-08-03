/**
 * Ghost preview charts for empty Profile report cards.
 * Transparent canvas, muted chakra palette, no labels — illustration, not data.
 */
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { CHAKRA_SEGMENT_COLORS } from "@/modules/charts/constants";

/** On-screen size of the preview (layout box for centering the empty-copy). */
export const REPORT_PREVIEW_DISPLAY_SIZE = 220;

const VIEW = 400;

export type ReportPreviewKind =
  | "bars"
  | "donutChakra"
  | "donutSpheres"
  | "donutStates"
  | "matrix"
  | "line";

/** Practice-by-chakra-ish mix. */
const DONUT_A = [22, 18, 15, 12, 14, 10, 9];
/** Life-spheres-ish mix. */
const DONUT_B = [28, 8, 20, 6, 16, 12, 10];
/** Life-states-ish mix. */
const DONUT_C = [14, 22, 10, 18, 9, 15, 12];

const BAR_HEIGHTS = [0.38, 0.72, 0.45, 0.9, 0.58, 0.32, 0.78];

/** 7×7 heatmap intensities 0..1 (row-major). */
const MATRIX: number[] = [
  0.15, 0.35, 0.55, 0.25, 0.7, 0.4, 0.2, 0.45, 0.8, 0.3, 0.6, 0.2, 0.5, 0.35, 0.25, 0.55, 0.4, 0.75,
  0.3, 0.65, 0.45, 0.7, 0.2, 0.5, 0.85, 0.35, 0.55, 0.25, 0.4, 0.6, 0.3, 0.7, 0.45, 0.2, 0.5, 0.35,
  0.55, 0.25, 0.65, 0.4, 0.8, 0.3, 0.5, 0.35, 0.2, 0.6, 0.45, 0.7, 0.25,
];

/** Blend hex color toward gray so previews read as illustrations. */
function muteHex(hex: string, towardGray = 0.55): string {
  const raw = hex.replace("#", "");
  const n = parseInt(raw.length === 3 ? raw.replace(/(.)/g, "$1$1") : raw, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const gray = 152;
  const mix = (c: number) => Math.round(c * (1 - towardGray) + gray * towardGray);
  const to = (c: number) => mix(c).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const MUTED_CHAKRA = CHAKRA_SEGMENT_COLORS.map((c) => muteHex(c, 0.58));
const MUTED_ACCENT = muteHex("#11B6B7", 0.5);

function polar(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function donutSlicePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  const large = end - start > Math.PI ? 1 : 0;
  const p0 = polar(cx, cy, rOuter, start);
  const p1 = polar(cx, cy, rOuter, end);
  const p2 = polar(cx, cy, rInner, end);
  const p3 = polar(cx, cy, rInner, start);
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${p3.x} ${p3.y}`,
    "Z",
  ].join(" ");
}

function DonutPreview({ weights }: { weights: number[] }) {
  const cx = 200;
  const cy = 200;
  const rOuter = 145;
  const rInner = 88;
  const gap = 0.045;
  const total = weights.reduce((a, b) => a + b, 0);
  let angle = -Math.PI / 2;
  const slices = weights.map((w, i) => {
    const sweep = (w / total) * Math.PI * 2 - gap;
    const start = angle + gap / 2;
    const end = start + Math.max(0.02, sweep);
    angle += (w / total) * Math.PI * 2;
    return { d: donutSlicePath(cx, cy, rOuter, rInner, start, end), color: MUTED_CHAKRA[i]! };
  });

  return (
    <Svg width={REPORT_PREVIEW_DISPLAY_SIZE} height={REPORT_PREVIEW_DISPLAY_SIZE} viewBox={`0 0 ${VIEW} ${VIEW}`}>
      <Circle
        cx={cx}
        cy={cy}
        r={(rOuter + rInner) / 2}
        stroke="rgba(128,128,128,0.16)"
        strokeWidth={rOuter - rInner}
        fill="none"
      />
      {slices.map((s, i) => (
        <Path key={i} d={s.d} fill={s.color} fillOpacity={0.75} />
      ))}
    </Svg>
  );
}

function BarsPreview() {
  const baseY = 340;
  const chartH = 240;
  const barW = 34;
  const gap = 14;
  const startX = 42;
  return (
    <Svg width={REPORT_PREVIEW_DISPLAY_SIZE} height={REPORT_PREVIEW_DISPLAY_SIZE} viewBox={`0 0 ${VIEW} ${VIEW}`}>
      <Path
        d={`M 28 ${baseY} H 372`}
        stroke="rgba(128,128,128,0.28)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      {BAR_HEIGHTS.map((h, i) => {
        const bh = h * chartH;
        const x = startX + i * (barW + gap);
        const y = baseY - bh;
        return (
          <Rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={bh}
            rx={8}
            fill={MUTED_CHAKRA[i]!}
            fillOpacity={0.75}
          />
        );
      })}
    </Svg>
  );
}

function MatrixPreview() {
  const origin = 52;
  const cell = 42;
  const gap = 6;
  return (
    <Svg width={REPORT_PREVIEW_DISPLAY_SIZE} height={REPORT_PREVIEW_DISPLAY_SIZE} viewBox={`0 0 ${VIEW} ${VIEW}`}>
      {MATRIX.map((intensity, i) => {
        const row = Math.floor(i / 7);
        const col = i % 7;
        const color = MUTED_CHAKRA[row]!;
        const opacity = 0.12 + intensity * 0.45;
        return (
          <Rect
            key={i}
            x={origin + col * (cell + gap)}
            y={origin + row * (cell + gap)}
            width={cell}
            height={cell}
            rx={8}
            fill={color}
            opacity={opacity}
          />
        );
      })}
    </Svg>
  );
}

function LinePreview() {
  const points = [
    [40, 280],
    [90, 250],
    [140, 220],
    [190, 190],
    [240, 160],
    [290, 145],
    [340, 110],
    [360, 95],
  ] as const;
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const area = `${d} L 360 340 L 40 340 Z`;
  return (
    <Svg width={REPORT_PREVIEW_DISPLAY_SIZE} height={REPORT_PREVIEW_DISPLAY_SIZE} viewBox={`0 0 ${VIEW} ${VIEW}`}>
      <Path d={area} fill={MUTED_ACCENT} fillOpacity={0.12} />
      <Path
        d={d}
        stroke={MUTED_ACCENT}
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.7}
        fill="none"
      />
      {points.map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={7} fill={MUTED_ACCENT} fillOpacity={0.7} />
      ))}
    </Svg>
  );
}

export function ReportPreviewChart({ kind }: { kind: ReportPreviewKind }) {
  let chart: ReactNode;
  switch (kind) {
    case "bars":
      chart = <BarsPreview />;
      break;
    case "donutChakra":
      chart = <DonutPreview weights={DONUT_A} />;
      break;
    case "donutSpheres":
      chart = <DonutPreview weights={DONUT_B} />;
      break;
    case "donutStates":
      chart = <DonutPreview weights={DONUT_C} />;
      break;
    case "matrix":
      chart = <MatrixPreview />;
      break;
    case "line":
      chart = <LinePreview />;
      break;
  }
  return <View style={styles.wrap}>{chart}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    height: REPORT_PREVIEW_DISPLAY_SIZE,
    justifyContent: "center",
    width: REPORT_PREVIEW_DISPLAY_SIZE,
  },
});
