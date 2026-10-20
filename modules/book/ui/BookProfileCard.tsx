import { View, StyleSheet } from "react-native";

import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { useTranslate } from "@/modules/i18n";

export function BookProfileCard({
  onRead,
  busy = false,
  error,
}: {
  onRead: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const theme = useTheme();
  const { t } = useTranslate();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <AppText variant="sectionTitle">{t("book.profile.title")}</AppText>
      <AppText variant="screenHint" tone="muted">
        {t("book.profile.subtitle")}
      </AppText>
      <AppButton label={busy ? "…" : t("book.profile.read")} onPress={onRead} disabled={busy} />
      {error ? (
        <AppText variant="technicalCaption" style={{ color: theme.colors.danger }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
});
