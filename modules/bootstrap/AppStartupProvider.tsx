import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image, StyleSheet, View } from "react-native";

import { useAuth } from "@/modules/auth";
import { AppText } from "@/modules/ui/AppText";

export type AppStartupPhase = "app_loading" | "initializing" | "loading_day";

type HomeBootstrapState = {
  blocking: boolean;
  phase: AppStartupPhase;
};

type AppStartupContextValue = {
  beginHomeBootstrap: (phase: AppStartupPhase) => void;
  setHomeBootstrapPhase: (phase: AppStartupPhase) => void;
  completeHomeBootstrap: () => void;
  setHomeRouteActive: (active: boolean) => void;
};

const AppStartupContext = createContext<AppStartupContextValue | null>(null);

function preferredLocale(raw?: string | null): "ru" | "en" {
  if ((raw ?? "").toLowerCase().startsWith("en")) return "en";
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.toLowerCase().startsWith("en") ? "en" : "ru";
  } catch {
    return "ru";
  }
}

function phaseText(locale: "ru" | "en", phase: AppStartupPhase, progress: number): string {
  if (phase === "app_loading") {
    const pct = Math.max(1, Math.min(99, Math.round(progress * 100)));
    return locale === "en" ? `Loading app ${pct}%` : `Загрузка приложения ${pct}%`;
  }
  if (phase === "loading_day") {
    return locale === "en" ? "Preparing and loading today's data..." : "Подготовка и загрузка данных дня...";
  }
  return locale === "en" ? "Initializing..." : "Инициализация...";
}

function targetProgress(phase: AppStartupPhase): number {
  if (phase === "app_loading") return 0.48;
  if (phase === "initializing") return 0.8;
  return 0.92;
}

function AppStartupOverlay({
  visible,
  phase,
  locale,
}: {
  visible: boolean;
  phase: AppStartupPhase;
  locale: "ru" | "en";
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0.08)).current;
  const [mounted, setMounted] = useState(true);
  const [progressValue, setProgressValue] = useState(0.08);

  useEffect(() => {
    const sub = progress.addListener(({ value }) => setProgressValue(value));
    return () => progress.removeListener(sub);
  }, [progress]);

  useEffect(() => {
    const target = visible ? targetProgress(phase) : 1;
    Animated.timing(progress, {
      toValue: target,
      duration: visible ? 900 : 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [phase, progress, visible]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [opacity, visible]);

  if (!mounted) return null;

  return (
    <Animated.View pointerEvents="auto" style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]}>
      <View style={styles.centerStage}>
        <Image source={require("@/assets/images/splash-icon.png")} style={styles.logo} resizeMode="contain" />
      </View>

      <View style={styles.bottomStage}>
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              {
                width: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>
        <AppText variant="screenHint" tone="muted" style={styles.feedbackText}>
          {phaseText(locale, phase, progressValue)}
        </AppText>
      </View>
    </Animated.View>
  );
}

export function AppStartupProvider({ children }: { children: ReactNode }) {
  const { initializing, profile } = useAuth();
  const locale = preferredLocale(profile?.locale);
  const [isHomeRoute, setHomeRouteActive] = useState(true);
  const [homeBootstrap, setHomeBootstrap] = useState<HomeBootstrapState>({
    blocking: true,
    phase: "app_loading",
  });

  const visible = initializing || (isHomeRoute && homeBootstrap.blocking);
  const phase: AppStartupPhase = initializing ? "initializing" : homeBootstrap.phase;

  const beginHomeBootstrap = useCallback((nextPhase: AppStartupPhase) => {
    setHomeBootstrap({ blocking: true, phase: nextPhase });
  }, []);

  const setHomeBootstrapPhase = useCallback((nextPhase: AppStartupPhase) => {
    setHomeBootstrap((current) => (current.blocking ? { ...current, phase: nextPhase } : current));
  }, []);

  const completeHomeBootstrap = useCallback(() => {
    setHomeBootstrap((current) => ({ ...current, blocking: false }));
  }, []);

  useEffect(() => {
    if (initializing) {
      setHomeBootstrap((current) => ({ ...current, blocking: true, phase: "initializing" }));
      return;
    }
    if (!isHomeRoute) {
      setHomeBootstrap((current) => ({ ...current, blocking: false }));
    }
  }, [initializing, isHomeRoute]);

  const value = useMemo<AppStartupContextValue>(
    () => ({
      beginHomeBootstrap,
      setHomeBootstrapPhase,
      completeHomeBootstrap,
      setHomeRouteActive,
    }),
    [beginHomeBootstrap, completeHomeBootstrap, setHomeBootstrapPhase],
  );

  return (
    <AppStartupContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <AppStartupOverlay visible={visible} phase={phase} locale={locale} />
      </View>
    </AppStartupContext.Provider>
  );
}

export function useAppStartup(): AppStartupContextValue {
  const value = useContext(AppStartupContext);
  if (!value) throw new Error("useAppStartup must be used inside AppStartupProvider.");
  return value;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  overlay: {
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
  },
  centerStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: {
    width: 220,
    height: 220,
  },
  bottomStage: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 56,
    alignItems: "center",
    gap: 14,
  },
  track: {
    width: "100%",
    height: 3,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(15, 23, 42, 0.08)",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#11B6B7",
    shadowColor: "#11B6B7",
    shadowOpacity: 0.45,
    shadowRadius: 8,
  },
  feedbackText: {
    textAlign: "center",
  },
});
