import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AssistantPracticeHandoffCover } from "@/modules/practices/ui/AssistantPracticeHandoffCover";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function AssistantModalShell({
  visible,
  title,
  closeLabel,
  closeAccessibilityLabel,
  onClose,
  children,
  handoffVisible = false,
  animationType = "slide",
  onDismiss,
}: {
  visible: boolean;
  title: string;
  closeLabel: string;
  closeAccessibilityLabel?: string;
  onClose: () => void;
  children: ReactNode;
  handoffVisible?: boolean;
  animationType?: "none" | "slide" | "fade";
  onDismiss?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <Modal
      animationType={animationType}
      presentationStyle="fullScreen"
      visible={visible}
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      {handoffVisible ? (
        <AssistantPracticeHandoffCover />
      ) : (
        <View style={[styles.root, { backgroundColor: theme.colors.screenBg }]}>
          <View
            style={[
              styles.header,
              {
                paddingTop: insets.top + 10,
                borderBottomColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <AppText variant="sectionTitle">{title}</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeAccessibilityLabel ?? closeLabel}
              onPress={onClose}
              style={[styles.close, { backgroundColor: theme.colors.controlButtonBg }]}
            >
              <AppText variant="buttonLabel">{closeLabel}</AppText>
            </Pressable>
          </View>
          <View style={styles.body}>{children}</View>
        </View>
      )}
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
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingHorizontal: 18,
  },
  close: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  body: {
    flex: 1,
  },
});
