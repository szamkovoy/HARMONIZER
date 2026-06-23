import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { inlineBaseLocale } from "@/modules/i18n/localeCodes";

export type AuthScreensLocale = AppContentLocale;

type SignInStrings = {
  title: string;
  subtitle: string;
  googleButton: string;
  legal: string;
};

type OnboardingStrings = {
  title: string;
  subtitle: string;
  allowButton: string;
  skipButton: string;
  deniedError: string;
};

const ruSignIn: SignInStrings = {
  title: "Harmonizer",
  subtitle: "Войдите, чтобы синхронизировать практики и получать ежедневные рекомендации.",
  googleButton: "Войти через Google",
  legal: "Нажимая кнопку входа, вы соглашаетесь с обработкой персональных данных.",
};

const enSignIn: SignInStrings = {
  title: "Harmonizer",
  subtitle: "Sign in to sync your practices and receive daily guidance.",
  googleButton: "Sign in with Google",
  legal: "By signing in, you agree to the processing of your personal data.",
};

const ruOnboarding: OnboardingStrings = {
  title: "Геолокация",
  subtitle:
    "Чтобы показывать окна возможностей, нам нужны ваши координаты. Они сохраняются только в профиле.",
  allowButton: "Разрешить",
  skipButton: "Без геолокации",
  deniedError:
    "Разрешение на геолокацию не получено. Вы можете продолжить без неё и указать координаты позже в настройках.",
};

const enOnboarding: OnboardingStrings = {
  title: "Geolocation",
  subtitle:
    "We need your coordinates to show opportunity windows. They are stored only in your profile.",
  allowButton: "Allow",
  skipButton: "Continue without location",
  deniedError:
    "Location permission was not granted. You can continue without it and add coordinates later in settings.",
};

export function getSignInStrings(locale: AuthScreensLocale = "ru"): SignInStrings {
  return inlineBaseLocale(locale) === "en" ? enSignIn : ruSignIn;
}

export function getOnboardingStrings(locale: AuthScreensLocale = "ru"): OnboardingStrings {
  return inlineBaseLocale(locale) === "en" ? enOnboarding : ruOnboarding;
}
