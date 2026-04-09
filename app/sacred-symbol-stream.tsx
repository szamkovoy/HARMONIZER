import { StatusBar } from "expo-status-bar";

import { SacredSymbolStreamScreen } from "@/modules/mandala/experiments/SacredSymbolStreamScreen";

export default function SacredSymbolStreamRoute() {
  return (
    <>
      <StatusBar style="light" />
      <SacredSymbolStreamScreen />
    </>
  );
}
