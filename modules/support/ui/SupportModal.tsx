/**
 * Форма «Написать в поддержку»: текст + до 3 скриншотов.
 *
 * Не RN Modal: PHPicker/галерея поверх Modal на iOS ломает тачи (галочка/крестик),
 * а скрытие Modal на время пикера даёт «окно пропало → профиль → снова форма».
 * Overlay-View остаётся в дереве — медиатека открывается поверх формы.
 *
 * Клавиатура (платформы разделены намеренно):
 * - iOS: KeyboardAvoidingView behavior="padding" + center (проверенный путь).
 * - Android: absolute overlay не «сжимается» как контент вкладки — flex-end без
 *   paddingBottom=IME уводит карточку под клавиатуру. Поэтому padding = высота IME
 *   (как NatalBirthDataModal), iOS-путь не трогаем.
 * Подтверждение/ошибки — AppDialog (тема приложения), не системный Alert.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
  warmSupportImagePicker,
  type SupportAttachmentDraft,
} from "@/modules/support/core/supportClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppDialog } from "@/modules/ui/AppDialog";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

type InfoDialog = { title: string; message?: string };

export function SupportModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslate();
  const { authUser } = useAuth();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SupportAttachmentDraft[]>([]);
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const [infoDialog, setInfoDialog] = useState<InfoDialog | null>(null);
  const sendCancelledRef = useRef(false);

  const close = () => {
    if (picking) return;
    if (sending) {
      // Не блокируем UI на долгой загрузке: отмена закрывает форму.
      sendCancelledRef.current = true;
      setSending(false);
    }
    setBody("");
    setAttachments([]);
    onClose();
  };

  useEffect(() => {
    if (!visible) return;
    void warmSupportImagePicker();
  }, [visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== "android") {
      setAndroidKeyboardHeight(0);
      return;
    }
    const onShow = Keyboard.addListener("keyboardDidShow", (e) => {
      setAndroidKeyboardHeight(Math.max(0, e.endCoordinates?.height ?? 0));
    });
    const onHide = Keyboard.addListener("keyboardDidHide", () => {
      setAndroidKeyboardHeight(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (picking) return true;
      close();
      return true;
    });
    return () => sub.remove();
    // close captures latest sending/picking; re-bind when those flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional close binding
  }, [visible, sending, picking, onClose]);

  const showInfo = (title: string, message?: string) => {
    setInfoDialog({ title, message });
  };

  const addScreenshots = async () => {
    if (sending || picking) return;
    setPicking(true);
    try {
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
        showInfo(t(key));
        return;
      }
      if (result.length === 0) return;
      setAttachments((prev) => [...prev, ...result].slice(0, MAX_SUPPORT_ATTACHMENTS));
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    if (!authUser?.id || !body.trim() || sending || picking) return;
    sendCancelledRef.current = false;
    setSending(true);
    try {
      const result = await sendSupportMessage(authUser.id, body, attachments, {
        isCancelled: () => sendCancelledRef.current,
      });
      if (sendCancelledRef.current) return;
      if (result.ok) {
        setBody("");
        setAttachments([]);
        onClose();
        showInfo(t("support.sentTitle"), t("support.sentMessage"));
      } else if (result.message === "cancelled") {
        return;
      } else {
        const key =
          result.message === "size"
            ? "support.attachSize"
            : result.message === "type"
              ? "support.attachType"
              : result.message === "limit"
                ? "support.attachLimit"
                : "support.sendFailed";
        showInfo(t(key));
      }
    } finally {
      if (!sendCancelledRef.current) setSending(false);
    }
  };

  const androidKeyboardOpen = androidKeyboardHeight > 0;

  if (!visible && !infoDialog) return null;

  const card = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.surfaceBorder,
          borderRadius: theme.radius.lg,
          opacity: picking ? 0.92 : 1,
          maxHeight: Platform.OS === "android" && androidKeyboardOpen ? "92%" : undefined,
        },
      ]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
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
          editable={!sending && !picking}
          style={[
            styles.input,
            {
              borderColor: theme.colors.surfaceBorder,
              color: theme.colors.textPrimary,
              minHeight: Platform.OS === "android" && androidKeyboardOpen ? 88 : 120,
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
                  disabled={sending || picking}
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
            disabled={sending || picking}
            onPress={() => void addScreenshots()}
            style={({ pressed }) => [
              styles.attachRow,
              { opacity: pressed || sending || picking ? 0.6 : 1 },
            ]}
          >
            {picking ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : null}
            <AppText variant="buttonLabel" tone="accent">
              {picking ? t("support.attachOpening") : t("support.attachButton")}
            </AppText>
          </Pressable>
        ) : null}
        <AppText variant="technicalCaption" tone="faint">
          {t("support.attachHint")}
        </AppText>
        {sending ? (
          <View style={styles.attachRow}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <AppText variant="technicalCaption" tone="muted">
              {t("support.sendingStatus")}
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <AppButton
          label={t("common.cancel")}
          variant="secondary"
          onPress={close}
          disabled={picking}
          style={styles.actionButton}
        />
        <AppButton
          label={sending ? "" : t("support.send")}
          variant="primary"
          disabled={sending || picking || !body.trim()}
          onPress={() => void submit()}
          style={styles.actionButton}
        >
          {sending ? <ActivityIndicator size="small" color={theme.colors.accentOnText} /> : null}
        </AppButton>
      </View>
    </View>
  );

  const dismissLayer = (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={close}
      accessibilityRole="button"
      disabled={picking}
    />
  );

  let formShell: ReactNode;
  if (Platform.OS === "ios") {
    formShell = (
      <KeyboardAvoidingView behavior="padding" style={styles.backdropCentered}>
        {dismissLayer}
        {card}
      </KeyboardAvoidingView>
    );
  } else {
    formShell = (
      <View
        style={[
          styles.backdropAndroid,
          {
            // Высота IME: absolute overlay не сидит в resized-зоне вкладки.
            paddingBottom: androidKeyboardOpen ? androidKeyboardHeight + 8 : 24,
            justifyContent: androidKeyboardOpen ? "flex-end" : "center",
          },
        ]}
      >
        {dismissLayer}
        {card}
      </View>
    );
  }

  return (
    <>
      {visible ? (
        <View
          style={[styles.host, { backgroundColor: theme.colors.modalBackdrop }]}
          pointerEvents="box-none"
          accessibilityViewIsModal
        >
          {formShell}
        </View>
      ) : null}

      <AppDialog
        visible={infoDialog != null}
        title={infoDialog?.title ?? ""}
        message={infoDialog?.message}
        onRequestClose={() => setInfoDialog(null)}
        actions={
          <AppButton label={t("common.ok")} variant="primary" onPress={() => setInfoDialog(null)} />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    elevation: 1000,
    zIndex: 1000,
  },
  backdropCentered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  backdropAndroid: {
    alignItems: "center",
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  card: {
    borderWidth: 1,
    gap: 12,
    maxWidth: 480,
    padding: 20,
    width: "100%",
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: 12,
  },
  attachRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
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
