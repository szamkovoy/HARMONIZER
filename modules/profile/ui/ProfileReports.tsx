import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Polyline } from "react-native-svg";

import { DEFAULT_PERIOD_DAYS } from "@/modules/profile/core/periodPresets";
import { getProfileReportStrings } from "@/modules/profile/i18n/profile";
import { PeriodSelector } from "@/modules/profile/ui/PeriodSelector";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { loadLifeMatrixReport, loadPracticeByChakraReport, type LifeMatrixReport, type PracticeByChakraReport } from "@/services/profileReports";

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").trim();
  const safe = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const red = Number.parseInt(safe.slice(0, 2), 16);
  const green = Number.parseInt(safe.slice(2, 4), 16);
  const blue = Number.parseInt(safe.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function donutPath(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number) {
  const startOuter = polar(cx, cy, outerRadius, endAngle);
  const endOuter = polar(cx, cy, outerRadius, startAngle);
  const startInner = polar(cx, cy, innerRadius, startAngle);
  const endInner = polar(cx, cy, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

function HeatmapCard(props: { report: LifeMatrixReport; title: string; spheresLegendPrefix: string }) {
  const theme = useTheme();
  const rowLegend = props.report.chakras;
  const colLegend = props.report.spheres;

  return (
    <View style={styles.sectionCard}>
      <AppText variant="sectionTitle">{props.title}</AppText>
      <View style={styles.heatmapHeader}>
        <View style={styles.heatmapAxisSpacer} />
        {colLegend.map((sphere) => (
          <AppText key={sphere.id} variant="technicalCaption" tone="muted" style={styles.heatmapHeaderCell}>
            {sphere.id}
          </AppText>
        ))}
      </View>
      {props.report.visualMatrix.map((row, rowIndex) => {
        const chakra = rowLegend[rowIndex];
        return (
          <View key={chakra?.chakra ?? rowIndex} style={styles.heatmapRow}>
            <AppText variant="technicalCaption" tone="muted" style={styles.heatmapAxisLabel} numberOfLines={1}>
              {chakra?.shortLabel ?? rowIndex + 1}
            </AppText>
            {row.map((value, colIndex) => (
              <View
                key={`${rowIndex}-${colIndex}`}
                style={[
                  styles.heatmapCell,
                  {
                    backgroundColor: chakra ? hexToRgba(chakra.color, 0.12 + value * 0.88) : theme.colors.surfaceBorder,
                    borderColor: theme.colors.surfaceBorder,
                  },
                ]}
              />
            ))}
          </View>
        );
      })}
      <AppText variant="technicalCaption" tone="muted">
        {props.spheresLegendPrefix} {colLegend.map((item) => `${item.id}.${item.title}`).join(" · ")}
      </AppText>
    </View>
  );
}

function TrendCard(props: {
  report: LifeMatrixReport;
  title: string;
  groupedTrendPrefix: string;
  groupedTrendEmpty: string;
}) {
  const theme = useTheme();
  const values = props.report.trend.map((item) => item.rangeMetric).filter((item): item is number => item != null);
  const width = 320;
  const height = 120;
  const padding = 10;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(0.0001, max - min);
  const points = props.report.trend
    .map((item, index) => {
      if (item.rangeMetric == null) return null;
      const x = padding + (index * (width - padding * 2)) / Math.max(1, props.report.trend.length - 1);
      const y = height - padding - ((item.rangeMetric - min) / span) * (height - padding * 2);
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(" ");

  return (
    <View style={styles.sectionCard}>
      <AppText variant="sectionTitle">{props.title}</AppText>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path
          d={`M ${padding} ${height - padding} L ${width - padding} ${height - padding}`}
          stroke={theme.colors.surfaceBorder}
          strokeWidth={1}
        />
        {points ? <Polyline points={points} fill="none" stroke={theme.colors.accent} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" /> : null}
      </Svg>
      <AppText variant="technicalCaption" tone="muted">
        {props.groupedTrendPrefix}{" "}
        {props.report.groupedTrend.map((item) => item.toFixed(2)).join(" · ") || props.groupedTrendEmpty}
      </AppText>
    </View>
  );
}

function PracticePieCard(props: { report: PracticeByChakraReport; title: string; emptyMessage: string }) {
  const theme = useTheme();
  const total = Math.max(0, props.report.totalDurationSec);
  const sortedStats = [...props.report.chakraStats].sort((a, b) => {
    if (a.durationSec > 0 && b.durationSec === 0) return -1;
    if (a.durationSec === 0 && b.durationSec > 0) return 1;
    if (a.durationSec !== b.durationSec) return b.durationSec - a.durationSec;
    return a.chakra - b.chakra;
  });
  let angle = 0;

  return (
    <View style={styles.sectionCard}>
      <AppText variant="sectionTitle">{props.title}</AppText>
      {total > 0 ? (
        <Svg width="100%" height={180} viewBox="0 0 220 180">
          {sortedStats
            .filter((item) => item.durationSec > 0)
            .map((item) => {
              const startAngle = angle;
              angle += (item.durationSec / total) * 360;
              return (
                <Path
                  key={item.chakra}
                  d={donutPath(110, 90, 72, 42, startAngle, angle)}
                  fill={item.color}
                  stroke={theme.colors.screenBg}
                  strokeWidth={2}
                />
              );
            })}
          <Circle cx={110} cy={90} r={28} fill={theme.colors.surface} />
        </Svg>
      ) : null}
      <View style={styles.legendList}>
        {sortedStats.map((item) => {
          const isZero = item.durationSec <= 0;
          return (
            <View key={item.chakra} style={styles.legendRow}>
              <View
                style={[
                  styles.legendSwatch,
                  {
                    backgroundColor: isZero ? theme.colors.surfaceBorder : item.color,
                  },
                ]}
              />
              <AppText variant="technicalCaption" tone={isZero ? "faint" : undefined} style={styles.legendLabel}>
                {item.label}
              </AppText>
              <AppText variant="technicalCaption" tone={isZero ? "faint" : "muted"}>
                {formatDurationClock(item.durationSec)}
              </AppText>
            </View>
          );
        })}
      </View>
      {total <= 0 ? (
        <AppText variant="dialogBody" tone="muted">
          {props.emptyMessage}
        </AppText>
      ) : null}
    </View>
  );
}

function LifeMatrixBlock(props: { enabled: boolean; strings: ReturnType<typeof getProfileReportStrings> }) {
  const [periodDays, setPeriodDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const [report, setReport] = useState<LifeMatrixReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!props.enabled) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await loadLifeMatrixReport(periodDays));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить отчёт.");
    } finally {
      setLoading(false);
    }
  }, [periodDays, props.enabled]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  if (!props.enabled) return null;

  return (
    <View style={styles.block}>
      <PeriodSelector value={periodDays} onChange={setPeriodDays} />
      {loading ? (
        <AppText variant="dialogBody" tone="muted">
          {props.strings.reportsLoading}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="dialogBody" tone="muted">
          {error}
        </AppText>
      ) : null}
      {report && !loading && !error ? (
        <>
          <HeatmapCard report={report} title={props.strings.lifeMatrixTitle} spheresLegendPrefix={props.strings.spheresLegendPrefix} />
          <TrendCard
            report={report}
            title={props.strings.rangeTrendTitle}
            groupedTrendPrefix={props.strings.groupedTrendPrefix}
            groupedTrendEmpty={props.strings.groupedTrendEmpty}
          />
        </>
      ) : null}
    </View>
  );
}

function PracticeByChakraBlock(props: { enabled: boolean; strings: ReturnType<typeof getProfileReportStrings> }) {
  const [periodDays, setPeriodDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const [report, setReport] = useState<PracticeByChakraReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!props.enabled) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await loadPracticeByChakraReport(periodDays));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить отчёт.");
    } finally {
      setLoading(false);
    }
  }, [periodDays, props.enabled]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  if (!props.enabled) return null;

  return (
    <View style={styles.block}>
      <PeriodSelector value={periodDays} onChange={setPeriodDays} />
      {loading ? (
        <AppText variant="dialogBody" tone="muted">
          {props.strings.reportsLoading}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="dialogBody" tone="muted">
          {error}
        </AppText>
      ) : null}
      {report && !loading && !error ? (
        <PracticePieCard report={report} title={props.strings.practiceByChakraTitle} emptyMessage={props.strings.practicePieEmpty} />
      ) : null}
    </View>
  );
}

export function ProfileReports(props: { enabled: boolean; onUpgrade: () => void; locale?: "ru" | "en" }) {
  const theme = useTheme();
  const strings = getProfileReportStrings(props.locale ?? "ru");

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
      <View style={styles.headerCopy}>
        <AppText variant="sectionTitle">{strings.reportsTitle}</AppText>
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsHint}
        </AppText>
      </View>

      {!props.enabled ? (
        <View style={styles.sectionCard}>
          <AppText variant="dialogBody" tone="muted">
            {strings.reportsUpgradeHint}
          </AppText>
          <AppButton label={strings.openTiersButton} onPress={props.onUpgrade} />
        </View>
      ) : (
        <>
          <LifeMatrixBlock enabled={props.enabled} strings={strings} />
          <PracticeByChakraBlock enabled={props.enabled} strings={strings} />
        </>
      )}
    </View>
  );
}

const HEATMAP_LABEL_WIDTH = 108;
const HEATMAP_CELL_SIZE = 18;

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 16,
    padding: 16,
  },
  headerCopy: {
    gap: 6,
  },
  block: {
    gap: 12,
  },
  sectionCard: {
    gap: 10,
  },
  heatmapHeader: {
    flexDirection: "row",
    gap: 4,
    paddingLeft: HEATMAP_LABEL_WIDTH + 4,
  },
  heatmapAxisSpacer: {
    width: 0,
  },
  heatmapHeaderCell: {
    textAlign: "center",
    width: HEATMAP_CELL_SIZE,
  },
  heatmapRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  heatmapAxisLabel: {
    width: HEATMAP_LABEL_WIDTH,
  },
  heatmapCell: {
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    height: HEATMAP_CELL_SIZE,
    width: HEATMAP_CELL_SIZE,
  },
  legendList: {
    gap: 8,
  },
  legendRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  legendSwatch: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  legendLabel: {
    flex: 1,
  },
});
