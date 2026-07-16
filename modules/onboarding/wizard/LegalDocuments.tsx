/**
 * Юридическая строка внизу шагов мастера + модальные окна с текстами
 * «Пользовательское соглашение» и «Политика конфиденциальности».
 *
 * Тексты документов и подписи ссылок берутся из i18n-каталога
 * (`wizard.legal.*`), чтобы работать на всех 8 локалях.
 */
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { AppButton } from "@/modules/ui/AppButton";
import { useTheme } from "@/modules/ui/theme";
import { useTranslate } from "@/modules/i18n";

type LegalDoc = "terms" | "privacy";

export function LegalFooter() {
  const theme = useTheme();
  const { t } = useTranslate();
  const [openDoc, setOpenDoc] = useState<LegalDoc | null>(null);

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

  return (
    <View style={styles.wrap}>
      <Text style={[baseStyle, styles.text]} accessibilityRole="text">
        <Text>{t("wizard.legal.prefix")}</Text>
        <Text
          accessibilityRole="link"
          onPress={() => setOpenDoc("terms")}
          style={linkStyle}
        >
          {t("wizard.legal.termsLink")}
        </Text>
        <Text>{t("wizard.legal.and")}</Text>
        <Text
          accessibilityRole="link"
          onPress={() => setOpenDoc("privacy")}
          style={linkStyle}
        >
          {t("wizard.legal.privacyLink")}
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
      <Pressable style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}
          onPress={(e) => e.stopPropagation()}
        >
          <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator>
            <AppText variant="dialogBody" tone="muted" style={styles.docText}>
              {body}
            </AppText>
          </ScrollView>
          <AppButton label={t("wizard.legal.close")} variant="secondary" onPress={onClose} style={styles.closeBtn} />
        </Pressable>
      </Pressable>
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
  docText: {
    lineHeight: 22,
  },
  closeBtn: {
    marginTop: 4,
  },
});
