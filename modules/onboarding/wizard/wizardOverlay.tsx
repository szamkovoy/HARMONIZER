/**
 * Хост оверлея поверх WizardShell (вне ScrollView).
 * Нужен на Android: absolute внутри ScrollView клипается, а RN Modal
 * снимает фокус с TextInput и прячет клавиатуру.
 *
 * Размер/origin хоста — через onLayout + measureInWindow на корне (flex:1).
 * Пустой absolute-слой на Android часто отдаёт height=0 в measureInWindow —
 * из‑за этого раньше список городов не монтировался.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { StyleSheet, View } from "react-native";

export type HostRect = { x: number; y: number; height: number };

export type WizardOverlayApi = {
  setOverlay: (node: ReactNode | null) => void;
  hostRef: RefObject<View | null>;
  /** Актуальный rect корня-хоста; null до первого onLayout. */
  hostRect: HostRect | null;
};

const WizardOverlayContext = createContext<WizardOverlayApi | null>(null);

export function useWizardOverlayHost(): WizardOverlayApi | null {
  return useContext(WizardOverlayContext);
}

export function WizardOverlayProvider({ children }: { children: ReactNode }) {
  const hostRef = useRef<View | null>(null);
  const [overlay, setOverlayState] = useState<ReactNode | null>(null);
  const [hostRect, setHostRect] = useState<HostRect | null>(null);

  const setOverlay = useCallback((node: ReactNode | null) => {
    setOverlayState(node);
  }, []);

  const syncHostRect = useCallback(() => {
    hostRef.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      setHostRect((prev) => {
        if (prev && prev.x === x && prev.y === y && prev.height === height) return prev;
        return { x, y, height };
      });
    });
  }, []);

  const value = useMemo(
    () => ({ setOverlay, hostRef, hostRect }),
    [setOverlay, hostRect],
  );

  return (
    <WizardOverlayContext.Provider value={value}>
      <View
        ref={hostRef}
        style={styles.root}
        collapsable={false}
        onLayout={syncHostRect}
      >
        {children}
        <View style={styles.layer} pointerEvents="box-none" collapsable={false}>
          {overlay}
        </View>
      </View>
    </WizardOverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
});
