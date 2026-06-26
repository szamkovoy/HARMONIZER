import { Suspense, lazy, useMemo } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { NatalProfile } from "@/modules/astro-core";
import type { DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import type { AccessMode } from "@/services/globalContentClient";
import { AppButton } from "@/modules/ui/AppButton";
import { FullScreenModalScaffold } from "@/modules/ui/FullScreenModalScaffold";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";
import { MarkdownText } from "./MarkdownText";
import { ModalMathLevel, chartAspectsFromMathLevel } from "./ModalMathLevel";
import { SlideUpModalLayer } from "./SlideUpModalLayer";

const ModalAstroChart = lazy(() => import("./ModalAstroChart"));

export type HomeExplainerLevel = "none" | "long" | "math" | "chart";

interface ModalLongExplanationProps {
  level: HomeExplainerLevel;
  onClose: () => void;
  onOpenMath: () => void;
  onOpenChart: () => void;
  longExplanation: string;
  canOpenMath: boolean;
  strings: HomeStrings["longExplanationModal"];
  mathLevel?: DailyForecast["mathLevel"] | null;
  natalProfile?: NatalProfile | null;
  forecast?: DailyForecast | null;
  accessMode?: AccessMode;
  mathStrings?: HomeStrings["mathModal"];
  chartStrings?: Pick<HomeStrings, "planetLabels" | "closeButton" | "opportunityWindows" | "astroChartModal">;
}

export function ModalLongExplanation({
  level,
  onClose,
  onOpenMath,
  onOpenChart,
  longExplanation,
  canOpenMath,
  strings,
  mathLevel,
  natalProfile,
  forecast,
  accessMode = "premium",
  mathStrings,
  chartStrings,
}: ModalLongExplanationProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const visible = level !== "none";
  const showMathLayer = level === "math" || level === "chart";
  const showChartLayer = level === "chart";
  const isGlobalForecast = accessMode === "free" || Boolean(forecast?.isGlobal);
  const hasTransitChart = Boolean(forecast?.transitChart?.planets);
  const canShowChart = isGlobalForecast ? hasTransitChart : Boolean(natalProfile && hasTransitChart);
  const aspects = useMemo(() => chartAspectsFromMathLevel(mathLevel), [mathLevel]);

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      <FullScreenModalScaffold
        title={strings.title}
        subtitle={strings.subtitle}
        closeLabel={strings.closeButton}
        onClose={onClose}
      >
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <SurfaceCardView tone="elevated" style={styles.card}>
            <MarkdownText source={longExplanation} />
          </SurfaceCardView>

          <AppButton
            label={strings.mathButton}
            variant="secondary"
            onPress={onOpenMath}
            disabled={!canOpenMath}
            accessibilityLabel={strings.mathButtonA11y}
          />
        </ScrollView>
      </FullScreenModalScaffold>

      {showMathLayer && mathStrings && chartStrings ? (
        <SlideUpModalLayer zIndex={100}>
          <ModalMathLevel
            visible
            onClose={onClose}
            onOpenChart={canShowChart ? onOpenChart : undefined}
            mathLevel={mathLevel}
            natalProfile={natalProfile}
            forecast={forecast}
            accessMode={accessMode}
            strings={mathStrings}
            presentation="stackLayer"
          />
        </SlideUpModalLayer>
      ) : null}

      {showChartLayer && chartStrings && canShowChart ? (
        <SlideUpModalLayer zIndex={200}>
          <Suspense fallback={<ActivityIndicator color={theme.colors.accent} style={styles.loader} />}>
            <ModalAstroChart
              visible
              onClose={onClose}
              natalProfile={natalProfile ?? undefined}
              transitPositions={forecast?.transitChart?.planets}
              forecast={forecast ?? undefined}
              aspects={aspects}
              strings={chartStrings}
              presentation="stackLayer"
              mode={isGlobalForecast ? "transit_only" : "natal_transit"}
            />
          </Suspense>
        </SlideUpModalLayer>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 20,
  },
  card: {
    padding: 18,
  },
  loader: {
    flex: 1,
    justifyContent: "center",
  },
});
