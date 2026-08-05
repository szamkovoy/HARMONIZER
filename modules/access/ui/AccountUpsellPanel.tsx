/**
 * Сворачиваемая панель на главной для уровня «Навигатор» (free).
 *
 * Свёрнута: одна строка «Включите индивидуальные рекомендации…» со стрелкой.
 * Развёрнута: пояснение про универсальные vs индивидуальные рекомендации и
 * кнопки «Личный кабинет» (если ссылки включены) / «Закрыть» (сворачивает).
 *
 * Комплаенс: без цен и коммерческих формулировок — только «параметры
 * рекомендаций» и «Личный кабинет». Тексты — `gate.homePanel.*`.
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { openAccountCabinet, useAccountLinksEnabled } from "@/modules/account";
import { isStoreReviewAccount, useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

export function AccountUpsellPanel() {
  const theme = useTheme();
  const { t } = useTranslate();
  const linksEnabled = useAccountLinksEnabled();
  const { profile } = useAuth();
  const showCabinet = linksEnabled && !isStoreReviewAccount(profile);
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const onOpenCabinet = async () => {
    logRuntimeTap("home_upsell_open_cabinet", {});
    setErrorText(null);
    setOpening(true);
    try {
      await openAccountCabinet();
    } catch (error) {
      logRuntimeEvent(
        "home_upsell_cabinet_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      setErrorText(t("gate.cabinetError"));
    } finally {
      setOpening(false);
    }
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.controlButtonBg,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("gate.homePanel.title")}
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => [styles.headerRow, { opacity: pressed ? 0.7 : 1 }]}
      >
        <AppText variant="screenHint" style={styles.headerText} numberOfLines={expanded ? undefined : 1}>
          {t("gate.homePanel.title")}
        </AppText>
        <AppText variant="screenHint" tone="muted" style={[styles.chevron, { transform: [{ rotate: expanded ? "-90deg" : "90deg" }] }]}>
          ›
        </AppText>
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <AppText variant="screenHint" tone="muted">
            {t("gate.homePanel.body")}
          </AppText>
          {errorText ? (
            <AppText variant="technicalCaption" style={{ color: theme.colors.danger }}>
              {errorText}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <AppButton
              label={t("gate.close")}
              variant="secondary"
              onPress={() => setExpanded(false)}
              style={styles.action}
            />
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  headerText: {
    flex: 1,
  },
  chevron: {
    marginTop: -2,
  },
  body: {
    gap: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  action: {
    flex: 1,
  },
});
