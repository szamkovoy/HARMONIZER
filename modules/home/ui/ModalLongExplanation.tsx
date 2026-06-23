import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FullScreenModalScaffold } from "@/modules/ui/FullScreenModalScaffold";
import { ScreenSection } from "@/modules/ui/ScreenSection";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";
import { MarkdownText } from "./MarkdownText";

import type { HomeStrings } from "@/modules/home/i18n/home";

interface ModalLongExplanationProps {
  visible: boolean;
  onClose: () => void;
  longExplanation: string;
  onOpenMath: () => void;
  canOpenMath: boolean;
  strings: HomeStrings["longExplanationModal"];
}

export function ModalLongExplanation({
  visible,
  onClose,
  longExplanation,
  onOpenMath,
  canOpenMath,
  strings,
}: ModalLongExplanationProps) {
  const theme = useTheme();
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

          <ScreenSection title={strings.mathButton} subtitle={strings.mathCaption} centerHeader>
            <AppButton
              label={strings.mathButton}
              variant="secondary"
              onPress={onOpenMath}
              disabled={!canOpenMath}
              accessibilityLabel={strings.mathButtonA11y}
            />
          </ScreenSection>
        </ScrollView>
      </FullScreenModalScaffold>
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
