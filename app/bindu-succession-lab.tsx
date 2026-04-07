import { StatusBar } from "expo-status-bar";

import { BinduSuccessionLabScreen } from "@/modules/mandala-visual-core/experiments/BinduSuccessionLabScreen";

export default function BinduSuccessionLabRoute() {
  return (
    <>
      <StatusBar style="light" />
      <BinduSuccessionLabScreen />
    </>
  );
}
