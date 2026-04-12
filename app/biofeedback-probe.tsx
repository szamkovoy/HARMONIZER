import { StatusBar } from "expo-status-bar";

import { BiofeedbackProbeScreen } from "@/modules/biofeedback/ui/BiofeedbackProbeScreen";

export default function BiofeedbackProbeRoute() {
  return (
    <>
      <StatusBar style="light" />
      <BiofeedbackProbeScreen />
    </>
  );
}
