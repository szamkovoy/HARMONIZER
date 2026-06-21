import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

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
  const notify = useCallback(() => {
    context?.notifyVisibilityCheck();
  }, [context]);
  return {
    scrollEventThrottle: 16 as const,
    onScroll: notify,
    onMomentumScrollEnd: notify,
    onScrollEndDrag: notify,
    onContentSizeChange: notify,
  };
}

export function useDonutVisibilityRefresh() {
  const context = useDonutVisibilityContext();
  return useCallback(() => {
    context?.notifyVisibilityCheck();
  }, [context]);
}
