import { Suspense, lazy, useMemo, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { NatalProfile, Planet } from "@/modules/astro-core";
import type { AspectType, DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import type { AccessMode } from "@/services/globalContentClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FullScreenModalScaffold } from "@/modules/ui/FullScreenModalScaffold";
import { ScreenSection } from "@/modules/ui/ScreenSection";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";
import { MarkdownText } from "./MarkdownText";
import type { AstroChartAspect } from "./AstroChartSVG";

const ModalAstroChart = lazy(() => import("./ModalAstroChart"));

interface ModalMathLevelProps {
  visible: boolean;
  onClose: () => void;
  mathLevel?: DailyForecast["mathLevel"] | null;
  natalProfile?: NatalProfile | null;
  forecast?: DailyForecast | null;
  accessMode: AccessMode;
  strings: HomeStrings["mathModal"];
  chartStrings: Pick<HomeStrings, "planetLabels" | "closeButton" | "opportunityWindows" | "astroChartModal">;
  /** Вложенный второй Modal на RN иногда не открывается — используйте overlay внутри родительского Modal. */
  presentation?: "modal" | "nestedOverlay";
}

const PLANETS: readonly Planet[] = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const ASPECTS: readonly AspectType[] = ["conjunction", "opposition", "square", "trine", "sextile"];

function isPlanet(value: unknown): value is Planet {
  return typeof value === "string" && (PLANETS as readonly string[]).includes(value);
}

function isAspect(value: unknown): value is AspectType {
  return typeof value === "string" && (ASPECTS as readonly string[]).includes(value);
}

function chartAspects(mathLevel: DailyForecast["mathLevel"] | null | undefined): AstroChartAspect[] {
  const structured = mathLevel?.structured;
  if (!structured || typeof structured !== "object") return [];
  const raw = (structured as { main_aspects?: unknown }).main_aspects;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AstroChartAspect[] => {
    const aspect = item as { from?: unknown; to?: unknown; type?: unknown; orb?: unknown };
    if (!isPlanet(aspect.from) || !isPlanet(aspect.to) || typeof aspect.type !== "string") return [];
    return [
      {
        from: aspect.from,
        to: aspect.to,
        type: isAspect(aspect.type) ? aspect.type : aspect.type,
        orb: typeof aspect.orb === "number" ? aspect.orb : undefined,
      },
    ];
  });
}

export function ModalMathLevel({
  visible,
  onClose,
  mathLevel,
  natalProfile,
  forecast,
  accessMode,
  strings,
  chartStrings,
  presentation = "modal",
}: ModalMathLevelProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [showChart, setShowChart] = useState(false);
  const aspects = useMemo(() => chartAspects(mathLevel), [mathLevel]);
  const isGlobalForecast = accessMode === "free" || Boolean(forecast?.isGlobal);
  const hasTransitChart = Boolean(forecast?.transitChart?.planets);
  const canShowChart = isGlobalForecast ? hasTransitChart : Boolean(natalProfile && hasTransitChart);
  const chartButtonLabel = isGlobalForecast ? strings.showTransitChartButton : strings.showChartButton;

  if (presentation === "nestedOverlay" && !visible) return null;

  const shellStyle: StyleProp<ViewStyle> =
    presentation === "nestedOverlay"
      ? [
          StyleSheet.absoluteFillObject,
          { zIndex: 100, elevation: 24, backgroundColor: theme.colors.screenBg, flex: 1 },
        ]
      : [{ flex: 1, backgroundColor: theme.colors.screenBg }];

  const inner = (
    <FullScreenModalScaffold
      title={strings.title}
      subtitle={strings.subtitle}
      closeLabel={strings.closeButton}
      onClose={onClose}
      style={shellStyle}
    >
      <ScrollView
        style={presentation === "nestedOverlay" ? { flex: 1 } : undefined}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <SurfaceCardView tone="elevated" style={styles.card}>
          {mathLevel?.markdown ? (
            <MarkdownText source={mathLevel.markdown} />
          ) : (
            <AppText variant="screenHint" tone="muted">
              {strings.emptyHint}
            </AppText>
          )}
        </SurfaceCardView>

        {canShowChart ? (
          <AppButton label={chartButtonLabel} variant="secondary" onPress={() => setShowChart(true)} />
        ) : (
          <ScreenSection title={chartButtonLabel} subtitle={strings.chartUnavailableHint} centerHeader>
            <View />
          </ScreenSection>
        )}
      </ScrollView>

      {showChart && canShowChart ? (
        <Suspense fallback={<ActivityIndicator color={theme.colors.accent} style={styles.loader} />}>
          <ModalAstroChart
            visible={showChart}
            onClose={() => {
              setShowChart(false);
              onClose();
            }}
            natalProfile={natalProfile ?? undefined}
            transitPositions={forecast?.transitChart?.planets}
            forecast={forecast ?? undefined}
            aspects={aspects}
            strings={chartStrings}
            presentation="nestedOverlay"
            mode={isGlobalForecast ? "transit_only" : "natal_transit"}
          />
        </Suspense>
      ) : null}
    </FullScreenModalScaffold>
  );

  if (presentation === "nestedOverlay") {
    return inner;
  }

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      {inner}
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 20,
  },
  card: {
    padding: 18,
  },
  centerText: {
    textAlign: "center",
  },
  loader: {
    bottom: 24,
    position: "absolute",
    right: 24,
  },
});
