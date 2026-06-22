import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { chakraNumericDisplayLabel, chakraShortLabelDisplay } from "@/modules/chakra/i18n";
import {
  CHAKRA_SEGMENT_COLORS,
  DonutChart,
  type DonutSegmentInput,
} from "@/modules/charts";
import { localizeLifeSphereLabel } from "@/modules/life-spheres/labels";
import { DEFAULT_PERIOD_DAYS } from "@/modules/profile/core/periodPresets";
import { getProfileReportStrings } from "@/modules/profile/i18n/profile";
import { PeriodSelector } from "@/modules/profile/ui/PeriodSelector";
import { ProfileEmptyState } from "@/modules/profile/ui/ProfileEmptyState";
import { ProfileReportCard } from "@/modules/profile/ui/ProfileReportCard";
import { RangeTrendChart } from "@/modules/profile/ui/RangeTrendChart";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { getUserErrorStrings } from "@/modules/ui/i18n/userErrors";
import { useTheme } from "@/modules/ui/theme";
import { loadLifeMatrixReport, loadPracticeByChakraReport, type LifeMatrixReport, type PracticeByChakraReport } from "@/services/profileReports";
import { logErrorForDevelopers, resolveUserFacingMessage } from "@/services/userFacingErrors";

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

function capitalizeFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function chakraRowLabel(chakraNumber: number | undefined, shortLabel: string | undefined, locale: AppContentLocale): string {
  if (chakraNumber && chakraNumber >= 1 && chakraNumber <= 7) {
    return chakraNumericDisplayLabel(locale, chakraNumber);
  }
  return capitalizeFirst(shortLabel ?? "");
}

function LifeMatrixHeatmap(props: { report: LifeMatrixReport; spheresLegendPrefix: string; locale: AppContentLocale }) {
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
              {chakraRowLabel(chakra?.chakra, chakra?.shortLabel, props.locale)}
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
        {props.spheresLegendPrefix}{" "}
        {colLegend.map((item) => `${item.id}. ${localizeLifeSphereLabel(item.id, item.title, props.locale)};`).join(" ")}
      </AppText>
    </View>
  );
}

function projectionItemLabel(item: { id: number; label: string }, locale: AppContentLocale, kind: "sphere" | "state"): string {
  if (kind === "state") return chakraShortLabelDisplay(locale, item.id);
  return capitalizeFirst(localizeLifeSphereLabel(item.id, item.label, locale));
}

function projectionToDonutSegments(
  items: NonNullable<LifeMatrixReport["sphereProjection"]>,
  locale: AppContentLocale,
  kind: "sphere" | "state",
): DonutSegmentInput[] {
  return items.map((item) => ({
    id: item.id,
    value: item.value,
    color: item.color ?? CHAKRA_SEGMENT_COLORS[item.id - 1] ?? CHAKRA_SEGMENT_COLORS[0],
    label: projectionItemLabel(item, locale, kind),
  }));
}

function MatrixProjectionChart(props: {
  items: NonNullable<LifeMatrixReport["sphereProjection"]>;
  locale: AppContentLocale;
  kind: "sphere" | "state";
}) {
  const segments = projectionToDonutSegments(props.items, props.locale, props.kind);
  const total = Math.max(0, props.items.reduce((sum, item) => sum + Math.max(0, item.value), 0));
  if (total <= 0) return null;
  return (
    <DonutChart
      segments={segments}
      locale={props.locale}
      animationKey={segments.map((item) => `${item.id}:${item.value}`).join("|")}
    />
  );
}

function ReportLoadError(props: { message: string; onRetry?: () => void; retryLabel: string }) {
  return (
    <View style={styles.errorBlock}>
      <AppText variant="screenHint" tone="muted">
        {props.message}
      </AppText>
      {props.onRetry ? <AppButton label={props.retryLabel} variant="secondary" onPress={props.onRetry} /> : null}
    </View>
  );
}

function ProjectionReportContent(props: {
  items?: NonNullable<LifeMatrixReport["sphereProjection"]>;
  loading: boolean;
  error: string | null;
  matrixReady: boolean;
  emptyMessage: string;
  locale: AppContentLocale;
  loadingMessage: string;
  loadErrorMessage: string;
  retryLabel: string;
  onRetry?: () => void;
  kind: "sphere" | "state";
}) {
  if (props.loading) {
    return (
      <AppText variant="screenHint" tone="muted">
        {props.loadingMessage}
      </AppText>
    );
  }
  if (props.error) {
    return (
      <ReportLoadError
        message={props.error || props.loadErrorMessage}
        onRetry={props.onRetry}
        retryLabel={props.retryLabel}
      />
    );
  }
  if (!props.matrixReady || !props.items?.length) {
    return <ProfileEmptyState message={props.emptyMessage} />;
  }
  return <MatrixProjectionChart items={props.items} locale={props.locale} kind={props.kind} />;
}

export function useLifeMatrixReport(enabled: boolean, locale: AppContentLocale = "ru") {
  const strings = getProfileReportStrings(locale);
  const userErrors = getUserErrorStrings(locale);
  const [report, setReport] = useState<LifeMatrixReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!enabled) {
      setReport(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await loadLifeMatrixReport());
    } catch (loadError) {
      logErrorForDevelopers("profile-life-matrix", loadError);
      setError(resolveUserFacingMessage(loadError, locale, { genericMessage: strings.reportLoadError }));
    } finally {
      setLoading(false);
    }
  }, [enabled, locale, strings.reportLoadError]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return { report, loading, error, reload: loadReport, retryLabel: userErrors.retryButton };
}

export function PracticeByChakraReportCard(props: { enabled: boolean; onUpgrade: () => void; locale?: AppContentLocale }) {
  const strings = getProfileReportStrings(props.locale ?? "ru");
  const userErrors = getUserErrorStrings(props.locale ?? "ru");
  const locale = props.locale ?? "ru";
  const [periodDays, setPeriodDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const [report, setReport] = useState<PracticeByChakraReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!props.enabled) {
      setReport(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await loadPracticeByChakraReport(periodDays));
    } catch (loadError) {
      logErrorForDevelopers("profile-practice-by-chakra", loadError);
      setError(resolveUserFacingMessage(loadError, locale, { genericMessage: strings.reportLoadError }));
    } finally {
      setLoading(false);
    }
  }, [locale, periodDays, props.enabled, strings.reportLoadError]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handlePeriodChange = useCallback((days: number) => {
    if (days === periodDays) return;
    setLoading(true);
    setPeriodDays(days);
  }, [periodDays]);

  const sortedStats = useMemo(
    () => (report ? [...report.chakraStats].sort((a, b) => a.chakra - b.chakra) : []),
    [report],
  );
  const total = Math.max(0, report?.totalDurationSec ?? 0);
  const practiceSegments = useMemo(
    (): DonutSegmentInput[] =>
      sortedStats.map((item) => ({
        id: item.chakra,
        value: item.durationSec,
        color: item.color,
        label: chakraNumericDisplayLabel(locale, item.chakra),
        legendSuffix: formatDurationClock(item.durationSec),
      })),
    [locale, sortedStats],
  );
  const practiceAnimationKey = useMemo(() => {
    if (loading) {
      return `period:${periodDays}|loading`;
    }
    const next = practiceSegments.map((item) => `${item.id}:${item.value}`).join("|");
    return `period:${periodDays}|${next}`;
  }, [loading, periodDays, practiceSegments]);

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

  return (
    <ProfileReportCard
      title={strings.practiceByChakraTitle}
      periodSelector={<PeriodSelector value={periodDays} onChange={handlePeriodChange} locale={props.locale ?? "ru"} />}
    >
      {loading && !report ? (
        <AppText variant="screenHint" tone="muted">
          {strings.reportsLoading}
        </AppText>
      ) : null}
      {error ? (
        <ReportLoadError
          message={error}
          onRetry={() => void loadReport()}
          retryLabel={userErrors.retryButton}
        />
      ) : null}
      {!error && report ? (
        total > 0 ? (
          <DonutChart
            segments={practiceSegments}
            locale={locale}
            animationKey={practiceAnimationKey}
            revealMode="inViewport"
            hideVisualization={loading}
          />
        ) : !loading ? (
          <ProfileEmptyState message={strings.practicesNotDone} />
        ) : null
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
  locale?: AppContentLocale;
  onRetry?: () => void;
  retryLabel?: string;
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
        <AppText variant="screenHint" tone="muted">
          {strings.reportsLoading}
        </AppText>
      ) : null}
      {props.error ? (
        <ReportLoadError
          message={props.error}
          onRetry={props.onRetry}
          retryLabel={props.retryLabel ?? "Retry"}
        />
      ) : null}
      {!props.loading && !props.error && props.report ? (
        showMatrix ? (
          <LifeMatrixHeatmap
            report={props.report}
            spheresLegendPrefix={strings.spheresLegendPrefix}
            locale={props.locale ?? "ru"}
          />
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
  locale?: AppContentLocale;
  onRetry?: () => void;
  retryLabel?: string;
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
        locale={props.locale ?? "ru"}
        loadingMessage={strings.projectionLoading}
        loadErrorMessage={strings.reportLoadError}
        retryLabel={props.retryLabel ?? "Retry"}
        onRetry={props.onRetry}
        kind="sphere"
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
  locale?: AppContentLocale;
  onRetry?: () => void;
  retryLabel?: string;
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
        locale={props.locale ?? "ru"}
        loadingMessage={strings.projectionLoading}
        loadErrorMessage={strings.reportLoadError}
        retryLabel={props.retryLabel ?? "Retry"}
        onRetry={props.onRetry}
        kind="state"
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
  locale?: AppContentLocale;
  onRetry?: () => void;
  retryLabel?: string;
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
        <AppText variant="screenHint" tone="muted">
          {strings.reportsLoading}
        </AppText>
      ) : null}
      {props.error ? (
        <ReportLoadError
          message={props.error}
          onRetry={props.onRetry}
          retryLabel={props.retryLabel ?? "Retry"}
        />
      ) : null}
      {!props.loading && !props.error && props.report ? (
        trendReady && trendPoints.length > 0 ? (
          <RangeTrendChart points={trendPoints} locale={props.locale ?? "ru"} />
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
  errorBlock: {
    gap: 10,
  },
  heatmapBlock: {
    gap: 4,
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
});
