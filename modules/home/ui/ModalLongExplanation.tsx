import { Modal, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { HomeStrings } from "@/modules/home/i18n/home";
import type { AccessMode } from "@/services/globalContentClient";
import { AppButton } from "@/modules/ui/AppButton";
import { FullScreenModalScaffold } from "@/modules/ui/FullScreenModalScaffold";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { MarkdownText } from "./MarkdownText";
import { ModalMathLevel } from "./ModalMathLevel";

import type { NatalProfile } from "@/modules/astro-core";
import type { DailyForecast } from "@/modules/daily-engine";

interface ModalLongExplanationProps {
  visible: boolean;
  onClose: () => void;
  longExplanation: string;
  onOpenMath: () => void;
  canOpenMath: boolean;
  strings: HomeStrings["longExplanationModal"];
  showMath?: boolean;
  mathLevel?: DailyForecast["mathLevel"] | null;
  natalProfile?: NatalProfile | null;
  forecast?: DailyForecast | null;
  accessMode?: AccessMode;
  mathStrings?: HomeStrings["mathModal"];
  chartStrings?: Pick<HomeStrings, "planetLabels" | "closeButton" | "opportunityWindows" | "astroChartModal">;
}

export function ModalLongExplanation({
  visible,
  onClose,
  longExplanation,
  onOpenMath,
  canOpenMath,
  strings,
  showMath = false,
  mathLevel,
  natalProfile,
  forecast,
  accessMode = "premium",
  mathStrings,
  chartStrings,
}: ModalLongExplanationProps) {
  const insets = useSafeAreaInsets();

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

      {showMath && mathStrings && chartStrings ? (
        <ModalMathLevel
          visible={showMath}
          onClose={onClose}
          mathLevel={mathLevel}
          natalProfile={natalProfile}
          forecast={forecast}
          accessMode={accessMode}
          strings={mathStrings}
          chartStrings={chartStrings}
          presentation="nestedOverlay"
        />
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
  centerText: {
    textAlign: "center",
  },
});
