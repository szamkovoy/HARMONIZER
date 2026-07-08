import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ActivityIndicator, Platform, View, type GestureResponderEvent } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "react-native-reanimated";

import { useColorScheme } from "@/components/useColorScheme";
import { AccessProvider } from "@/modules/access";
import { AuthProvider, useAuth } from "@/modules/auth";
import { AppStartupProvider, useAppStartup } from "@/modules/bootstrap/AppStartupProvider";
import { hydrateAppLocale } from "@/modules/i18n";
import { PushRegistrationBridge } from "@/modules/notifications";
import { RemotePlayProvider } from "@/modules/remote-play";
import { StorySessionBootstrap } from "@/modules/stories";
import { ThemeProvider as UiThemeProvider, buildTheme, useTheme } from "@/modules/ui/theme";
import { configureLocalNotifications } from "@/services/localNotifications";
import { logRuntimeEvent, logRuntimeTap, useRuntimeDiagnosticsSampler } from "@/services/runtimeDiagnostics";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

/** Нативный сплэш держим до первого рендера JS-оверлея — дальше анимация уже под нашим контролем. */
function NativeSplashBridge({ fontsLoaded }: { fontsLoaded: boolean }) {
  useEffect(() => {
    if (!fontsLoaded) return;
    void SplashScreen.hideAsync();
  }, [fontsLoaded]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const uiTheme = useMemo(() => buildTheme(colorScheme === "dark" ? "dark" : "light"), [colorScheme]);
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    configureLocalNotifications();
  }, []);

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <UiThemeProvider value={uiTheme}>
        <AuthProvider>
          <AppStartupProvider>
            <RemotePlayProvider>
              <AccessBridge>
                <NativeSplashBridge fontsLoaded={loaded} />
                <PushRegistrationBridge />
                <StorySessionBootstrap />
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
  const { profile } = useAuth();
  useEffect(() => {
    // Load the persisted app locale once; seed from the profile locale if nothing
    // is stored yet. Idempotent — later calls are ignored.
    void hydrateAppLocale(profile?.locale);
  }, [profile?.locale]);
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
    if (profile && !profile.onboarded_at) {
      if (!isOnOnboarding) router.replace("/onboarding" as Href);
      return;
    }
    if (isOnAuth || isOnOnboarding) {
      router.replace("/");
    }
    return undefined;
  }, [initializing, session, profileLoading, profile?.onboarded_at, segments, router]);
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const theme = useTheme();
  const { initializing } = useAuth();
  const { setHomeRouteActive } = useAppStartup();
  const segments = useSegments();
  useAuthRouteGate();
  useRuntimeDiagnosticsSampler();

  const routePath = segments.join("/") || "/";
  const isHomeRoute = (segments[0] as string | undefined) === "(tabs)" && segments[1] == null;

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

  // Пока читаем сессию из SecureStore — держим фон текущей UI-темы, чтобы не мигало
  // на фоне стартового (tabs). Сплэш-скрин Expo уже скрыт (fonts loaded).
  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.screenBg,
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }} onTouchStart={handleRootTouch}>
      <NavThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
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
          <Stack.Screen name="modal" options={{ presentation: "modal" }} />
        </Stack>
      </NavThemeProvider>
    </View>
  );
}
