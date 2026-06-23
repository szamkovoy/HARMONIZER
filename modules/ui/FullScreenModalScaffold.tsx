import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function FullScreenModalScaffold({
  title,
  subtitle,
  closeLabel,
  onClose,
  children,
  style,
}: {
  title: string;
  subtitle?: string | null;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.screenBg }, style]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 12,
            borderBottomColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.headerText}>
          <AppText variant="sectionTitle">{title}</AppText>
          {subtitle ? (
            <AppText variant="technicalCaption" tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        <AppButton
          label={closeLabel}
          variant="secondary"
          onPress={onClose}
          style={styles.closeButton}
        />
      </View>
      <View style={styles.body}>{children}</View>
    </View>
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
  body: {
    flex: 1,
  },
});
