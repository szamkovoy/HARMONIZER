/**
 * Экран входа. Apple (только iOS) + Google.
 *
 * Apple: `AppleAuthenticationButton` + `signInWithIdToken` (см. sign-in-apple.ts).
 * Кнопку «Войти с Apple» не показываем на Android и веб — только
 * `Platform.OS === "ios"` и успешный `isAvailableAsync()`.
 *
 * Google: кастомная кнопка в нашей палитре. Guidelines Google допускают
 * кастомное оформление, если оно содержит слова "Sign in with Google" и
 * распознаваемую иконку G.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { useAppLocale } from "@/modules/i18n";
import { getSignInStrings } from "@/modules/auth/i18n/authScreens";
import { AppText } from "@/modules/ui/AppText";
import { HeroScreenLayout } from "@/modules/ui/StackScreenLayout";
import { useTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";

export default function SignInScreen() {
  const theme = useTheme();
  const { locale } = useAppLocale();
  const strings = getSignInStrings(locale);
  const { signInWithApple, signInWithGoogle, signingIn } = useAuth();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      setAppleAvailable(false);
      return;
    }
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {
      setAppleAvailable(false);
    });
  }, []);

  async function tryApple() {
    setErrorText(null);
    try {
      await signInWithApple();
    } catch (e) {
      if ((e as { code?: string })?.code === "ERR_REQUEST_CANCELED") return;
      setErrorText(e instanceof Error ? e.message : String(e));
    }
  }

  async function tryGoogle() {
    setErrorText(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Sign in cancelled") return;
      setErrorText(msg);
    }
  }

  return (
    <HeroScreenLayout
      header={
        <View style={styles.header}>
          <AppText variant="screenTitle" style={styles.title}>
            {strings.title}
          </AppText>
          <AppText
            variant="screenHint"
            style={[styles.subtitle, { color: theme.colors.textMuted }]}
          >
            {strings.subtitle}
          </AppText>
        </View>
      }
      footer={
        <AppText
          variant="technicalCaption"
          style={[styles.footer, { color: theme.colors.textFaint }]}
        >
          {strings.legal}
        </AppText>
      }
    >
      <View style={styles.buttons}>
        {Platform.OS === "ios" && appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={
              theme.scheme === "dark"
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={theme.radius.md}
            style={styles.appleButton}
            onPress={tryApple}
          />
        ) : null}

        <Pressable
          onPress={tryGoogle}
          disabled={signingIn}
          style={({ pressed }) => [
            styles.googleButton,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
              opacity: pressed || signingIn ? 0.7 : 1,
              borderRadius: theme.radius.md,
            },
          ]}
        >
          <FontAwesome name="google" size={20} color={theme.colors.textPrimary} />
          <AppText variant="buttonLabel" style={{ color: theme.colors.textPrimary }}>
            {strings.googleButton}
          </AppText>
        </Pressable>

        {signingIn ? (
          <View style={styles.spinnerRow}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : null}

        {errorText ? (
          <AppText
            variant="technicalCaption"
            style={{ color: theme.colors.danger, textAlign: "center" }}
          >
            {errorText}
          </AppText>
        ) : null}
      </View>
    </HeroScreenLayout>
  );
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
  buttons: {
    gap: 12,
  },
  appleButton: {
    height: 52,
    width: "100%",
  },
  googleButton: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
  },
  spinnerRow: {
    alignItems: "center",
    paddingTop: 4,
  },
  footer: {
    textAlign: "center",
    marginTop: 24,
  },
});
