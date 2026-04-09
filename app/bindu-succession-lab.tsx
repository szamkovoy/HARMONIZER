import { StatusBar } from "expo-status-bar";

import { BinduSuccessionLabScreen } from "@/modules/mandala/experiments/BinduSuccessionLabScreen";

export default function BinduSuccessionLabRoute() {
  return (
    <>
      <StatusBar style="light" />
      <BinduSuccessionLabScreen />
    </>
  );
}
