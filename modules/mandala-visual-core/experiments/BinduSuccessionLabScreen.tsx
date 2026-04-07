import { useEffect, useState } from "react";
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";

import { BinduSuccessionLabCanvas } from "@/modules/mandala-visual-core/experiments/BinduSuccessionLabCanvas";

const DENSITY_OPTIONS = [
  { label: "Airy", value: 0.18 },
  { label: "Balanced", value: 0.5 },
  { label: "Dense", value: 0.84 },
] as const;

const TUBE_FLOW_SPEED = 0.72;

export function BinduSuccessionLabScreen() {
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [sceneOffset, setSceneOffset] = useState(0);
  const [densityBias, setDensityBias] = useState<number>(0.5);
  const [isPaused, setIsPaused] = useState(false);
  const [debugGeometry, setDebugGeometry] = useState(false);
  const [sessionSeed, setSessionSeed] = useState(1);
  const isRenderActive = isFocused && appState === "active" && !isPaused;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <BinduSuccessionLabCanvas
          isActive={isRenderActive}
          sceneOffset={sceneOffset}
          densityBias={densityBias}
          sessionSeed={sessionSeed}
          flowSpeed={TUBE_FLOW_SPEED}
          debugGeometry={debugGeometry}
        />

        <View style={styles.topOverlay}>
          <Text style={styles.eyebrow}>Experimental Video Meditation Lab</Text>
          <Text style={styles.title}>Bindu Succession</Text>
          <Text style={styles.subtitle}>
            Из центра рождается следующая мандала, наследуя геном предыдущей и постепенно кристаллизуясь к сакральному аттрактору.
          </Text>
          <Text style={styles.modeBadge}>Continuous tube succession · bindu birth flow · x{TUBE_FLOW_SPEED}</Text>
        </View>

        <View style={styles.bottomOverlay}>
          <View style={styles.chipRow}>
            {DENSITY_OPTIONS.map((option) => {
              const isActive = Math.abs(option.value - densityBias) < 0.001;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => setDensityBias(option.value)}
                  style={[styles.chip, isActive && styles.chipActive]}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actionRow}>
            <Pressable
              onPress={() => {
                setSceneOffset(0);
                setSessionSeed((current) => current + 1);
              }}
              style={[styles.button, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonText}>Новая линия</Text>
            </Pressable>
            <Pressable
              onPress={() => setSceneOffset((current) => current + 1)}
              style={[styles.button, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonText}>Следующая мандала</Text>
            </Pressable>
            <Pressable
              onPress={() => setDebugGeometry((current) => !current)}
              style={[styles.button, styles.secondaryButton, debugGeometry && styles.debugButtonActive]}
            >
              <Text style={[styles.secondaryButtonText, debugGeometry && styles.debugButtonTextActive]}>
                Геометрия
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setIsPaused((current) => !current)}
              style={[styles.button, styles.primaryButton]}
            >
              <Text style={styles.primaryButtonText}>
                {isPaused ? "Продолжить" : "Пауза"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#000000",
  },
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  topOverlay: {
    position: "absolute",
    top: 12,
    left: 16,
    right: 16,
    gap: 6,
  },
  eyebrow: {
    color: "rgba(226, 232, 255, 0.72)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    color: "rgba(228, 232, 255, 0.78)",
    fontSize: 14,
    lineHeight: 19,
    maxWidth: 420,
  },
  modeBadge: {
    alignSelf: "flex-start",
    marginTop: 2,
    borderRadius: 999,
    backgroundColor: "rgba(22, 26, 44, 0.88)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#f3e6ff",
    fontSize: 12,
    fontWeight: "700",
  },
  bottomOverlay: {
    position: "absolute",
    right: 16,
    bottom: 20,
    left: 16,
    gap: 12,
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(18, 24, 40, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  chipActive: {
    backgroundColor: "#c99cff",
    borderColor: "#c99cff",
  },
  chipText: {
    color: "#ebf0ff",
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#120f1f",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  button: {
    flexGrow: 1,
    flexBasis: 110,
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButton: {
    backgroundColor: "#7a8cff",
  },
  secondaryButton: {
    backgroundColor: "rgba(18, 24, 40, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  debugButtonActive: {
    borderColor: "#c99cff",
    backgroundColor: "rgba(58, 34, 78, 0.92)",
  },
  primaryButtonText: {
    color: "#081022",
    fontWeight: "700",
  },
  secondaryButtonText: {
    color: "#ecf1ff",
    fontWeight: "600",
  },
  debugButtonTextActive: {
    color: "#f6dcff",
  },
});
