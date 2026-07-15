import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import {
  MAX_SUPPORT_ATTACHMENTS,
  MAX_SUPPORT_MESSAGE_LENGTH,
  pickSupportScreenshots,
  sendSupportMessage,
  type SupportAttachmentDraft,
} from "@/modules/support/core/supportClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/** Модалка «Написать в поддержку»: текст + до 3 скриншотов. */
export function SupportModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslate();
  const { authUser } = useAuth();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SupportAttachmentDraft[]>([]);
  const [sending, setSending] = useState(false);

  const close = () => {
    if (sending) return;
    setBody("");
    setAttachments([]);
    onClose();
  };

  const addScreenshots = async () => {
    const result = await pickSupportScreenshots(attachments.length);
    if ("error" in result) {
      const key =
        result.error === "permission"
          ? "support.attachPermission"
          : result.error === "limit"
            ? "support.attachLimit"
            : result.error === "size"
              ? "support.attachSize"
              : result.error === "type"
                ? "support.attachType"
                : result.error === "native"
                  ? "support.attachNeedsRebuild"
                  : "support.attachFailed";
      Alert.alert(t(key));
      return;
    }
    if (result.length === 0) return;
    setAttachments((prev) => [...prev, ...result].slice(0, MAX_SUPPORT_ATTACHMENTS));
  };

  const submit = async () => {
    if (!authUser?.id || !body.trim() || sending) return;
    setSending(true);
    try {
      const result = await sendSupportMessage(authUser.id, body, attachments);
      if (result.ok) {
        setBody("");
        setAttachments([]);
        onClose();
        Alert.alert(t("support.sentTitle"), t("support.sentMessage"));
      } else {
        const key =
          result.message === "size"
            ? "support.attachSize"
            : result.message === "type"
              ? "support.attachType"
              : result.message === "limit"
                ? "support.attachLimit"
                : "support.sendFailed";
        Alert.alert(t(key));
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

          {attachments.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
              {attachments.map((file) => (
                <View key={file.uri} style={styles.thumbWrap}>
                  <Image source={{ uri: file.uri }} style={styles.thumb} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("support.removeAttachA11y")}
                    disabled={sending}
                    onPress={() => setAttachments((prev) => prev.filter((item) => item.uri !== file.uri))}
                    style={[styles.thumbRemove, { backgroundColor: theme.colors.surfaceElevated }]}
                  >
                    <AppText variant="technicalCaption" tone="danger">
                      ×
                    </AppText>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {attachments.length < MAX_SUPPORT_ATTACHMENTS ? (
            <Pressable
              accessibilityRole="button"
              disabled={sending}
              onPress={() => void addScreenshots()}
              style={({ pressed }) => [{ opacity: pressed || sending ? 0.6 : 1 }]}
            >
              <AppText variant="buttonLabel" tone="accent">
                {t("support.attachButton")}
              </AppText>
            </Pressable>
          ) : null}
          <AppText variant="technicalCaption" tone="faint">
            {t("support.attachHint")}
          </AppText>

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
  thumbs: {
    gap: 8,
  },
  thumbWrap: {
    position: "relative",
  },
  thumb: {
    borderRadius: 10,
    height: 72,
    width: 72,
  },
  thumbRemove: {
    alignItems: "center",
    borderRadius: 999,
    height: 22,
    justifyContent: "center",
    position: "absolute",
    right: -4,
    top: -4,
    width: 22,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
});
