import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image, StyleSheet, View } from "react-native";

import { useAuth } from "@/modules/auth";
import { AppText } from "@/modules/ui/AppText";

export type AppStartupPhase = "app_loading" | "initializing" | "loading_day";

type HomeBootstrapState = {
  blocking: boolean;
  phase: AppStartupPhase;
  /** Internal step id (maps to friendly footer copy). */
  step: string;
};

type AppStartupContextValue = {
  beginHomeBootstrap: (phase: AppStartupPhase, step?: string) => void;
  setHomeBootstrapPhase: (phase: AppStartupPhase, step?: string) => void;
  /** Finer-grained step without changing `phase` (same progress curve). */
  setStartupStep: (step: string) => void;
  completeHomeBootstrap: () => void;
  setHomeRouteActive: (active: boolean) => void;
};

const AppStartupContext = createContext<AppStartupContextValue | null>(null);

/** Короткие уникальные фразы: по скриншоту можно отличить этап, без техно-жаргона. */
const STEP_COPY: Record<string, { ru: string; en: string }> = {
  "AUTH/secure_session": {
    ru: "Возвращаем вас в приложение",
    en: "Welcoming you back",
  },
  "AUTH/users_profile": {
    ru: "Подтягиваем ваши настройки",
    en: "Loading your preferences",
  },
  "AUTH/wait_profile_refresh": {
    ru: "Профиль почти на месте",
    en: "Your profile is almost ready",
  },
  "HOME/js_bridge": {
    ru: "Подключаем главный экран",
    en: "Opening your Home screen",
  },
  "HOME/home_overlay_start": {
    ru: "Сверяем сегодняшний день",
    en: "Checking in with today",
  },
  "HOME/gps_acquire_persist": {
    ru: "Уточняем ваш город",
    en: "Pinning your area gently",
  },
  "HOME/day_cache_async_read": {
    ru: "Смотрим сохранённый день",
    en: "Recalling your saved day",
  },
  "HOME/api_global_free": {
    ru: "Собираем общий настрой дня",
    en: "Gathering today’s shared tone",
  },
  "HOME/api_daily_forecast": {
    ru: "Считаем ваш личный день",
    en: "Shaping your personal day",
  },
  "HOME/api_morning_monologue": {
    ru: "Добавляем мягкий совет",
    en: "Adding a gentle suggestion",
  },
};

function preferredLocale(raw?: string | null): "ru" | "en" {
  if ((raw ?? "").toLowerCase().startsWith("en")) return "en";
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.toLowerCase().startsWith("en") ? "en" : "ru";
  } catch {
    return "ru";
  }
}

function fallbackStepCopy(locale: "ru" | "en"): string {
  return locale === "en" ? "Finishing a quiet moment" : "Завершаем спокойную подготовку";
}

function startupFooterText(locale: "ru" | "en", step: string): string {
  const row = STEP_COPY[step];
  return row ? (locale === "en" ? row.en : row.ru) : fallbackStepCopy(locale);
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

function AppStartupOverlay({ visible, step, locale }: { visible: boolean; step: string; locale: "ru" | "en" }) {
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
          useNativeDriver: true,
        }),
        Animated.timing(logoBreath, {
          toValue: 0,
          duration: 7200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
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
    outputRange: [-140, 140],
  });

  const shimmerOpacity = shimmer.interpolate({
    inputRange: [0, 0.12, 0.5, 0.88, 1],
    outputRange: [0, 0.07, 0.11, 0.07, 0],
  });

  return (
    <Animated.View pointerEvents="auto" style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]}>
      <View style={styles.centerStage}>
        <View style={styles.logoShell}>
          <Animated.View style={[styles.logoClip, { opacity: logoOpacity }]}>
            <Image source={require("@/assets/images/splash-icon.png")} style={styles.logoImage} resizeMode="contain" />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.shimmerStripe,
                {
                  opacity: shimmerOpacity,
                  transform: [{ translateX: shimmerTranslate }, { rotate: "18deg" }],
                },
              ]}
            />
          </Animated.View>
        </View>
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
          {startupFooterText(locale, step)}
        </AppText>
      </View>
    </Animated.View>
  );
}

export function AppStartupProvider({ children }: { children: ReactNode }) {
  const { initializing, profile, profileLoading } = useAuth();
  const locale = preferredLocale(profile?.locale);
  const [isHomeRoute, setHomeRouteActive] = useState(true);
  const [homeBootstrap, setHomeBootstrap] = useState<HomeBootstrapState>({
    blocking: true,
    phase: "app_loading",
    step: "HOME/js_bridge",
  });

  const visible = initializing || (isHomeRoute && homeBootstrap.blocking);

  const authStep = initializing ? "AUTH/secure_session" : profileLoading ? "AUTH/users_profile" : null;
  const footerStep = authStep ?? homeBootstrap.step;

  const beginHomeBootstrap = useCallback((nextPhase: AppStartupPhase, nextStep?: string) => {
    setHomeBootstrap((current) => ({
      blocking: true,
      phase: nextPhase,
      step: nextStep ?? current.step,
    }));
  }, []);

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
    setHomeBootstrap((current) => ({ ...current, blocking: false }));
  }, []);

  useEffect(() => {
    if (initializing) {
      setHomeBootstrap((current) => ({ ...current, blocking: true, phase: "initializing", step: "AUTH/secure_session" }));
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

  return (
    <AppStartupContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <AppStartupOverlay visible={visible} step={footerStep} locale={locale} />
      </View>
    </AppStartupContext.Provider>
  );
}

export function useAppStartup(): AppStartupContextValue {
  const value = useContext(AppStartupContext);
  if (!value) throw new Error("useAppStartup must be used inside AppStartupProvider.");
  return value;
}

const LOGO_SIZE = 268;

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
    paddingHorizontal: 28,
    paddingBottom: 56,
  },
  logoShell: {
    marginTop: -52,
    alignItems: "center",
    justifyContent: "center",
  },
  logoClip: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  logoImage: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  shimmerStripe: {
    position: "absolute",
    width: LOGO_SIZE * 0.38,
    height: LOGO_SIZE * 1.35,
    backgroundColor: "rgba(17, 182, 183, 0.22)",
  },
  bottomStage: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 48,
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
});
