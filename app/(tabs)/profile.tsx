import { useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { DevTierSwitch, TIER_LABELS, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export default function ProfileTabRoute() {
  const theme = useTheme();
  const { profile, refreshProfile } = useAuth();
  const { access, setDevTierOverride } = useAccess();
  const refresh = useCallback(() => {
    void refreshProfile();
  }, [refreshProfile]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }]}>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <AppText variant="screenTitle" accessibilityRole="header">
            Профиль
          </AppText>
          <AppText variant="screenHint" tone="muted">
            Минимальная зона настроек и проверки доступа для первого витка.
          </AppText>
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">Текущий доступ</AppText>
          <AppText variant="screenHint">{access.label}</AppText>
          <AppText variant="technicalCaption" tone="muted">
            effective tier: {TIER_LABELS[access.tier]} · source: {access.source}
          </AppText>
          <AppText variant="technicalCaption" tone="muted">
            profile tier: {profile?.membership_tier ?? "unknown"} · trial: {profile?.trial_expires_at ?? "нет"}
          </AppText>
          <AppButton label="Обновить профиль" variant="secondary" onPress={refresh} />
        </View>

        {__DEV__ ? <DevTierSwitch value={access.devOverride} onChange={setDevTierOverride} /> : null}

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">Скоро здесь</AppText>
          <AppText variant="dialogBody" tone="muted">
            Палитра, статистика практик и настройки натальных данных появятся на следующих витках.
          </AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    alignSelf: "center",
    gap: 18,
    maxWidth: 460,
    padding: 20,
    width: "100%",
  },
  header: {
    gap: 8,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    gap: 12,
    padding: 16,
  },
});
