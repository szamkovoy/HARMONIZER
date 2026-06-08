import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { DEFAULT_PERIOD_DAYS } from "@/modules/profile/core/periodPresets";
import { getProfileReportStrings } from "@/modules/profile/i18n/profile";
import { PeriodSelector } from "@/modules/profile/ui/PeriodSelector";
import { ProfileEmptyState } from "@/modules/profile/ui/ProfileEmptyState";
import { ProfileReportCard } from "@/modules/profile/ui/ProfileReportCard";
import { RangeTrendChart } from "@/modules/profile/ui/RangeTrendChart";
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

const CHAKRA_NUMERIC_LABELS_RU = [
  "Первая чакра",
  "Вторая чакра",
  "Третья чакра",
  "Четвертая чакра",
  "Пятая чакра",
  "Шестая чакра",
  "Седьмая чакра",
] as const;

function capitalizeFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function LifeMatrixHeatmap(props: { report: LifeMatrixReport; spheresLegendPrefix: string }) {
  const theme = useTheme();
  const rowLegend = props.report.chakras;
  const colLegend = props.report.spheres;

  return (
    <View style={styles.heatmapBlock}>
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
              {capitalizeFirst(chakra?.shortLabel ?? String(rowIndex + 1))}
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
        {props.spheresLegendPrefix} {colLegend.map((item) => `${item.id}. ${item.title};`).join(" ")}
      </AppText>
    </View>
  );
}

function MatrixProjectionChart(props: {
  items: NonNullable<LifeMatrixReport["sphereProjection"]>;
}) {
  const theme = useTheme();
  const total = Math.max(0, props.items.reduce((sum, item) => sum + Math.max(0, item.value), 0));
  let angle = 0;
  return (
    <View style={styles.projectionBlock}>
      {total > 0 ? (
        <Svg width="100%" height={190} viewBox="0 0 220 190">
          {props.items
            .filter((item) => item.value > 0)
            .map((item) => {
              const startAngle = angle;
              angle += (item.value / total) * 360;
              return (
                <Path
                  key={item.id}
                  d={donutPath(110, 90, 72, 42, startAngle, angle)}
                  fill={item.color ?? theme.colors.accent}
                  stroke={theme.colors.screenBg}
                  strokeWidth={2}
                />
              );
            })}
          <Circle cx={110} cy={90} r={28} fill={theme.colors.surface} />
        </Svg>
      ) : null}
      <View style={styles.legendList}>
        {props.items.map((item) => {
          const isZero = item.value <= 0;
          return (
            <View key={item.id} style={styles.legendRow}>
              <View
                style={[
                  styles.legendSwatch,
                  {
                    backgroundColor: isZero ? theme.colors.surfaceBorder : item.color ?? theme.colors.accent,
                  },
                ]}
              />
              <AppText variant="technicalCaption" tone={isZero ? "faint" : "muted"} style={styles.legendLabel}>
                {capitalizeFirst(item.label)}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ProjectionReportContent(props: {
  items?: NonNullable<LifeMatrixReport["sphereProjection"]>;
  loading: boolean;
  error: string | null;
  matrixReady: boolean;
  emptyMessage: string;
}) {
  if (props.loading) {
    return (
      <AppText variant="dialogBody" tone="muted">
        Загрузка...
      </AppText>
    );
  }
  if (props.error) {
    return (
      <AppText variant="dialogBody" tone="muted">
        {props.error}
      </AppText>
    );
  }
  if (!props.matrixReady || !props.items?.length) {
    return <ProfileEmptyState message={props.emptyMessage} />;
  }
  return <MatrixProjectionChart items={props.items} />;
}

export function useLifeMatrixReport(enabled: boolean) {
  const [report, setReport] = useState<LifeMatrixReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!enabled) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await loadLifeMatrixReport());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить отчёт.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return { report, loading, error };
}

export function PracticeByChakraReportCard(props: { enabled: boolean; onUpgrade: () => void; locale?: "ru" | "en" }) {
  const strings = getProfileReportStrings(props.locale ?? "ru");
  const [periodDays, setPeriodDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const [report, setReport] = useState<PracticeByChakraReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme();

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

  if (!props.enabled) {
    return (
      <ProfileReportCard title={strings.practiceByChakraTitle}>
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsUpgradeHint}
        </AppText>
        <AppButton label={strings.openTiersButton} onPress={props.onUpgrade} />
      </ProfileReportCard>
    );
  }

  const sortedStats = report ? [...report.chakraStats].sort((a, b) => a.chakra - b.chakra) : [];
  const total = Math.max(0, report?.totalDurationSec ?? 0);
  let angle = 0;

  return (
    <ProfileReportCard
      title={strings.practiceByChakraTitle}
      periodSelector={<PeriodSelector value={periodDays} onChange={setPeriodDays} />}
    >
      {loading ? (
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsLoading}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="dialogBody" tone="muted">
          {error}
        </AppText>
      ) : null}
      {!loading && !error && report ? (
        total > 0 ? (
          <>
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
            <View style={styles.legendList}>
              {sortedStats.map((item) => {
                const isZero = item.durationSec <= 0;
                return (
                  <View key={item.chakra} style={styles.legendRow}>
                    <View
                      style={[
                        styles.legendSwatch,
                        { backgroundColor: isZero ? theme.colors.surfaceBorder : item.color },
                      ]}
                    />
                    <AppText variant="technicalCaption" tone={isZero ? "faint" : "muted"} style={styles.legendLabel}>
                      {CHAKRA_NUMERIC_LABELS_RU[item.chakra - 1] ?? item.label}
                    </AppText>
                    <AppText variant="technicalCaption" tone={isZero ? "faint" : "muted"}>
                      {formatDurationClock(item.durationSec)}
                    </AppText>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <ProfileEmptyState message={strings.practicesNotDone} />
        )
      ) : null}
    </ProfileReportCard>
  );
}

export function LifeMatrixReportCard(props: {
  enabled: boolean;
  onUpgrade: () => void;
  report: LifeMatrixReport | null;
  loading: boolean;
  error: string | null;
  locale?: "ru" | "en";
}) {
  const strings = getProfileReportStrings(props.locale ?? "ru");

  if (!props.enabled) {
    return (
      <ProfileReportCard title={strings.lifeMatrixTitle}>
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsUpgradeHint}
        </AppText>
        <AppButton label={strings.openTiersButton} onPress={props.onUpgrade} />
      </ProfileReportCard>
    );
  }

  const showMatrix = props.report?.matrixReady ?? false;

  return (
    <ProfileReportCard title={strings.lifeMatrixTitle} subtitle={strings.lifeMatrixHint}>
      {props.loading ? (
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsLoading}
        </AppText>
      ) : null}
      {props.error ? (
        <AppText variant="dialogBody" tone="muted">
          {props.error}
        </AppText>
      ) : null}
      {!props.loading && !props.error && props.report ? (
        showMatrix ? (
          <LifeMatrixHeatmap report={props.report} spheresLegendPrefix={strings.spheresLegendPrefix} />
        ) : (
          <ProfileEmptyState message={strings.matrixNotReady} />
        )
      ) : null}
    </ProfileReportCard>
  );
}

export function LifeSpheresReportCard(props: {
  enabled: boolean;
  onUpgrade: () => void;
  report: LifeMatrixReport | null;
  loading: boolean;
  error: string | null;
  locale?: "ru" | "en";
}) {
  const strings = getProfileReportStrings(props.locale ?? "ru");
  if (!props.enabled) {
    return (
      <ProfileReportCard title={strings.lifeSpheresTitle}>
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsUpgradeHint}
        </AppText>
        <AppButton label={strings.openTiersButton} onPress={props.onUpgrade} />
      </ProfileReportCard>
    );
  }
  return (
    <ProfileReportCard title={strings.lifeSpheresTitle} subtitle={strings.lifeSpheresHint}>
      <ProjectionReportContent
        loading={props.loading}
        error={props.error}
        matrixReady={props.report?.matrixReady ?? false}
        items={props.report?.sphereProjection}
        emptyMessage={strings.matrixNotReady}
      />
    </ProfileReportCard>
  );
}

export function LifeStatesReportCard(props: {
  enabled: boolean;
  onUpgrade: () => void;
  report: LifeMatrixReport | null;
  loading: boolean;
  error: string | null;
  locale?: "ru" | "en";
}) {
  const strings = getProfileReportStrings(props.locale ?? "ru");
  if (!props.enabled) {
    return (
      <ProfileReportCard title={strings.lifeStatesTitle}>
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsUpgradeHint}
        </AppText>
        <AppButton label={strings.openTiersButton} onPress={props.onUpgrade} />
      </ProfileReportCard>
    );
  }
  return (
    <ProfileReportCard title={strings.lifeStatesTitle} subtitle={strings.lifeStatesHint}>
      <ProjectionReportContent
        loading={props.loading}
        error={props.error}
        matrixReady={props.report?.matrixReady ?? false}
        items={props.report?.stateProjection}
        emptyMessage={strings.matrixNotReady}
      />
    </ProfileReportCard>
  );
}

export function RangeTrendReportCard(props: {
  enabled: boolean;
  onUpgrade: () => void;
  report: LifeMatrixReport | null;
  loading: boolean;
  error: string | null;
  locale?: "ru" | "en";
}) {
  const strings = getProfileReportStrings(props.locale ?? "ru");

  if (!props.enabled) {
    return (
      <ProfileReportCard title={strings.rangeTrendTitle}>
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsUpgradeHint}
        </AppText>
        <AppButton label={strings.openTiersButton} onPress={props.onUpgrade} />
      </ProfileReportCard>
    );
  }

  const trendReady = props.report?.trendReady ?? false;
  const trendPoints = props.report?.calendarTrend ?? [];
  return (
    <ProfileReportCard title={strings.rangeTrendTitle} subtitle={strings.rangeTrendHint}>
      {props.loading ? (
        <AppText variant="dialogBody" tone="muted">
          {strings.reportsLoading}
        </AppText>
      ) : null}
      {props.error ? (
        <AppText variant="dialogBody" tone="muted">
          {props.error}
        </AppText>
      ) : null}
      {!props.loading && !props.error && props.report ? (
        trendReady && trendPoints.length > 0 ? (
          <RangeTrendChart points={trendPoints} />
        ) : (
          <ProfileEmptyState message={strings.matrixNotReady} />
        )
      ) : null}
    </ProfileReportCard>
  );
}

const HEATMAP_LABEL_WIDTH = 108;
const HEATMAP_CELL_SIZE = 18;

const styles = StyleSheet.create({
  heatmapBlock: {
    gap: 4,
  },
  projectionBlock: {
    gap: 10,
    alignItems: "stretch",
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
    gap: 3,
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
