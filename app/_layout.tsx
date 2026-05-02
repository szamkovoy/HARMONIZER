import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "react-native-reanimated";

import { useColorScheme } from "@/components/useColorScheme";
import { AuthProvider, useAuth } from "@/modules/auth";
import { ThemeProvider as UiThemeProvider, buildTheme, useTheme } from "@/modules/ui/theme";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

/** Нативный сплэш держим до готовности шрифтов и первичной проверки сессии — меньше «белого экрана». */
function AuthSplashBridge({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { initializing } = useAuth();
  useEffect(() => {
    if (!fontsLoaded || initializing) return;
    void SplashScreen.hideAsync();
  }, [fontsLoaded, initializing]);
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

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <UiThemeProvider value={uiTheme}>
        <AuthProvider>
          <AuthSplashBridge fontsLoaded={loaded} />
          <RootLayoutNav />
        </AuthProvider>
      </UiThemeProvider>
    </SafeAreaProvider>
  );
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
function useAuthRouteGate() {
  const { session, profile, profileLoading, initializing } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
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
      if (!isOnAuth) router.replace("/sign-in" as Href);
      return;
    }
    if (!profile?.onboarded_at) {
      if (!isOnOnboarding) router.replace("/onboarding" as Href);
      return;
    }
    if (isOnAuth || isOnOnboarding) {
      router.replace("/");
    }
  }, [initializing, session, profileLoading, profile?.onboarded_at, segments, router]);
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const theme = useTheme();
  const { initializing } = useAuth();
  useAuthRouteGate();

  // Пока читаем сессию из SecureStore — держим фон текущей UI-темы, чтобы не мигало
  // на фоне стартового (tabs). Сплэш-скрин Expo уже скрыт (fonts loaded).
  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.screenBg,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
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
          name="mandala-sandbox"
          options={{ title: "Mandala Sandbox", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="biofeedback-probe"
          options={{ title: "Biofeedback Probe", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="bindu-succession-lab"
          options={{ title: "Bindu Succession Lab", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="sacred-symbol-stream"
          options={{ title: "Sacred Symbol Stream", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="breath-coherence"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="modal" options={{ presentation: "modal" }} />
      </Stack>
    </NavThemeProvider>
  );
}
