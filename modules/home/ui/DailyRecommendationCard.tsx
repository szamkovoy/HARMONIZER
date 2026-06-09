import { useState } from "react";
import { StyleSheet, View } from "react-native";

import type { NatalProfile } from "@/modules/astro-core";
import { chakraLabelGenitiveRu } from "@/modules/chakra/labels";
import type { DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { getForecastRecommendation } from "@/modules/home/i18n/home";
import type { AccessMode } from "@/services/globalContentClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { PLANET_CHAKRA } from "../planetChakra";
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
}

export function DailyRecommendationCard({
  forecast,
  strings,
  onDiscuss,
  showDiscuss = true,
  accessMode,
  natalProfile,
  modelUsed,
}: DailyRecommendationCardProps) {
  const theme = useTheme();
  const [modalLevel, setModalLevel] = useState<"none" | "long" | "math">("none");
  const text = getForecastRecommendation(forecast, strings);
  const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
  const tone = strings.toneLabels[forecast.todayPlanetState.todayTone];
  const detailText = [
    `Сегодня алгоритм выделил тему «${meta.label}»: её важность выше остальных направлений дня.`,
    `Тональность сейчас ${tone}, поэтому рекомендация сформулирована как практическое задание: удерживать состояние, которое поддерживает качества ${chakraLabelGenitiveRu(meta.chakraNumber)}, и не разгонять автоматические реакции.`,
    forecast.isAlternativeChoice && forecast.alternativeReasonText
      ? forecast.alternativeReasonText
      : "Если эта тема повторялась несколько дней подряд, приложение может выбрать вторую по значимости чакру, чтобы усилия не зацикливались.",
    "Окна возможностей ниже показывают моменты, когда телу и вниманию легче перестроиться: восход даёт импульс, кульминация усиливает проявление, точный аспект делает тему особенно заметной.",
  ].join("\n\n");
  const longExplanation = forecast.recommendationLongText ?? detailText;
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
        <AppButton label="Подробнее" variant="secondary" onPress={() => setModalLevel("long")} />
        {showDiscuss && onDiscuss ? <AppButton label={strings.recommendation.discussButton} onPress={onDiscuss} /> : null}
      </View>
      <ModalLongExplanation
        visible={modalLevel === "long"}
        onClose={() => setModalLevel("none")}
        longExplanation={longExplanation}
        onOpenMath={() => setModalLevel("math")}
        canOpenMath={hasMathLevel}
      />
      <ModalMathLevel
        visible={modalLevel === "math"}
        onClose={() => setModalLevel("long")}
        mathLevel={forecast.mathLevel}
        natalProfile={natalProfile}
        forecast={forecast}
        accessMode={accessMode}
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
