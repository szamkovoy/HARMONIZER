import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import { MAX_SUPPORT_MESSAGE_LENGTH, sendSupportMessage } from "@/modules/support/core/supportClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/** Модалка «Написать в поддержку»: textarea → insert в support_messages под RLS. */
export function SupportModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslate();
  const { authUser } = useAuth();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const close = () => {
    if (!sending) onClose();
  };

  const submit = async () => {
    if (!authUser?.id || !body.trim() || sending) return;
    setSending(true);
    try {
      const result = await sendSupportMessage(authUser.id, body);
      if (result.ok) {
        setBody("");
        onClose();
        Alert.alert(t("support.sentTitle"), t("support.sentMessage"));
      } else {
        Alert.alert(t("support.sendFailed"));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" />
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
              borderRadius: theme.radius.lg,
            },
          ]}
        >
          <AppText variant="dialogTitle">{t("support.title")}</AppText>
          <AppText variant="dialogBody" tone="muted">
            {t("support.hint")}
          </AppText>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={t("support.placeholder")}
            placeholderTextColor={theme.colors.textFaint}
            multiline
            maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
            autoFocus
            style={[
              styles.input,
              {
                borderColor: theme.colors.surfaceBorder,
                color: theme.colors.textPrimary,
              },
            ]}
          />
          <View style={styles.actions}>
            <AppButton label={t("common.cancel")} variant="secondary" onPress={close} style={styles.actionButton} />
            <AppButton
              label={sending ? "" : t("support.send")}
              variant="primary"
              disabled={sending || !body.trim()}
              onPress={() => void submit()}
              style={styles.actionButton}
            >
              {sending ? <ActivityIndicator size="small" color={theme.colors.accentOnText} /> : null}
            </AppButton>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    borderWidth: 1,
    gap: 12,
    maxWidth: 480,
    padding: 20,
    width: "100%",
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 120,
    padding: 12,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
});
