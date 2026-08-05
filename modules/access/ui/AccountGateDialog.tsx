/**
 * Комплаенс-диалог заблокированной функции (замена UpgradeDialog).
 *
 * Модель Consumption-Only: внутри приложения нет цен, слов «купить/оплатить»
 * и прямых ссылок на оплату. Диалог технически информирует о «расширенных
 * возможностях учётной записи» и предлагает нейтральную кнопку
 * «Личный кабинет» (системный браузер). Кнопка скрывается kill-switch'ем
 * `app_config.account_links_enabled` на время App Review.
 *
 * Тексты — `gate.*` в modules/i18n/catalog (8 локалей).
 */
import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { openAccountCabinet, useAccountLinksEnabled } from "@/modules/account";
import { isStoreReviewAccount, useAuth } from "@/modules/auth";
import type { FeatureKey } from "@/modules/access/core/features";
import { useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

/** FeatureKey → gate.body.* (комплаенс-формулировки по точкам гейтинга). */
const FEATURE_BODY_KEY: Record<FeatureKey, string> = {
  global_daily_forecast: "gate.body.default",
  personal_daily_forecast: "gate.body.personal",
  calibration: "gate.body.personal",
  assistant_dialog: "gate.body.assistant",
  day_planning: "gate.body.assistant",
  practice_catalog: "gate.body.practices",
  breath_practices: "gate.body.practices",
  meditations: "gate.body.practices",
  asana_practices: "gate.body.practices",
  webinar_community: "gate.body.webinar",
  profile: "gate.body.default",
  stats: "gate.body.default",
};

export function AccountGateDialog({
  visible,
  feature,
  onClose,
}: {
  visible: boolean;
  feature: FeatureKey;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslate();
  const linksEnabled = useAccountLinksEnabled();
  const { profile } = useAuth();
  const showCabinet = linksEnabled && !isStoreReviewAccount(profile);
  const [opening, setOpening] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const onOpenCabinet = async () => {
    logRuntimeTap("account_gate_open_cabinet", { feature });
    setErrorText(null);
    setOpening(true);
    try {
      await openAccountCabinet();
      onClose();
    } catch (error) {
      logRuntimeEvent(
        "account_gate_cabinet_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      setErrorText(t("gate.cabinetError"));
    } finally {
      setOpening(false);
    }
  };

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
          <AppText variant="sectionTitle">{t("gate.title")}</AppText>
          <AppText variant="dialogBody" tone="muted">
            {t(FEATURE_BODY_KEY[feature] ?? "gate.body.default")}
          </AppText>
          {errorText ? (
            <AppText variant="technicalCaption" style={{ color: theme.colors.danger }}>
              {errorText}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <AppButton label={t("gate.close")} variant="secondary" onPress={onClose} style={styles.action} />
            {showCabinet ? (
              <AppButton
                label={opening ? "…" : t("gate.openCabinet")}
                onPress={() => void onOpenCabinet()}
                disabled={opening}
                style={styles.action}
              />
            ) : null}
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
