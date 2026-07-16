/**
 * Шаг 1 онбординг-мастера: вход в приложение.
 *
 * Две подстраницы одного шага (обе считаются «шагом 1» из 7):
 *   • welcome — логотип, «Добро пожаловать!», пояснение + форма (имя, email);
 *   • confirm — картинка email.png, «Подтверждение», ввод 6-значного кода.
 *
 * После успешного ввода OTP создаётся сессия, и роут-гейт в `app/_layout.tsx`
 * сам перекидывает на `/onboarding` (шаги 2-7). Визуально мастер остаётся
 * непрерывным благодаря общему шаблону `WizardShell`.
 *
 * Кнопка «Получить код» / «Изменить email» живёт в footer-слоте оболочки над
 * клавиатурой — поэтому виртуальная клавиатура её больше не перекрывает.
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
import {
  LegalFooter,
  WizardBody,
  WizardImage,
  WizardShell,
  WizardTitle,
} from "@/modules/onboarding";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;
const TOTAL_WIZARD_STEPS = 7;

const LOGO = require("@/assets/images/icon.png");
const EMAIL_ART = require("@/assets/onboarding/email.png");

type SubStep = "welcome" | "confirm";

export default function SignInScreen() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { requestEmailCode, verifyEmailCode, signingIn } = useAuth();

  const [sub, setSub] = useState<SubStep>("welcome");
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
        setSub("confirm");
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
        await verifyEmailCode(normalizeEmail(email), value, name);
        // Успех: onAuthStateChange установит сессию, роут-гейт уведёт на /onboarding.
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

  const footer = sub === "welcome" ? (
    <View style={styles.footerGap}>
      <AppButton
        label={signingIn ? t("auth.sending") : t("auth.sendCode")}
        onPress={() => void sendCode("initial")}
        disabled={signingIn || !email.trim()}
      />
      <LegalFooter />
    </View>
  ) : (
    <View style={styles.footerGap}>
      <LegalFooter />
    </View>
  );

  return (
    <WizardShell
      totalSteps={TOTAL_WIZARD_STEPS}
      currentStep={1}
      footer={footer}
      statusBarStyle={theme.scheme === "dark" ? "light" : "dark"}
    >
      {sub === "welcome" ? (
        <>
          <WizardImage source={LOGO} height={160} />
          <WizardTitle>{t("wizard.welcome.title")}</WizardTitle>
          <WizardBody>{t("wizard.welcome.body1")}</WizardBody>
          <WizardBody>{t("wizard.welcome.body2")}</WizardBody>
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
              style={[styles.input, inputStyle(theme)]}
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
              style={[styles.input, inputStyle(theme)]}
            />
          </View>
        </>
      ) : (
        <>
          <WizardImage source={EMAIL_ART} />
          <WizardTitle>{t("wizard.confirm.title")}</WizardTitle>
          <WizardBody>{t("wizard.confirm.subtitle", { email: normalizeEmail(email) })}</WizardBody>
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
                setSub("welcome");
                setCode("");
                setErrorText(null);
              }}
              disabled={signingIn}
            />
          </View>
        </>
      )}

      {errorText ? (
        <AppText
          variant="technicalCaption"
          style={{ color: theme.colors.danger, textAlign: "center" }}
        >
          {errorText}
        </AppText>
      ) : null}
    </WizardShell>
  );
}

function inputStyle(theme: ReturnType<typeof useTheme>) {
  return {
    borderWidth: 1,
    borderRadius: theme.radius.md,
    borderColor: theme.colors.surfaceBorder,
    color: theme.colors.textPrimary,
  };
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
  form: {
    gap: 10,
  },
  input: {
    height: 52,
    fontSize: 16,
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
    borderRadius: 12,
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
  },
  footerGap: {
    gap: 12,
  },
});
