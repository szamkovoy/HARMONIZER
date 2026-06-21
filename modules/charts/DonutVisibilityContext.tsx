import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

type DonutVisibilityContextValue = {
  register: (listener: () => void) => () => void;
  notifyVisibilityCheck: () => void;
};

const DonutVisibilityContext = createContext<DonutVisibilityContextValue | null>(null);

export function DonutVisibilityProvider({ children }: { children: ReactNode }) {
  const listenersRef = useMemo(() => new Set<() => void>(), []);

  const register = useCallback((listener: () => void) => {
    listenersRef.add(listener);
    return () => {
      listenersRef.delete(listener);
    };
  }, [listenersRef]);

  const notifyVisibilityCheck = useCallback(() => {
    listenersRef.forEach((listener) => listener());
  }, [listenersRef]);

  const value = useMemo(
    () => ({ register, notifyVisibilityCheck }),
    [register, notifyVisibilityCheck],
  );

  return <DonutVisibilityContext.Provider value={value}>{children}</DonutVisibilityContext.Provider>;
}

export function useDonutVisibilityContext() {
  return useContext(DonutVisibilityContext);
}

export function useDonutScrollProps() {
  const context = useDonutVisibilityContext();
  return {
    scrollEventThrottle: 16 as const,
    onScroll: (_event: NativeSyntheticEvent<NativeScrollEvent>) => {
      context?.notifyVisibilityCheck();
    },
  };
}

export function useDonutVisibilityRefresh() {
  const context = useDonutVisibilityContext();
  return useCallback(() => {
    context?.notifyVisibilityCheck();
  }, [context]);
}
