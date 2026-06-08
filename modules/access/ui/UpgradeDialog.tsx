import { Modal, StyleSheet, View } from "react-native";

import type { FeatureKey } from "@/modules/access/core/features";
import { TIER_LABELS, type ProductTier } from "@/modules/access/core/tiers";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const FEATURE_LABELS: Record<FeatureKey, string> = {
  global_daily_forecast: "общий прогноз дня",
  personal_daily_forecast: "персональный прогноз",
  calibration: "калибровка",
  assistant_dialog: "ИИ-ассистент",
  day_planning: "вкладку «День»",
  practice_catalog: "каталог практик",
  breath_practices: "дыхательные практики",
  meditations: "медитации",
  asana_practices: "асаны",
  webinar_community: "вебинары и community",
  profile: "профиль",
  stats: "статистика",
};

export function UpgradeDialog({
  visible,
  feature,
  requiredTier,
  onClose,
  onDetails,
}: {
  visible: boolean;
  feature: FeatureKey;
  requiredTier: ProductTier;
  onClose: () => void;
  onDetails?: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <AppText variant="sectionTitle">Функция доступна на тарифе {TIER_LABELS[requiredTier]}</AppText>
          <AppText variant="dialogBody" tone="muted">
            Чтобы открыть {FEATURE_LABELS[feature]}, переключите dev-тариф или позже оформите доступ в приложении.
          </AppText>
          <View style={styles.actions}>
            {onDetails ? <AppButton label="Подробнее" variant="secondary" onPress={onDetails} style={styles.action} /> : null}
            <AppButton label="Понятно" onPress={onClose} style={styles.action} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    padding: 18,
    gap: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  action: {
    flex: 1,
  },
});
