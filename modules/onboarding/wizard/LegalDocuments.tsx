/**
 * Юридическая строка + модальные окна с текстами
 * «Пользовательское соглашение» и «Политика конфиденциальности».
 *
 * Тексты документов и подписи ссылок — из i18n-каталога (`wizard.legal.*`),
 * активная локаль приложения (мастер / Профиль — один и тот же store).
 *
 * `tone="consent"` — фраза «Продолжая, вы соглашаетесь…» (шаг 1 мастера).
 * `tone="links"` — версия/копирайт + две ссылки (Профиль); модалка та же.
 */
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";

import { AppText } from "@/modules/ui/AppText";
import { AppButton } from "@/modules/ui/AppButton";
import { useTheme } from "@/modules/ui/theme";
import { useTranslate } from "@/modules/i18n";

type LegalDoc = "terms" | "privacy";

function resolveAppVersionMeta(): { version: string; build: string } {
  // Named exports only — default import is undefined and crashes Profile (`tone="links"`).
  const fromConfig = Constants.expoConfig?.version?.trim();
  const fromNative = Application.nativeApplicationVersion?.trim();
  const version = fromConfig || fromNative || "0.0.0";
  const build = Application.nativeBuildVersion?.trim() || "1";
  return { version, build };
}

export function LegalFooter({ tone = "consent" }: { tone?: "consent" | "links" }) {
  const theme = useTheme();
  const { t } = useTranslate();
  const [openDoc, setOpenDoc] = useState<LegalDoc | null>(null);
  const { version, build } = useMemo(() => resolveAppVersionMeta(), []);
  const copyrightYear = new Date().getFullYear();

  const linkStyle = {
    color: theme.colors.accent,
    textDecorationLine: "underline" as const,
  };
  const baseStyle = {
    color: theme.colors.textFaint,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "400" as const,
  };

  const termsLabel = tone === "links" ? t("wizard.legal.termsTitle") : t("wizard.legal.termsLink");
  const privacyLabel = tone === "links" ? t("wizard.legal.privacyTitle") : t("wizard.legal.privacyLink");

  return (
    <View style={styles.wrap}>
      {tone === "links" ? (
        <>
          <Text style={[baseStyle, styles.text]} accessibilityRole="text">
            {`${t("common.appName")} v${version} (${build})`}
          </Text>
          <Text style={[baseStyle, styles.text]} accessibilityRole="text">
            {`© ${copyrightYear} ${t("profile.about.copyrightHolder")}`}
          </Text>
        </>
      ) : null}
      <Text style={[baseStyle, styles.text]} accessibilityRole="text">
        {tone === "consent" ? <Text>{t("wizard.legal.prefix")}</Text> : null}
        <Text
          accessibilityRole="link"
          onPress={() => setOpenDoc("terms")}
          style={linkStyle}
        >
          {termsLabel}
        </Text>
        <Text>{t("wizard.legal.and")}</Text>
        <Text
          accessibilityRole="link"
          onPress={() => setOpenDoc("privacy")}
          style={linkStyle}
        >
          {privacyLabel}
        </Text>
      </Text>

      <LegalDocumentModal doc={openDoc} onClose={() => setOpenDoc(null)} />
    </View>
  );
}

function LegalDocumentModal({ doc, onClose }: { doc: LegalDoc | null; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslate();
  if (!doc) return null;
  const body: string = doc === "terms" ? t("wizard.legal.termsBody") : t("wizard.legal.privacyBody");

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
        {/* Ловец кликов по затемнённому фону — за листом. Сам лист (View) лежит
            выше и перехватывает тапы по себе, поэтому скролл внутри не ломается. */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View
          style={[styles.sheet, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}
        >
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.docContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            <AppText variant="dialogBody" tone="muted" style={styles.docText}>
              {body}
            </AppText>
          </ScrollView>
          <AppButton label={t("wizard.legal.close")} variant="secondary" onPress={onClose} style={styles.closeBtn} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
  },
  text: {
    textAlign: "center",
  },
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 460,
    height: "86%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  sheetBody: {
    flex: 1,
  },
  docContent: {
    flexGrow: 1,
    // Чуть больше воздуха над первой строкой юртекста (оба документа).
    paddingTop: 10,
  },
  docText: {
    lineHeight: 22,
  },
  closeBtn: {
    marginTop: 4,
  },
});
