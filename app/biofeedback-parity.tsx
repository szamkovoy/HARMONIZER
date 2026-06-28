import { StatusBar } from "expo-status-bar";

import { BiofeedbackParityScreen } from "@/modules/biofeedback/ui/BiofeedbackParityScreen";

export default function BiofeedbackParityRoute() {
  return (
    <>
      <StatusBar style="light" />
      <BiofeedbackParityScreen />
    </>
  );
}
