import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, View, type GestureResponderEvent } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "react-native-reanimated";

import { installDevLoadingViewPatch } from "@/modules/dev/patchDevLoadingView";

installDevLoadingViewPatch();

import { AccessProvider } from "@/modules/access";
import { MembershipEventsBridge } from "@/modules/account";
import { AuthProvider, useAuth } from "@/modules/auth";
import { EarlySplashCover } from "@/modules/bootstrap/EarlySplashCover";
import { AppStartupProvider, useAppStartup } from "@/modules/bootstrap/AppStartupProvider";
import { hydrateAppLocale } from "@/modules/i18n";
import { PushRegistrationBridge } from "@/modules/notifications";
import { RemotePlayProvider } from "@/modules/remote-play";
import { StorySessionBootstrap } from "@/modules/stories";
import { ThemeProvider as UiThemeProvider, buildTheme, useTheme } from "@/modules/ui/theme";
import { useThemePreference } from "@/modules/ui/themePreference";
import { configureLocalNotifications } from "@/services/localNotifications";
import { logRuntimeEvent, logRuntimeTap, useRuntimeDiagnosticsSampler } from "@/services/runtimeDiagnostics";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 0, fade: false });

/** After fonts: keep native hidden only once the JS startup splash has painted. */
function NativeSplashBridge() {
  const { jsSplashPainted } = useAppStartup();
  useEffect(() => {
    if (!jsSplashPainted) return;
    void SplashScreen.hideAsync();
  }, [jsSplashPainted]);
  return null;
}

export default function RootLayout() {
  // Палитра — явный выбор пользователя (default light), не system color scheme.
  const { scheme: paletteScheme } = useThemePreference();
  const uiTheme = useMemo(() => buildTheme(paletteScheme), [paletteScheme]);
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });
  const nativeHiddenRef = useRef(false);
  const [earlySplashDone, setEarlySplashDone] = useState(false);

  const hideNativeSplash = useCallback(() => {
    if (nativeHiddenRef.current) return;
    nativeHiddenRef.current = true;
    void SplashScreen.hideAsync();
    setEarlySplashDone(true);
  }, []);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    configureLocalNotifications();
  }, []);

  // Until fonts load: full-bleed cover replaces the tiny native Android/iOS logo splash.
  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
        <EarlySplashCover onPainted={hideNativeSplash} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <UiThemeProvider value={uiTheme}>
        <AuthProvider>
          <AppStartupProvider>
            <RemotePlayProvider>
              <AccessBridge>
                {/* If early cover already hid native, bridge is a no-op after paint. */}
                {!earlySplashDone ? <NativeSplashBridge /> : null}
                <PushRegistrationBridge />
                <StorySessionBootstrap />
                <MembershipEventsBridge />
                <RootLayoutNav />
              </AccessBridge>
            </RemotePlayProvider>
          </AppStartupProvider>
        </AuthProvider>
      </UiThemeProvider>
    </SafeAreaProvider>
  );
}

function AccessBridge({ children }: { children: ReactNode }) {
  const { profile, authUser } = useAuth();
  useEffect(() => {
    // First login / account switch: users.locale wins over sticky SecureStore.
    // Same account: UI wins if DB lagged (see hydrateAppLocale).
    void hydrateAppLocale(profile?.locale, authUser?.id ?? null);
  }, [authUser?.id, profile?.locale]);
  return <AccessProvider profile={profile}>{children}</AccessProvider>;
}

/**
 * Авто-редиректы на основании auth-состояния.
 *
 *   • нет сессии           → /sign-in
 *   • есть сессия + нет onboarded_at → /onboarding
 *   • всё готово           → текущий маршрут (или (tabs) если пришли с /sign-in)
 *
 * `useSegments()` возвращает массив сегментов текущего маршрута — по нему мы
 * понимаем, где сейчас пользователь, и НЕ перенаправляем, если он уже на
 * нужном экране (иначе будет бесконечный цикл).
 */
/** Не редиректить на /sign-in сразу при кратковременном session=null после того как пользователь уже был залогинен (refresh / transient SDK). */
const SIGN_IN_AFTER_NULL_SESSION_MS = 500;

/** Полные данные рождения = дата + время + место (строка birth_place ИЛИ координаты lat/lon).
 *  Без любогоого из них мастер должен показать шаг 2 (ввод даты/времени/места + геогейт),
 *  даже если onboarded_at уже проставлен (краевые случаи: сбой при первом вводе,
 *  возвращение пользователя на новом устройстве без синхронизированных данных). */
function birthDataComplete(profile: { birth_date?: string | null; birth_time?: string | null; birth_place?: unknown; lat?: number | null; lon?: number | null } | null): boolean {
  if (!profile) return false;
  const hasPlace = (profile.birth_place != null && String(profile.birth_place).trim() !== "") ||
    (typeof profile.lat === "number" && typeof profile.lon === "number");
  return Boolean(profile.birth_date && profile.birth_date.trim()) &&
    Boolean(profile.birth_time && profile.birth_time.trim()) &&
    hasPlace;
}

function useAuthRouteGate() {
  const { session, profile, profileLoading, initializing } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const everHadSessionRef = useRef(false);
  const signInDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (session) everHadSessionRef.current = true;
  }, [session]);

  useEffect(() => {
    if (signInDelayTimerRef.current) {
      clearTimeout(signInDelayTimerRef.current);
      signInDelayTimerRef.current = null;
    }

    if (initializing) return;
    // Пока тянем profile после смены session — не принимаем решений про
    // onboarding, иначе возвращающийся пользователь мигнёт на /onboarding.
    if (session && profileLoading) return;

    const current = segments[0] as string | undefined;
    const isOnAuth = current === "sign-in";
    const isOnOnboarding = current === "onboarding";

    // typed-routes ещё не знает про новые файлы до первого `expo start`,
    // поэтому кастуем через Href — после регена типов каст можно убрать.
    if (!session) {
      if (!isOnAuth) {
        if (everHadSessionRef.current) {
          signInDelayTimerRef.current = setTimeout(() => {
            signInDelayTimerRef.current = null;
            router.replace("/sign-in" as Href);
          }, SIGN_IN_AFTER_NULL_SESSION_MS);
        } else {
          router.replace("/sign-in" as Href);
        }
      }
      return () => {
        if (signInDelayTimerRef.current) {
          clearTimeout(signInDelayTimerRef.current);
          signInDelayTimerRef.current = null;
        }
      };
    }
    if (profile && (!profile.onboarded_at || !birthDataComplete(profile))) {
      if (!isOnOnboarding) router.replace("/onboarding" as Href);
      return;
    }
    if (isOnAuth || isOnOnboarding) {
      router.replace("/");
    }
    return undefined;
  }, [initializing, session, profileLoading, profile?.onboarded_at, profile?.birth_date, profile?.birth_time, profile?.birth_place, profile?.lat, profile?.lon, segments, router]);
}

function RootLayoutNav() {
  const theme = useTheme();
  const { initializing, session, profile, profileLoading } = useAuth();
  const { setHomeRouteActive } = useAppStartup();
  const segments = useSegments();
  useAuthRouteGate();
  useRuntimeDiagnosticsSampler();

  const routePath = segments.join("/") || "/";
  const isHomeRoute = (segments[0] as string | undefined) === "(tabs)" && segments[1] == null;
  // Только первый cold-start, пока `profile` ещё null. Повторный refreshProfile
  // (foreground / realtime) не должен размонтировать табы и Communicator —
  // иначе открытый диалог сбрасывается при уходе в Health и обратно.
  const waitingForProfile = Boolean(session) && profileLoading && profile == null;

  useEffect(() => {
    setHomeRouteActive(isHomeRoute);
  }, [isHomeRoute, setHomeRouteActive]);

  useEffect(() => {
    logRuntimeEvent("screen:route", { routePath });
  }, [routePath]);

  const handleRootTouch = (event: GestureResponderEvent) => {
    const touch = event.nativeEvent;
    logRuntimeTap("root", {
      routePath,
      locationX: Math.round(touch.locationX),
      locationY: Math.round(touch.locationY),
      pageX: Math.round(touch.pageX),
      pageY: Math.round(touch.pageY),
    });
  };

  // Пока читаем сессию / профиль — белый фон как у сплэша (не dark screenBg),
  // иначе на Android с тёмной системной темой мигает чёрный кадр под оверлеем.
  // Сплэш-скрин Expo уже скрыт (fonts loaded); JS-оверлей рисует картинку сверху.
  if (initializing || waitingForProfile) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#ffffff",
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }} onTouchStart={handleRootTouch}>
      <NavThemeProvider value={theme.scheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="sign-in"
            options={{ headerShown: false, animation: "fade" }}
          />
          <Stack.Screen
            name="onboarding"
            options={{ headerShown: false, animation: "fade" }}
          />
          <Stack.Screen
            name="calibration"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="mandala-sandbox"
            options={{ title: "Mandala Sandbox", headerBackTitle: "Back" }}
          />
          <Stack.Screen
            name="biofeedback-probe"
            options={{ title: "Biofeedback Probe", headerBackTitle: "Back" }}
          />
          <Stack.Screen
            name="biofeedback-parity"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="bindu-succession-lab"
            options={{ title: "Bindu Succession Lab", headerBackTitle: "Back" }}
          />
          <Stack.Screen
            name="sacred-symbol-stream"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="asana-practice"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="connect-tv"
            options={{ presentation: "fullScreenModal", headerShown: false }}
          />
          <Stack.Screen
            name="tv-remote"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="breath-coherence"
            options={{ headerShown: false }}
          />
          <Stack.Screen name="post/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="webinar/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="my-notifications" options={{ headerShown: false }} />
          <Stack.Screen name="push-message" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: "modal" }} />
        </Stack>
      </NavThemeProvider>
    </View>
  );
}
