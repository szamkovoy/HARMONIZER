import { StatusBar } from "expo-status-bar";

import { CoherenceBreathScreen } from "@/modules/breath/ui/CoherenceBreathScreen";

export default function BreathCoherenceRoute() {
  return (
    <>
      <StatusBar style="light" />
      <CoherenceBreathScreen locale="ru" />
    </>
  );
}
