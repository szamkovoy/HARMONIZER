import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";

import { SacredSymbolStreamScreen } from "@/modules/mandala/experiments/SacredSymbolStreamScreen";

function positiveIntParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function chakraParam(value: string | undefined): number | undefined {
  const parsed = positiveIntParam(value);
  return parsed && parsed >= 1 && parsed <= 7 ? parsed : undefined;
}

export default function SacredSymbolStreamRoute() {
  const params = useLocalSearchParams<{
    durationMs?: string;
    chakra?: string;
    launchSource?: string;
  }>();

  return (
    <>
      <StatusBar style="light" />
      <SacredSymbolStreamScreen
        durationMs={positiveIntParam(typeof params.durationMs === "string" ? params.durationMs : undefined)}
        chakra={chakraParam(typeof params.chakra === "string" ? params.chakra : undefined)}
        launchSource={typeof params.launchSource === "string" ? params.launchSource : undefined}
      />
    </>
  );
}
