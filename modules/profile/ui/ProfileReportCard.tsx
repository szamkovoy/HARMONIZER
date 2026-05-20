import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function ProfileReportCard(props: {
  title: string;
  subtitle?: string;
  periodSelector?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
      <AppText variant="sectionTitle">{props.title}</AppText>
      {props.subtitle ? (
        <AppText variant="technicalCaption" tone="muted">
          {props.subtitle}
        </AppText>
      ) : null}
      {props.periodSelector}
      {props.children}
      {props.footer}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 16,
  },
});
