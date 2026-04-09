import { StatusBar } from "expo-status-bar";

import { MandalaSandboxScreen } from "@/modules/mandala/ui/MandalaSandboxScreen";

export default function MandalaSandboxRoute() {
  return (
    <>
      <StatusBar style="light" />
      <MandalaSandboxScreen />
    </>
  );
}
