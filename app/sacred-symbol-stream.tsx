import { StatusBar } from "expo-status-bar";

import { SacredSymbolStreamScreen } from "@/modules/mandala-visual-core/experiments/SacredSymbolStreamScreen";

export default function SacredSymbolStreamRoute() {
  return (
    <>
      <StatusBar style="light" />
      <SacredSymbolStreamScreen />
    </>
  );
}
