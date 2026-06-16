import { Modal, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PLANETS_7, type NatalProfile, type Planet } from "@/modules/astro-core";
import type { AspectType, DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
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
      : [styles.root, { backgroundColor: theme.colors.screenBg }];

  const inner = (
    <View style={[shellStyle, { paddingTop: insets.top + 12 }]}>
      <View style={[styles.header, { borderBottomColor: theme.colors.surfaceBorder }]}>
        <View style={styles.headerText}>
          <AppText variant="sectionTitle">
            {forecast ? chartCopy.titleTransit : chartCopy.titleNatal}
          </AppText>
          <AppText variant="technicalCaption" tone="muted">
            {chartCopy.subtitle}
          </AppText>
        </View>
        <AppButton label={strings.closeButton} variant="secondary" onPress={onClose} style={styles.closeButton} />
      </View>

      <ScrollView
        style={presentation === "nestedOverlay" ? { flex: 1 } : undefined}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <View style={[styles.chartCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
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
        </View>

        {aspects?.length ? (
          <View style={[styles.section, { borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="sectionTitle">{chartCopy.mainAspectsTitle}</AppText>
            {aspects.slice(0, 8).map((aspect) => (
              <AppText key={`${aspect.from}-${aspect.to}-${aspect.type}`} variant="screenHint" tone="muted">
                {formatAspectLine(aspect, strings)}
              </AppText>
            ))}
          </View>
        ) : null}

        <View style={[styles.section, { borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">{chartCopy.planetStrengthsTitle}</AppText>
          {PLANETS_7.map((planet) => (
            <AppText key={planet} variant="screenHint" tone="muted">
              {strings.planetLabels[planet]}: S = {natalProfile.planets[planet].S_initial.toFixed(2)}, H ={" "}
              {natalProfile.planets[planet].H_initial.toFixed(2)}
            </AppText>
          ))}
        </View>
      </ScrollView>
    </View>
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
  root: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingHorizontal: 18,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  closeButton: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  content: {
    alignItems: "center",
    gap: 16,
    padding: 20,
  },
  chartCard: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 12,
    width: "100%",
  },
  centerText: {
    textAlign: "center",
  },
  section: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 14,
    width: "100%",
  },
});
