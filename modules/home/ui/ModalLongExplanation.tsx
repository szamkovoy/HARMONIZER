import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { MarkdownText } from "./MarkdownText";

interface ModalLongExplanationProps {
  visible: boolean;
  onClose: () => void;
  longExplanation: string;
  onOpenMath: () => void;
  canOpenMath: boolean;
}

export function ModalLongExplanation({
  visible,
  onClose,
  longExplanation,
  onOpenMath,
  canOpenMath,
}: ModalLongExplanationProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: theme.colors.screenBg, paddingTop: insets.top + 12 }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.surfaceBorder }]}>
          <View style={styles.headerText}>
            <AppText variant="sectionTitle">Подробнее</AppText>
            <AppText variant="technicalCaption" tone="muted">
              Развёрнутое объяснение рекомендации дня.
            </AppText>
          </View>
          <AppButton label="Закрыть" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            <MarkdownText source={longExplanation} />
          </View>

          <AppButton
            label="Расчёты и формулы"
            variant="secondary"
            onPress={onOpenMath}
            disabled={!canOpenMath}
            accessibilityLabel="Открыть расчёты и формулы рекомендации дня"
          />
          <AppText variant="technicalCaption" tone="muted" style={styles.centerText}>
            Точная математика силы и гармоничности планет, веса аспектов и выбор темы дня.
          </AppText>
        </ScrollView>
      </View>
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
    gap: 14,
    padding: 20,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
  },
  centerText: {
    textAlign: "center",
  },
});
