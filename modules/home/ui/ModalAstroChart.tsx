import { Modal, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PLANETS_7, type NatalProfile, type Planet } from "@/modules/astro-core";
import type { AspectType, DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FullScreenModalScaffold } from "@/modules/ui/FullScreenModalScaffold";
import { ScreenSection } from "@/modules/ui/ScreenSection";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";
import { AstroChartSVG, type AstroChartAspect } from "./AstroChartSVG";

interface ModalAstroChartProps {
  visible: boolean;
  onClose: () => void;
  natalProfile: NatalProfile;
  forecast?: DailyForecast;
  aspects?: AstroChartAspect[];
  strings: Pick<HomeStrings, "planetLabels" | "closeButton" | "opportunityWindows" | "astroChartModal">;
  /** Вложенный второй Modal на RN иногда не открывается — используйте overlay внутри родительского Modal. */
  presentation?: "modal" | "nestedOverlay";
}

const ASPECT_TYPES: readonly AspectType[] = ["conjunction", "opposition", "square", "trine", "sextile"];

function isAspectType(value: string): value is AspectType {
  return (ASPECT_TYPES as readonly string[]).includes(value);
}

function formatAspectLine(
  aspect: AstroChartAspect,
  strings: ModalAstroChartProps["strings"],
): string {
  const from = strings.planetLabels[aspect.from as Planet] ?? aspect.from;
  const to = strings.planetLabels[aspect.to as Planet] ?? aspect.to;
  const aspectLabel = isAspectType(aspect.type)
    ? strings.opportunityWindows.aspectLabels[aspect.type]
    : aspect.type;
  const orb =
    typeof aspect.orb === "number"
      ? `${strings.astroChartModal.orbPrefix}${aspect.orb.toFixed(1)}°`
      : "";
  return `${from} ${aspectLabel} ${strings.astroChartModal.toNatalConnector} ${to}${orb}`;
}

export default function ModalAstroChart({
  visible,
  onClose,
  natalProfile,
  forecast,
  aspects,
  strings,
  presentation = "modal",
}: ModalAstroChartProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const chartSize = Math.min(380, Math.max(280, width - 40));
  const showHouses = natalProfile.precisionMode === "precise" && Boolean(natalProfile.houseCusps?.length);
  const chartCopy = strings.astroChartModal;

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
      title={forecast ? chartCopy.titleTransit : chartCopy.titleNatal}
      subtitle={chartCopy.subtitle}
      closeLabel={strings.closeButton}
      onClose={onClose}
      style={shellStyle}
    >
      <ScrollView
        style={presentation === "nestedOverlay" ? { flex: 1 } : undefined}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <SurfaceCardView tone="elevated" style={styles.chartCard}>
          <AstroChartSVG
            natalProfile={natalProfile}
            transitPositions={forecast?.transitChart.planets}
            aspects={aspects}
            showHouses={showHouses}
            size={chartSize}
          />
          {!showHouses ? (
            <AppText variant="technicalCaption" tone="muted" style={styles.centerText}>
              {chartCopy.housesHiddenHint}
            </AppText>
          ) : null}
        </SurfaceCardView>

        {aspects?.length ? (
          <ScreenSection title={chartCopy.mainAspectsTitle} style={styles.section}>
            {aspects.slice(0, 8).map((aspect) => (
              <AppText key={`${aspect.from}-${aspect.to}-${aspect.type}`} variant="screenHint" tone="muted">
                {formatAspectLine(aspect, strings)}
              </AppText>
            ))}
          </ScreenSection>
        ) : null}

        <ScreenSection title={chartCopy.planetStrengthsTitle} style={styles.section}>
          {PLANETS_7.map((planet) => (
            <AppText key={planet} variant="screenHint" tone="muted">
              {strings.planetLabels[planet]}: S = {natalProfile.planets[planet].S_initial.toFixed(2)}, H ={" "}
              {natalProfile.planets[planet].H_initial.toFixed(2)}
            </AppText>
          ))}
        </ScreenSection>
      </ScrollView>
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
    alignItems: "center",
    gap: 16,
    padding: 20,
  },
  chartCard: {
    alignItems: "center",
    gap: 10,
    padding: 12,
    width: "100%",
  },
  centerText: {
    textAlign: "center",
  },
  section: {
    width: "100%",
  },
});
