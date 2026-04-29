import { describe, expect, it } from "vitest";
import { PLANETS_7, type Planet } from "../../../modules/astro-core";
import { computeActivation, computeImportance, effectiveNatalParams } from "../../../modules/daily-engine/core/activation";
import { inputFor, natalProfile, transitChart } from "../../../modules/daily-engine/test-fixtures";
import {
  computeActivation as denoComputeActivation,
  computeImportance as denoComputeImportance,
  effectiveNatalParams as denoEffectiveNatalParams,
} from "./dailyForecast";

describe("Daily-Engine parity: Node (modules/daily-engine) vs Deno (_shared/dailyForecast)", () => {
  const natal = natalProfile({ Saturn: { longitude: 100 } });
  const calibration = { S_calibrated: { Saturn: 0.25 as number } };
  const chart = transitChart({
    Saturn: { longitude: 101, speed: 0.03 },
    Sun: { longitude: 20 },
    Moon: { longitude: 50 },
    Mercury: { longitude: 170 },
    Venus: { longitude: 230 },
    Mars: { longitude: 300 },
    Jupiter: { longitude: 10 },
  });

  it("effectiveNatalParams matches for S_eff and H_eff", () => {
    const node = effectiveNatalParams(natal, calibration);
    const deno = denoEffectiveNatalParams(natal as never, calibration as never);
    for (const planet of PLANETS_7) {
      expect(deno.S_eff[planet]).toBeCloseTo(node.S_eff[planet], 10);
      expect(deno.H_eff[planet]).toBeCloseTo(node.H_eff[planet], 10);
    }
  });

  it("computeActivation matches per planet", () => {
    const node = computeActivation({ natalProfile: natal, transitChart: chart });
    const deno = denoComputeActivation(natal as never, chart as never);
    for (const planet of PLANETS_7) {
      expect(deno.activation[planet]).toBeCloseTo(node.activation[planet], 10);
    }
    expect(deno.contributions.length).toBe(node.contributions.length);
  });

  it("computeImportance matches", () => {
    const eff = effectiveNatalParams(natal, calibration);
    const act = computeActivation({ natalProfile: natal, transitChart: chart });
    const node = computeImportance(act.activation, eff.S_eff);
    const deno = denoComputeImportance(act.activation as never, eff.S_eff as never);
    for (const planet of PLANETS_7) {
      expect(deno[planet]).toBeCloseTo(node[planet], 10);
    }
  });

  it("matches on approximate precision (Moon dampening)", () => {
    const approx = { ...natalProfile({ Saturn: { longitude: 100 } }), precisionMode: "approximate" as const };
    const c = transitChart({ Saturn: { longitude: 101, speed: 0.03 } });
    const node = computeActivation({ natalProfile: approx as never, transitChart: c });
    const deno = denoComputeActivation(approx as never, c as never);
    for (const planet of PLANETS_7) {
      expect(deno.activation[planet]).toBeCloseTo(node.activation[planet], 10);
    }
  });

  it("matches on unknown precision (stronger Moon dampening)", () => {
    const unknown = { ...natalProfile({ Mars: { longitude: 80 } }), precisionMode: "unknown" as const };
    const c = transitChart({ Moon: { longitude: 80, speed: 13.1 } });
    const node = computeActivation({ natalProfile: unknown as never, transitChart: c });
    const deno = denoComputeActivation(unknown as never, c as never);
    for (const planet of PLANETS_7) {
      expect(deno.activation[planet]).toBeCloseTo(node.activation[planet], 10);
    }
  });
});
