import { useEffect } from "react";
import { View, StyleSheet } from "react-native";

import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { useTranslate } from "@/modules/i18n";

import { prefetchBookReader } from "../core/prefetchReader";

export function BookProfileCard({ onRead }: { onRead: () => void }) {
  const theme = useTheme();
  const { t } = useTranslate();

  // Warm epub.js chunk while user is on Profile (avoids ~1min blank spinner on open).
  useEffect(() => {
    void prefetchBookReader();
  }, []);

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
      <AppButton label={t("book.profile.read")} onPress={onRead} />
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
