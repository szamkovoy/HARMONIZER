import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Polyline } from "react-native-svg";

import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { loadLifeMatrixReport, loadPracticeByChakraReport, type LifeMatrixReport, type PracticeByChakraReport } from "@/services/profileReports";

const INTERVALS = [7, 30, 90] as const;

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

function formatMinutes(totalSeconds: number): string {
  return `${Math.max(0, Math.round(totalSeconds / 60))} мин`;
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

function IntervalSwitcher(props: { value: number; onChange: (value: number) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.intervalRow}>
      {INTERVALS.map((days) => {
        const selected = props.value === days;
        return (
          <Pressable
            key={days}
            onPress={() => props.onChange(days)}
            style={[
              styles.intervalButton,
              {
                backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceElevated,
                borderColor: selected ? theme.colors.accent : theme.colors.surfaceBorder,
              },
            ]}
          >
            <AppText variant="technicalCaption" tone={selected ? "accentOn" : "muted"}>
              {days}д
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function HeatmapCard(props: { report: LifeMatrixReport }) {
  const theme = useTheme();
  const rowLegend = props.report.chakras;
  const colLegend = props.report.spheres;

  return (
    <View style={styles.sectionCard}>
      <AppText variant="sectionTitle">Life Matrix</AppText>
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
            <AppText variant="technicalCaption" tone="muted" style={styles.heatmapAxisLabel}>
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
        Сферы: {colLegend.map((item) => `${item.id}.${item.title}`).join(" · ")}
      </AppText>
    </View>
  );
}

function TrendCard(props: { report: LifeMatrixReport }) {
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
      <AppText variant="sectionTitle">Range Trend</AppText>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path
          d={`M ${padding} ${height - padding} L ${width - padding} ${height - padding}`}
          stroke={theme.colors.surfaceBorder}
          strokeWidth={1}
        />
        {points ? <Polyline points={points} fill="none" stroke={theme.colors.accent} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" /> : null}
      </Svg>
      <AppText variant="technicalCaption" tone="muted">
        Сгруппированный ряд: {props.report.groupedTrend.map((item) => item.toFixed(2)).join(" · ") || "пока пусто"}
      </AppText>
    </View>
  );
}

function PracticePieCard(props: { report: PracticeByChakraReport }) {
  const theme = useTheme();
  const total = Math.max(0, props.report.totalDurationSec);
  let angle = 0;

  return (
    <View style={styles.sectionCard}>
      <AppText variant="sectionTitle">Практики по чакрам</AppText>
      {total > 0 ? (
        <>
          <Svg width="100%" height={180} viewBox="0 0 220 180">
            {props.report.chakraStats
              .filter((item) => item.durationSec > 0)
              .map((item) => {
                const startAngle = angle;
                const sweep = (item.durationSec / total) * 360;
                angle += sweep;
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
            {props.report.chakraStats
              .filter((item) => item.durationSec > 0)
              .sort((a, b) => b.durationSec - a.durationSec)
              .map((item) => (
                <View key={item.chakra} style={styles.legendRow}>
                  <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
                  <AppText variant="technicalCaption" style={styles.legendLabel}>
                    {item.label}
                  </AppText>
                  <AppText variant="technicalCaption" tone="muted">
                    {formatMinutes(item.durationSec)}
                  </AppText>
                </View>
              ))}
          </View>
        </>
      ) : (
        <AppText variant="dialogBody" tone="muted">
          За выбранный интервал пока нет завершённых практик с фокусом по чакрам.
        </AppText>
      )}
    </View>
  );
}

export function ProfileReports(props: { enabled: boolean; onUpgrade: () => void }) {
  const theme = useTheme();
  const [intervalDays, setIntervalDays] = useState<number>(30);
  const [lifeMatrix, setLifeMatrix] = useState<LifeMatrixReport | null>(null);
  const [practiceByChakra, setPracticeByChakra] = useState<PracticeByChakraReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    if (!props.enabled) {
      setLifeMatrix(null);
      setPracticeByChakra(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [lifeMatrixReport, practiceReport] = await Promise.all([
        loadLifeMatrixReport(intervalDays),
        loadPracticeByChakraReport(intervalDays),
      ]);
      setLifeMatrix(lifeMatrixReport);
      setPracticeByChakra(practiceReport);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить отчёты.");
    } finally {
      setLoading(false);
    }
  }, [intervalDays, props.enabled]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const showEmpty = useMemo(() => !loading && !error && props.enabled && lifeMatrix && practiceByChakra, [error, lifeMatrix, loading, practiceByChakra, props.enabled]);

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <AppText variant="sectionTitle">Отчёты</AppText>
          <AppText variant="dialogBody" tone="muted">
            Матрица прожитого дня, range-тренд и распределение практик по чакрам.
          </AppText>
        </View>
        <AppButton label="Обновить" variant="secondary" onPress={loadReports} disabled={loading || !props.enabled} style={styles.refreshButton} />
      </View>

      <IntervalSwitcher value={intervalDays} onChange={setIntervalDays} />

      {!props.enabled ? (
        <View style={styles.sectionCard}>
          <AppText variant="dialogBody" tone="muted">
            Отчёты доступны на тарифах Практик и Мастер.
          </AppText>
          <AppButton label="Открыть тарифы" onPress={props.onUpgrade} />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.sectionCard}>
          <AppText variant="dialogBody" tone="muted">
            Загружаем отчёты...
          </AppText>
        </View>
      ) : null}

      {error ? (
        <View style={styles.sectionCard}>
          <AppText variant="dialogBody" tone="muted">
            {error}
          </AppText>
        </View>
      ) : null}

      {showEmpty && lifeMatrix && practiceByChakra ? (
        <>
          <HeatmapCard report={lifeMatrix} />
          <TrendCard report={lifeMatrix} />
          <PracticePieCard report={practiceByChakra} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 16,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  intervalRow: {
    flexDirection: "row",
    gap: 8,
  },
  intervalButton: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sectionCard: {
    gap: 10,
  },
  heatmapHeader: {
    flexDirection: "row",
    gap: 6,
    paddingLeft: 34,
  },
  heatmapAxisSpacer: {
    width: 2,
  },
  heatmapHeaderCell: {
    textAlign: "center",
    width: 22,
  },
  heatmapRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  heatmapAxisLabel: {
    width: 28,
  },
  heatmapCell: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    height: 22,
    width: 22,
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
