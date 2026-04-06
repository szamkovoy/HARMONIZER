import { StatusBar } from "expo-status-bar";

import { MandalaSandboxScreen } from "@/modules/mandala-visual-core/ui/MandalaSandboxScreen";

export default function MandalaSandboxRoute() {
  return (
    <>
      <StatusBar style="light" />
      <MandalaSandboxScreen />
    </>
  );
}
