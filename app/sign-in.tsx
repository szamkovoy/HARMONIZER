/**
 * Экран входа: имя + email → письмо с 6-значным кодом → ввод кода.
 *
 * Единственный способ авторизации (Apple/Google Sign-In удалены — модель
 * Consumption-Only, Guideline 5.1.1(v) при чистом email-OTP не требует
 * «Sign in with Apple»). Для нового и существующего пользователя поток
 * одинаковый: Supabase сам определяет, создать аккаунт или войти в
 * существующий.
 *
 * UX: 6 ячеек кода с автоотправкой, повторная отправка по таймеру 60 с,
 * подсказка про папку «Спам». Все строки — в modules/i18n/catalog (8 локалей).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { useTranslate } from "@/modules/i18n";
import { isValidEmail, normalizeEmail } from "@/modules/auth/sign-in-email";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { HeroScreenLayout } from "@/modules/ui/StackScreenLayout";
import { useTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

type Step = "email" | "code";

export default function SignInScreen() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { requestEmailCode, verifyEmailCode, signingIn } = useAuth();

  const [step, setStep] = useState<Step>("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const codeInputRef = useRef<TextInput>(null);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (resendSecondsLeft <= 0) return;
    const timer = setTimeout(() => setResendSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendSecondsLeft]);

  const sendCode = useCallback(
    async (source: "initial" | "resend") => {
      setErrorText(null);
      if (!isValidEmail(email)) {
        setErrorText(t("auth.invalidEmail"));
        return;
      }
      logRuntimeTap("sign_in_send_code", { source });
      try {
        await requestEmailCode(normalizeEmail(email), name);
        setStep("code");
        setCode("");
        setResendSecondsLeft(RESEND_COOLDOWN_SECONDS);
        setTimeout(() => codeInputRef.current?.focus(), 350);
      } catch (e) {
        logRuntimeEvent("sign_in_send_code_error", {
          message: e instanceof Error ? e.message : String(e),
        }, "warn");
        setErrorText(resolveAuthErrorText(e, t));
      }
    },
    [email, name, requestEmailCode, t],
  );

  const verify = useCallback(
    async (value: string) => {
      if (verifyingRef.current) return;
      verifyingRef.current = true;
      setErrorText(null);
      try {
        await verifyEmailCode(normalizeEmail(email), value);
        // Успех: onAuthStateChange установит сессию, роут-гейт уведёт с экрана.
      } catch (e) {
        logRuntimeEvent("sign_in_verify_error", {
          message: e instanceof Error ? e.message : String(e),
        }, "warn");
        setCode("");
        setErrorText(isOtpMismatchError(e) ? t("auth.codeInvalid") : resolveAuthErrorText(e, t));
        setTimeout(() => codeInputRef.current?.focus(), 100);
      } finally {
        verifyingRef.current = false;
      }
    },
    [email, t, verifyEmailCode],
  );

  const onCodeChange = useCallback(
    (raw: string) => {
      const digits = raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
      setCode(digits);
      if (digits.length === CODE_LENGTH) {
        void verify(digits);
      }
    },
    [verify],
  );

  const cells = useMemo(() => Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? ""), [code]);

  return (
    <HeroScreenLayout
      header={
        <View style={styles.header}>
          <AppText variant="screenTitle" style={styles.title}>
            {t("auth.title")}
          </AppText>
          <AppText variant="screenHint" style={[styles.subtitle, { color: theme.colors.textMuted }]}>
            {step === "email" ? t("auth.subtitle") : t("auth.codeSent", { email: normalizeEmail(email) })}
          </AppText>
        </View>
      }
      footer={
        <AppText variant="technicalCaption" style={[styles.footer, { color: theme.colors.textFaint }]}>
          {t("auth.legal")}
        </AppText>
      }
    >
      {step === "email" ? (
        <View style={styles.form}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("auth.namePlaceholder")}
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            editable={!signingIn}
            style={[
              styles.input,
              {
                borderColor: theme.colors.surfaceBorder,
                color: theme.colors.textPrimary,
                borderRadius: theme.radius.md,
              },
            ]}
          />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t("auth.emailPlaceholder")}
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            editable={!signingIn}
            onSubmitEditing={() => void sendCode("initial")}
            style={[
              styles.input,
              {
                borderColor: theme.colors.surfaceBorder,
                color: theme.colors.textPrimary,
                borderRadius: theme.radius.md,
              },
            ]}
          />
          <AppButton
            label={signingIn ? t("auth.sending") : t("auth.sendCode")}
            onPress={() => void sendCode("initial")}
            disabled={signingIn || !email.trim()}
          />
        </View>
      ) : (
        <View style={styles.form}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("auth.codeTitle")}
            onPress={() => codeInputRef.current?.focus()}
            style={styles.codeRow}
          >
            {cells.map((char, index) => {
              const isActive = index === Math.min(code.length, CODE_LENGTH - 1);
              return (
                <View
                  key={index}
                  style={[
                    styles.codeCell,
                    {
                      borderColor: isActive ? theme.colors.accent : theme.colors.surfaceBorder,
                      backgroundColor: theme.colors.surfaceElevated,
                      borderRadius: theme.radius.md,
                    },
                  ]}
                >
                  <AppText variant="sectionTitle">{char}</AppText>
                </View>
              );
            })}
          </Pressable>
          <TextInput
            ref={codeInputRef}
            value={code}
            onChangeText={onCodeChange}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            editable={!signingIn}
            autoFocus
            caretHidden
            style={styles.hiddenInput}
          />

          {signingIn ? (
            <View style={styles.spinnerRow}>
              <ActivityIndicator color={theme.colors.accent} />
              <AppText variant="technicalCaption" tone="muted">
                {t("auth.codeVerifying")}
              </AppText>
            </View>
          ) : null}

          <View style={styles.codeActions}>
            <AppButton
              label={
                resendSecondsLeft > 0
                  ? t("auth.resendIn", { seconds: String(resendSecondsLeft) })
                  : t("auth.resend")
              }
              variant="secondary"
              onPress={() => void sendCode("resend")}
              disabled={signingIn || resendSecondsLeft > 0}
            />
            <AppButton
              label={t("auth.changeEmail")}
              variant="secondary"
              onPress={() => {
                setStep("email");
                setCode("");
                setErrorText(null);
              }}
              disabled={signingIn}
            />
          </View>
          <AppText variant="technicalCaption" tone="muted" style={styles.spamHint}>
            {t("auth.spamHint")}
          </AppText>
        </View>
      )}

      {errorText ? (
        <AppText
          variant="technicalCaption"
          style={{ color: theme.colors.danger, textAlign: "center", marginTop: 12 }}
        >
          {errorText}
        </AppText>
      ) : null}
    </HeroScreenLayout>
  );
}

function isOtpMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /otp|token|expired|invalid/i.test(message);
}

function resolveAuthErrorText(error: unknown, t: (key: string, params?: Record<string, string>) => string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/rate limit|too many/i.test(message)) return t("auth.rateLimited");
  if (/network|fetch|timeout|connection/i.test(message)) return t("auth.networkError");
  return t("auth.genericError");
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
  },
  title: {
    fontSize: 32,
    letterSpacing: 0.5,
  },
  subtitle: {
    textAlign: "center",
    marginTop: 8,
    maxWidth: 320,
  },
  form: {
    gap: 12,
  },
  input: {
    borderWidth: 1,
    fontSize: 16,
    height: 52,
    paddingHorizontal: 14,
  },
  codeRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  codeCell: {
    alignItems: "center",
    borderWidth: 1.5,
    height: 56,
    justifyContent: "center",
    width: 44,
  },
  hiddenInput: {
    height: 1,
    opacity: 0,
    position: "absolute",
    width: 1,
  },
  spinnerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    paddingTop: 4,
  },
  codeActions: {
    gap: 10,
    marginTop: 8,
  },
  spamHint: {
    textAlign: "center",
    marginTop: 4,
  },
  footer: {
    textAlign: "center",
    marginTop: 24,
  },
});
