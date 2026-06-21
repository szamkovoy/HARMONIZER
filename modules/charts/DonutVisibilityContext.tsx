import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";

type DonutVisibilityContextValue = {
  register: (listener: () => void) => () => void;
  notifyVisibilityCheck: () => void;
  bumpRevealSession: () => void;
  revealSession: number;
  scrollRef: RefObject<ScrollView | null>;
  scrollYRef: { current: number };
  hasUserScrolledRef: { current: boolean };
};

const DonutVisibilityContext = createContext<DonutVisibilityContextValue | null>(null);

type DonutVisibilityProviderProps = {
  children: ReactNode;
  scrollRef?: RefObject<ScrollView | null>;
};

export function DonutVisibilityProvider({ children, scrollRef: scrollRefProp }: DonutVisibilityProviderProps) {
  const listenersRef = useMemo(() => new Set<() => void>(), []);
  const internalScrollRef = useRef<ScrollView | null>(null);
  const scrollRef = scrollRefProp ?? internalScrollRef;
  const scrollYRef = useRef(0);
  const hasUserScrolledRef = useRef(false);
  const [revealSession, setRevealSession] = useState(0);

  const register = useCallback((listener: () => void) => {
    listenersRef.add(listener);
    return () => {
      listenersRef.delete(listener);
    };
  }, [listenersRef]);

  const notifyVisibilityCheck = useCallback(() => {
    listenersRef.forEach((listener) => listener());
  }, [listenersRef]);

  const bumpRevealSession = useCallback(() => {
    setRevealSession((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({
      register,
      notifyVisibilityCheck,
      bumpRevealSession,
      revealSession,
      scrollRef,
      scrollYRef,
      hasUserScrolledRef,
    }),
    [register, notifyVisibilityCheck, bumpRevealSession, revealSession, scrollRef],
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

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (context) {
        context.scrollYRef.current = event.nativeEvent.contentOffset.y;
        if (event.nativeEvent.contentOffset.y > 0) {
          context.hasUserScrolledRef.current = true;
        }
      }
      notify();
    },
    [context, notify],
  );

  return {
    scrollEventThrottle: 16 as const,
    onScroll,
    onMomentumScrollEnd: notify,
    onScrollEndDrag: notify,
    onContentSizeChange: notify,
  };
}

export function useDonutVisibilityRefresh() {
  const context = useDonutVisibilityContext();
  return useCallback(() => {
    if (!context) return;
    context.bumpRevealSession();
    requestAnimationFrame(() => {
      context.notifyVisibilityCheck();
    });
  }, [context]);
}

export function useDonutRevealSession() {
  const context = useDonutVisibilityContext();
  return context?.revealSession ?? 0;
}
