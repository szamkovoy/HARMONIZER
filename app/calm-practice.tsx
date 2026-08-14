import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { parseSoundBedId } from "@/modules/mandala-sound/core/soundBed";
import { CalmPracticeScreen } from "@/modules/practices/ui/CalmPracticeScreen";

function positiveIntParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export default function CalmPracticeRoute() {
  const params = useLocalSearchParams<{
    durationMs?: string;
    soundBed?: string;
  }>();

  const durationMs = useMemo(
    () => positiveIntParam(typeof params.durationMs === "string" ? params.durationMs : undefined),
    [params.durationMs],
  );
  const soundBed = parseSoundBedId(typeof params.soundBed === "string" ? params.soundBed : undefined);

  return (
    <>
      <StatusBar style="light" />
      <CalmPracticeScreen durationMs={durationMs} soundBed={soundBed} />
    </>
  );
}
