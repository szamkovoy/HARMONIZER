import { router, type Href } from "expo-router";

import type { PracticeRecommendationLaunch } from "@shared/recommendation";
import type { PracticeLaunchParams } from "@/modules/practices/core/types";

type LaunchInput = PracticeLaunchParams | PracticeRecommendationLaunch | null | undefined;
type LaunchOptions = {
  launchSource?: "catalog" | "assistant" | "direct" | string;
};

function isRecommendationLaunch(launch: LaunchInput): launch is PracticeRecommendationLaunch {
  return Boolean(launch && "params" in launch);
}

function paramsForCatalogLaunch(launch: PracticeLaunchParams): Record<string, string> | undefined {
  if (launch.kind === "breath") {
    return {
      practiceId: launch.practiceId,
      durationMs: String(launch.durationMs),
      chakra: String(launch.chakra),
      ...(launch.soundBed ? { soundBed: launch.soundBed } : {}),
      ...(launch.sensorMode ? { sensorMode: launch.sensorMode } : {}),
      ...(launch.deviceId ? { deviceId: launch.deviceId } : {}),
      ...(launch.deviceName ? { deviceName: launch.deviceName } : {}),
      ...(launch.provider ? { provider: launch.provider } : {}),
      ...(launch.capabilityTier ? { capabilityTier: launch.capabilityTier } : {}),
      ...(launch.connectionHint ? { connectionHint: launch.connectionHint } : {}),
      ...(typeof launch.autoReconnect === "boolean" ? { autoReconnect: String(launch.autoReconnect) } : {}),
      ...(typeof launch.usePulseSensor === "boolean" ? { usePulseSensor: String(launch.usePulseSensor) } : {}),
    };
  }

  if (launch.kind === "yoga") {
    return {
      practiceId: launch.practiceId,
      ...(launch.durationMs ? { durationMs: String(launch.durationMs) } : {}),
      ...(launch.chakra ? { chakra: String(launch.chakra) } : {}),
      ...(launch.vimeoId?.trim() ? { vimeoId: launch.vimeoId.trim() } : {}),
      ...(launch.thumbnailUrl?.trim() ? { thumbnailUrl: launch.thumbnailUrl.trim() } : {}),
    };
  }

  if (launch.kind === "meditation") {
    return {
      practiceId: launch.practiceId,
      ...(launch.durationMs ? { durationMs: String(launch.durationMs) } : {}),
      ...(launch.chakra ? { chakra: String(launch.chakra) } : {}),
      ...(launch.soundBed ? { soundBed: launch.soundBed } : {}),
    };
  }

  return undefined;
}

function withLaunchSource(params: Record<string, string> | undefined, launchSource: string | undefined) {
  if (!launchSource) return params;
  return {
    ...(params ?? {}),
    launchSource,
  };
}

export function launchPractice(launch: LaunchInput, options: LaunchOptions = {}): boolean {
  if (!launch?.route) return false;

  if (isRecommendationLaunch(launch)) {
    router.push({
      pathname: launch.route,
      params: withLaunchSource(launch.params, options.launchSource),
    } as Href);
    return true;
  }

  const params = paramsForCatalogLaunch(launch);
  if (params) {
    router.push({
      pathname: launch.route,
      params: withLaunchSource(params, options.launchSource),
    } as Href);
    return true;
  }

  router.push(
    options.launchSource
      ? ({
          pathname: launch.route,
          params: { launchSource: options.launchSource },
        } as Href)
      : (launch.route as Href),
  );
  return true;
}
