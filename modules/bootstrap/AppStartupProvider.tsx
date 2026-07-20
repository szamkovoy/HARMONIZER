import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, useWindowDimensions, View } from "react-native";

import splashImage from "@/assets/splashSource";
import { useAuth } from "@/modules/auth";
import { coerceAppLocale, t, type AppLocale, useAppLocale } from "@/modules/i18n";
import { AppText } from "@/modules/ui/AppText";

export type AppStartupPhase = "app_loading" | "initializing" | "loading_day";

/**
 * `splash` — полная заставка (холодный старт / первая готовность Home).
 * `day_card` — карточка «Готовим ваш день» поверх уже открытого приложения
 * (смена натала с Профиля, ролловер дня, повторный blocking reload).
 */
export type HomeBootstrapPresentation = "splash" | "day_card";

type HomeBootstrapState = {
  blocking: boolean;
  phase: AppStartupPhase;
  /** Internal step id (maps to friendly footer copy on splash). */
  step: string;
  presentation: HomeBootstrapPresentation;
};

type AppStartupContextValue = {
  beginHomeBootstrap: (
    phase: AppStartupPhase,
    step?: string,
    opts?: { presentation?: HomeBootstrapPresentation },
  ) => void;
  setHomeBootstrapPhase: (phase: AppStartupPhase, step?: string) => void;
  /** Finer-grained step without changing `phase` (same progress curve). */
  setStartupStep: (step: string) => void;
  completeHomeBootstrap: () => void;
  setHomeRouteActive: (active: boolean) => void;
};

const AppStartupContext = createContext<AppStartupContextValue | null>(null);

/** Maps internal bootstrap step ids to flat catalog keys under `startup.step.*`. */
function startupStepKey(step: string): string {
  return `startup.step.${step.replace(/\//g, "_")}`;
}

function startupFooterText(locale: AppLocale, step: string): string {
  const key = startupStepKey(step);
  const copy = t(locale, key);
  if (copy !== key) return copy;
  return t(locale, "startup.fallback");
}

/** Indeterminate progress: 0→80% fast, then slower to 90%, then to 95%, hold until done. */
function useSplashProgress(visible: boolean, progress: Animated.Value) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!visible) {
      startMsRef.current = null;
      Animated.timing(progress, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
      return;
    }

    progress.setValue(0);
    startMsRef.current = Date.now();
    const tick = () => {
      const start = startMsRef.current;
      if (!start) return;
      const elapsed = Date.now() - start;
      const t0 = 2400;
      const t1 = t0 + 5200;
      const t2 = t1 + 11000;
      let p: number;
      if (elapsed < t0) {
        p = (elapsed / t0) * 0.8;
      } else if (elapsed < t1) {
        p = 0.8 + ((elapsed - t0) / (t1 - t0)) * 0.1;
      } else if (elapsed < t2) {
        p = 0.9 + ((elapsed - t1) / (t2 - t1)) * 0.05;
      } else {
        p = 0.95;
      }
      progress.setValue(p);
    };
    tick();
    timerRef.current = setInterval(tick, 120);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [progress, visible]);
}

function DayWaitCardOverlay({ visible, locale }: { visible: boolean; locale: AppLocale }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.stopAnimation();
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [opacity, visible]);

  if (!mounted) return null;

  return (
    <Animated.View pointerEvents="auto" style={[StyleSheet.absoluteFill, styles.dayWaitRoot, { opacity }]}>
      <View style={styles.dayWaitCard}>
        <ActivityIndicator size="large" color="#11B6B7" />
        <AppText variant="sectionTitle" style={styles.dayWaitTitle}>
          {t(locale, "wizard.warm.title")}
        </AppText>
        <AppText variant="screenHint" tone="muted" style={styles.dayWaitBody}>
          {t(locale, "wizard.warm.body")}
        </AppText>
      </View>
    </Animated.View>
  );
}

function AppStartupSplashOverlay({ visible, step, locale }: { visible: boolean; step: string; locale: AppLocale }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const opacity = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const logoBreath = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(true);
  useSplashProgress(visible, progress);

  useEffect(() => {
    if (!visible) {
      logoBreath.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoBreath, {
          toValue: 1,
          duration: 7200,
          easing: Easing.inOut(Easing.quad),
          /* opacity родителя + Image.cover: при true на iOS/Fabric возможен неверный scale (виден лишний край). */
          useNativeDriver: false,
        }),
        Animated.timing(logoBreath, {
          toValue: 0,
          duration: 7200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [logoBreath, visible]);

  useEffect(() => {
    if (!visible) {
      shimmer.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 16800,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer, visible]);

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

  const logoOpacity = logoBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.58, 0.74],
  });

  const shimmerTranslate = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-winW * 0.85, winW * 0.85],
  });

  const shimmerOpacity = shimmer.interpolate({
    inputRange: [0, 0.12, 0.5, 0.88, 1],
    outputRange: [0, 0.07, 0.11, 0.07, 0],
  });

  return (
    <Animated.View pointerEvents="auto" style={[StyleSheet.absoluteFill, styles.splashOverlay, { opacity }]}>
      {/* Полный кадр как expo.splash (resizeMode: cover): явные размеры экрана — надёжнее, чем absoluteFill для cover */}
      <Animated.View
        style={[
          styles.splashImageWrap,
          {
            width: winW,
            height: winH,
            opacity: logoOpacity,
          },
        ]}
      >
        <Image source={splashImage} style={{ width: winW, height: winH }} resizeMode="cover" />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shimmerStripe,
            {
              top: winH * -0.12,
              width: winW * 0.42,
              height: winH * 1.35,
              opacity: shimmerOpacity,
              transform: [{ translateX: shimmerTranslate }, { rotate: "18deg" }],
            },
          ]}
        />
      </Animated.View>

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
          {startupFooterText(locale, step)}
        </AppText>
      </View>
    </Animated.View>
  );
}

export function AppStartupProvider({ children }: { children: ReactNode }) {
  const { initializing, profileLoading } = useAuth();
  const { locale } = useAppLocale();
  const appLocale = coerceAppLocale(locale);

  const [isHomeRoute, setHomeRouteActive] = useState(true);
  /** После первого успешного complete — повторные ожидания дня идут карточкой, не полной заставкой. */
  const hasCompletedHomeOnceRef = useRef(false);
  const [homeBootstrap, setHomeBootstrap] = useState<HomeBootstrapState>({
    blocking: true,
    phase: "app_loading",
    step: "HOME/js_bridge",
    presentation: "splash",
  });

  const visible = initializing || (isHomeRoute && homeBootstrap.blocking);
  /**
   * Auth recovery всегда полная заставка.
   * Иначе — то, что выставил `beginHomeBootstrap` (cold start → splash по умолчанию;
   * после первого complete / явный `blockingReload` → day_card).
   */
  const presentation: HomeBootstrapPresentation = initializing
    ? "splash"
    : homeBootstrap.presentation;

  const authStep = initializing ? "AUTH/secure_session" : profileLoading ? "AUTH/users_profile" : null;
  const footerStep = authStep ?? homeBootstrap.step;

  const beginHomeBootstrap = useCallback(
    (nextPhase: AppStartupPhase, nextStep?: string, opts?: { presentation?: HomeBootstrapPresentation }) => {
      const nextPresentation =
        opts?.presentation ?? (hasCompletedHomeOnceRef.current ? "day_card" : "splash");
      setHomeBootstrap((current) => ({
        blocking: true,
        phase: nextPhase,
        step: nextStep ?? current.step,
        presentation: nextPresentation,
      }));
    },
    [],
  );

  const setHomeBootstrapPhase = useCallback((nextPhase: AppStartupPhase, nextStep?: string) => {
    setHomeBootstrap((current) =>
      current.blocking
        ? {
            ...current,
            phase: nextPhase,
            step: nextStep ?? current.step,
          }
        : current,
    );
  }, []);

  const setStartupStep = useCallback((step: string) => {
    setHomeBootstrap((current) => (current.blocking ? { ...current, step } : current));
  }, []);

  const completeHomeBootstrap = useCallback(() => {
    hasCompletedHomeOnceRef.current = true;
    setHomeBootstrap((current) => ({ ...current, blocking: false }));
  }, []);

  useEffect(() => {
    if (initializing) {
      setHomeBootstrap((current) => ({
        ...current,
        blocking: true,
        phase: "initializing",
        step: "AUTH/secure_session",
        presentation: "splash",
      }));
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
      setStartupStep,
      completeHomeBootstrap,
      setHomeRouteActive,
    }),
    [beginHomeBootstrap, completeHomeBootstrap, setHomeBootstrapPhase, setStartupStep],
  );

  const splashVisible = visible && presentation === "splash";
  const dayCardVisible = visible && presentation === "day_card";

  return (
    <AppStartupContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <AppStartupSplashOverlay visible={splashVisible} step={footerStep} locale={appLocale} />
        <DayWaitCardOverlay visible={dayCardVisible} locale={appLocale} />
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
  splashOverlay: {
    backgroundColor: "#FFFFFF",
  },
  splashImageWrap: {
    position: "absolute",
    left: 0,
    top: 0,
    overflow: "hidden",
  },
  shimmerStripe: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "rgba(17, 182, 183, 0.22)",
  },
  bottomStage: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 48,
    zIndex: 2,
    alignItems: "center",
    gap: 8,
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
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  feedbackText: {
    textAlign: "center",
    fontSize: 12,
    lineHeight: 16,
  },
  dayWaitRoot: {
    backgroundColor: "rgba(2, 24, 39, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 20,
  },
  dayWaitCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    padding: 22,
    gap: 12,
    alignItems: "center",
  },
  dayWaitTitle: {
    textAlign: "center",
  },
  dayWaitBody: {
    textAlign: "center",
  },
});
