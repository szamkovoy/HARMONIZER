import { Modal, StyleSheet, View } from "react-native";

import type { FeatureKey } from "@/modules/access/core/features";
import { type ProductTier } from "@/modules/access/core/tiers";
import { useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

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
  const { t } = useTranslate();
  const tierLabel = t(`tier.${requiredTier}`);
  const featureLabel = t(`upgrade.feature.${feature}`);
  const bodyKey =
    feature === "assistant_dialog" ? "upgrade.body.assistant_dialog" : "upgrade.body.default";
  const body = t(bodyKey, { feature: featureLabel });

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
          <AppText variant="sectionTitle">{t("upgrade.title", { tier: tierLabel })}</AppText>
          <AppText variant="dialogBody" tone="muted">
            {body}
          </AppText>
          <View style={styles.actions}>
            {onDetails ? (
              <AppButton label={t("upgrade.moreDetails")} variant="secondary" onPress={onDetails} style={styles.action} />
            ) : null}
            <AppButton label={t("upgrade.gotIt")} onPress={onClose} style={styles.action} />
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
