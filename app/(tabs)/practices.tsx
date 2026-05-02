import { StatusBar } from "expo-status-bar";

import { PracticeCatalogScreen } from "@/modules/practices";

export default function PracticesTabRoute() {
  return (
    <>
      <StatusBar style="auto" />
      <PracticeCatalogScreen />
    </>
  );
}
