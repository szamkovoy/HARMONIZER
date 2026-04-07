import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";

import { BinduSuccessionLabCanvas } from "@/modules/mandala-visual-core/experiments/BinduSuccessionLabCanvas";

const TUBE_FLOW_SPEED = 1;

export function BinduSuccessionLabScreen() {
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const isRenderActive = isFocused && appState === "active";

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
          sceneOffset={0}
          densityBias={0.84}
          sessionSeed={1}
          flowSpeed={TUBE_FLOW_SPEED}
          debugGeometry={false}
        />
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
});
