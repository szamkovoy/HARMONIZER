import { useMemo, useState } from "react";
import { StyleSheet } from "react-native";

import type { NatalProfile } from "@/modules/astro-core";
import type { DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { sanitizeRecommendationDisplay } from "@/modules/home/sanitizeRecommendationDisplay";
import type { AccessMode } from "@/services/globalContentClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { SurfaceCardHeader } from "@/modules/ui/SurfaceCardHeader";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { SurfaceHelpModal } from "@/modules/ui/SurfaceHelpModal";
import { ModalLongExplanation, type HomeExplainerLevel } from "./ModalLongExplanation";

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
  const [modalLevel, setModalLevel] = useState<HomeExplainerLevel>("none");
  const [helpVisible, setHelpVisible] = useState(false);
  const locale = strings.locale;
  const t = strings.recommendation;
  const fallbackShortText = strings.recommendation.fallback(forecast);
  const detailText = strings.recommendation.detailParagraphs(forecast).join("\n\n");
  const shortText = useMemo(() => {
    const raw = forecast.recommendationShortText?.trim();
    if (raw) return sanitizeRecommendationDisplay(raw, locale);
    if (homeTextsLoading) return null;
    return fallbackShortText;
  }, [fallbackShortText, forecast.recommendationShortText, homeTextsLoading, locale]);
  const longExplanation = useMemo(() => {
    const raw = forecast.recommendationLongText?.trim();
    if (raw) return sanitizeRecommendationDisplay(raw, locale);
    if (homeTextsLoading) return "";
    return detailText;
  }, [detailText, forecast.recommendationLongText, homeTextsLoading, locale]);
  const hasMathLevel = Boolean(forecast.mathLevel?.markdown);

  return (
    <>
      <SurfaceCardView tone="elevated" style={styles.card}>
        <SurfaceCardHeader
          title={t.title}
          help={{
            accessibilityLabel: t.helpButtonAccessibilityLabel,
            onPress: () => setHelpVisible(true),
          }}
        >
          <AppText variant="screenHint">
            {shortText ?? t.loading}
          </AppText>
        </SurfaceCardHeader>
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
        <AppButton label={t.readMoreButton} variant="secondary" onPress={() => setModalLevel("long")} />
        {showDiscuss && onDiscuss ? <AppButton label={t.discussButton} onPress={onDiscuss} /> : null}
      </SurfaceCardView>
      <SurfaceHelpModal
        visible={helpVisible}
        title={t.helpModalTitle}
        closeLabel={strings.closeButton}
        onClose={() => setHelpVisible(false)}
        body={t.helpBody}
      />
      <ModalLongExplanation
        level={modalLevel}
        onClose={() => setModalLevel("none")}
        longExplanation={longExplanation}
        onOpenMath={() => setModalLevel("math")}
        onOpenChart={() => setModalLevel("chart")}
        canOpenMath={hasMathLevel}
        strings={strings.longExplanationModal}
        mathLevel={forecast.mathLevel}
        natalProfile={natalProfile}
        forecast={forecast}
        accessMode={accessMode}
        mathStrings={strings.mathModal}
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
  card: {},
});
