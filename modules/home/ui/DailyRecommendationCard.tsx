import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { NatalProfile } from "@/modules/astro-core";
import type { DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { getForecastRecommendation } from "@/modules/home/i18n/home";
import { getPlanetChakraMap } from "@/modules/home/planetChakra";
import type { AccessMode } from "@/services/globalContentClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { ModalLongExplanation } from "./ModalLongExplanation";
import { ModalMathLevel } from "./ModalMathLevel";

interface DailyRecommendationCardProps {
  forecast: DailyForecast;
  strings: HomeStrings;
  onDiscuss?: () => void;
  showDiscuss?: boolean;
  accessMode: AccessMode;
  natalProfile?: NatalProfile | null;
  modelUsed?: string | null;
  homeTextsLoading?: boolean;
}

export function DailyRecommendationCard({
  forecast,
  strings,
  onDiscuss,
  showDiscuss = true,
  accessMode,
  natalProfile,
  modelUsed,
  homeTextsLoading = false,
}: DailyRecommendationCardProps) {
  const theme = useTheme();
  const [modalLevel, setModalLevel] = useState<"none" | "long" | "math">("none");
  const locale = strings.locale;
  const planetChakra = useMemo(() => getPlanetChakraMap(locale), [locale]);
  const shortText = forecast.recommendationShortText?.trim();
  const text =
    shortText
    || (homeTextsLoading ? strings.recommendation.loading : strings.recommendation.fallback(forecast));
  const meta = planetChakra[forecast.planetOfTheDay];
  const tone = strings.toneLabels[forecast.todayPlanetState.todayTone];
  const detailText = strings.recommendation.detailParagraphs(forecast).join("\n\n");
  const longExplanation =
    forecast.recommendationLongText?.trim()
    || (homeTextsLoading ? strings.recommendation.loading : detailText);
  const hasMathLevel = Boolean(forecast.mathLevel?.markdown);

  return (
    <>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.header}>
            <AppText variant="sectionTitle">{strings.recommendation.title}</AppText>
            <AppText variant="technicalCaption" tone="muted">
              {strings.recommendation.meta(strings.planetLabels[forecast.planetOfTheDay], meta.chakraName)}
            </AppText>
          </View>
        </View>
        <AppText variant="screenHint">{text}</AppText>
        {__DEV__ ? (
          <AppText variant="technicalCaption" tone="muted">
            model: {modelUsed ?? "unknown"} · {accessMode}
          </AppText>
        ) : null}
        {forecast.isAlternativeChoice && forecast.alternativeReasonText ? (
          <AppText variant="technicalCaption" tone="muted">
            {forecast.alternativeReasonText}
          </AppText>
        ) : null}
        <AppButton label={strings.recommendation.readMoreButton} variant="secondary" onPress={() => setModalLevel("long")} />
        {showDiscuss && onDiscuss ? <AppButton label={strings.recommendation.discussButton} onPress={onDiscuss} /> : null}
      </View>
      <ModalLongExplanation
        visible={modalLevel === "long"}
        onClose={() => setModalLevel("none")}
        longExplanation={longExplanation}
        onOpenMath={() => setModalLevel("math")}
        canOpenMath={hasMathLevel}
        strings={strings.longExplanationModal}
      />
      <ModalMathLevel
        visible={modalLevel === "math"}
        onClose={() => setModalLevel("long")}
        mathLevel={forecast.mathLevel}
        natalProfile={natalProfile}
        forecast={forecast}
        accessMode={accessMode}
        strings={strings.mathModal}
        chartStrings={{
          planetLabels: strings.planetLabels,
          closeButton: strings.closeButton,
          opportunityWindows: strings.opportunityWindows,
          astroChartModal: strings.astroChartModal,
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  header: {
    gap: 4,
    flex: 1,
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
});
