import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Canvas, Circle, Fill, FillType, Group, Path, Shader, Skia } from "@shopify/react-native-skia";

function useAnimationClock(isActive: boolean) {
  const [timeSeconds, setTimeSeconds] = useState(0);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      lastFrameRef.current = null;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      return;
    }

    const tick = (timestamp: number) => {
      const last = lastFrameRef.current ?? timestamp;
      const deltaSeconds = Math.min((timestamp - last) / 1000, 1 / 20);
      lastFrameRef.current = timestamp;
      setTimeSeconds((current) => current + deltaSeconds);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [isActive]);

  return timeSeconds;
}

type SacredAttractor = "lotus" | "yantra" | "flowerOfLife" | "metatron";

interface MandalaGenome {
  attractor: SacredAttractor;
  ringCount: number;
  symmetry: number;
  density: number;
  aperture: number;
  sharpness: number;
  lineWidth: number;
  petalBias: number;
  spokeBias: number;
  latticeBias: number;
  triangleBias: number;
  fillBias: number;
  rotationSpeed: number;
  pulseTravel: number;
  centerWeight: number;
  noiseWarp: number;
  sacredness: number;
  mutation: number;
  colorPhase: number;
  seed: number;
}

interface ShellLayer {
  generation: number;
  genomeBlend: {
    from: MandalaGenome;
    to: MandalaGenome;
    mix: number;
  };
  innerRadius: number;
  outerRadius: number;
  fade: number;
  kind: "embryoDisk" | "annulus";
}

const TUBE_SCENE_DURATION_SECONDS = 7.2;
const TUBE_GENOME_SCENE_DURATION_SECONDS = 21.6;
const TUBE_GENOME_PHASE_OFFSET =
  (TUBE_SCENE_DURATION_SECONDS * 0.5) / TUBE_GENOME_SCENE_DURATION_SECONDS;
const TUBE_VISIBLE_LAYER_COUNT = 7;
const TUBE_RENDER_SHELL_COUNT = TUBE_VISIBLE_LAYER_COUNT + 2;
const SEQUENCE_LENGTH = 96;

function fract(value: number) {
  return value - Math.floor(value);
}

function hash(value: number) {
  return fract(Math.sin(value * 127.1) * 43758.5453123);
}

function signedHash(value: number) {
  return hash(value) * 2 - 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const span = Math.max(edge1 - edge0, 0.00001);
  const t = clamp((value - edge0) / span, 0, 1);
  return t * t * (3 - 2 * t);
}

function generationPhase(generation: number) {
  return fract(generation * 0.173 + 0.11);
}

/**
 * Safe toggle for ornament modes:
 * - `1` disables `teeth`, leaving alternating `beads` + `petals`
 * - `2` disables `petals`, leaving `beads` + `teeth`
 * - `null` restores the original 3-way cycle
 */
const ORNAMENT_DISABLED_MODE: 1 | 2 | null = 1;

/**
 * Safe toggle: hides the secondary thin/translucent mandala layers from the shader
 * while keeping the main ornament rings and CPU boundaries intact.
 */
const SHOW_SECONDARY_SCENE_LAYERS = false;

function motifModeForGeneration(generation: number) {
  const normalized = ((generation % 3) + 3) % 3;
  if (ORNAMENT_DISABLED_MODE === 1) {
    return generation % 2 === 0 ? 0 : 2;
  }
  if (ORNAMENT_DISABLED_MODE === 2) {
    return normalized === 2 ? 1 : normalized;
  }
  return normalized;
}

function createSoftInkBoundaryPath(
  centerX: number,
  centerY: number,
  radius: number,
  seed: number,
) {
  const path = Skia.Path.Make();
  const segmentCount = 72;
  const frequencyA = 3 + Math.floor(hash(seed + 1.1) * 3);
  const frequencyB = 5 + Math.floor(hash(seed + 2.3) * 4);
  const phaseA = hash(seed + 3.7) * Math.PI * 2;
  const phaseB = hash(seed + 4.9) * Math.PI * 2;
  const amplitudeA = lerp(0.0022, 0.0046, hash(seed + 5.4));
  const amplitudeB = lerp(0.0012, 0.0028, hash(seed + 6.8));

  for (let index = 0; index <= segmentCount; index += 1) {
    const t = index / segmentCount;
    const angle = t * Math.PI * 2;
    const radialScale =
      1 +
      Math.sin(angle * frequencyA + phaseA) * amplitudeA +
      Math.sin(angle * frequencyB + phaseB) * amplitudeB;
    const localRadius = radius * radialScale;
    const x = centerX + Math.cos(angle) * localRadius;
    const y = centerY + Math.sin(angle) * localRadius;

    if (index === 0) {
      path.moveTo(x, y);
    } else {
      path.lineTo(x, y);
    }
  }

  path.close();
  return path;
}

function boundaryStyleForRing(generation: number, seed: number, minDimension: number) {
  const harmonicClass = (Math.abs(generation) + Math.floor(hash(seed + 12.1) * 3)) % 3;
  const widthScale = harmonicClass === 0 ? 1.06 : harmonicClass === 1 ? 1.34 : 1.72;
  const echoScale = harmonicClass === 0 ? 0.62 : harmonicClass === 1 ? 0.72 : 0.84;
  const brightnessShift = hash(seed + 9.7);

  return {
    harmonicClass,
    strokeWidth: clamp((1.18 + minDimension * 0.00185) * widthScale, 1.4, 4.6),
    echoStrokeWidth: clamp((0.82 + minDimension * 0.001) * echoScale, 0.9, 2.8),
    primaryColor:
      brightnessShift > 0.72
        ? "rgba(236, 198, 108, 0.82)"
        : brightnessShift > 0.34
          ? "rgba(208, 168, 88, 0.78)"
          : "rgba(184, 145, 74, 0.74)",
    echoColor:
      brightnessShift > 0.72
        ? "rgba(255, 233, 176, 0.3)"
        : brightnessShift > 0.34
          ? "rgba(235, 207, 142, 0.26)"
          : "rgba(208, 170, 110, 0.24)",
    debugColor:
      brightnessShift > 0.5 ? "rgba(236, 210, 148, 0.72)" : "rgba(206, 176, 126, 0.66)",
  };
}

function attractorToNumber(attractor: SacredAttractor) {
  switch (attractor) {
    case "yantra":
      return 1;
    case "flowerOfLife":
      return 2;
    case "metatron":
      return 3;
    case "lotus":
    default:
      return 0;
  }
}

function normalizeBiases(genome: MandalaGenome): MandalaGenome {
  const total = genome.petalBias + genome.spokeBias + genome.latticeBias + genome.triangleBias;
  const safeTotal = total > 0.0001 ? total : 1;
  return {
    ...genome,
    petalBias: genome.petalBias / safeTotal,
    spokeBias: genome.spokeBias / safeTotal,
    latticeBias: genome.latticeBias / safeTotal,
    triangleBias: genome.triangleBias / safeTotal,
  };
}

function createAttractorPreset(
  attractor: SacredAttractor,
  densityBias: number,
  seed: number,
): MandalaGenome {
  const denseLift = lerp(0.88, 1.24, densityBias);

  if (attractor === "yantra") {
    return normalizeBiases({
      attractor,
      ringCount: 3,
      symmetry: lerp(6, 12, hash(seed + 1.1)),
      density: 0.9 * denseLift,
      aperture: 0.16,
      sharpness: 2.8,
      lineWidth: 0.72,
      petalBias: 0.12,
      spokeBias: 0.42,
      latticeBias: 0.12,
      triangleBias: 0.9,
      fillBias: 0.16,
      rotationSpeed: 0.11,
      pulseTravel: 0.72,
      centerWeight: 0.86,
      noiseWarp: 0.14,
      sacredness: 0.64,
      mutation: 0.18,
      colorPhase: hash(seed + 2.7),
      seed,
    });
  }

  if (attractor === "flowerOfLife") {
    return normalizeBiases({
      attractor,
      ringCount: 5,
      symmetry: lerp(6, 14, hash(seed + 3.2)),
      density: 1.02 * denseLift,
      aperture: 0.28,
      sharpness: 1.2,
      lineWidth: 0.78,
      petalBias: 0.18,
      spokeBias: 0.14,
      latticeBias: 0.96,
      triangleBias: 0.08,
      fillBias: 0.22,
      rotationSpeed: 0.06,
      pulseTravel: 0.58,
      centerWeight: 0.66,
      noiseWarp: 0.18,
      sacredness: 0.68,
      mutation: 0.2,
      colorPhase: hash(seed + 4.4),
      seed,
    });
  }

  if (attractor === "metatron") {
    return normalizeBiases({
      attractor,
      ringCount: 4,
      symmetry: lerp(8, 14, hash(seed + 5.9)),
      density: 1.04 * denseLift,
      aperture: 0.22,
      sharpness: 1.9,
      lineWidth: 0.82,
      petalBias: 0.18,
      spokeBias: 0.36,
      latticeBias: 0.3,
      triangleBias: 0.32,
      fillBias: 0.14,
      rotationSpeed: 0.08,
      pulseTravel: 0.76,
      centerWeight: 0.8,
      noiseWarp: 0.16,
      sacredness: 0.7,
      mutation: 0.16,
      colorPhase: hash(seed + 6.8),
      seed,
    });
  }

  return normalizeBiases({
    attractor: "lotus",
    ringCount: 4,
    symmetry: lerp(8, 16, hash(seed + 7.1)),
    density: 1.08 * denseLift,
    aperture: 0.34,
    sharpness: 1.6,
    lineWidth: 0.76,
    petalBias: 0.88,
    spokeBias: 0.16,
    latticeBias: 0.12,
    triangleBias: 0.1,
    fillBias: 0.26,
    rotationSpeed: 0.09,
    pulseTravel: 0.84,
    centerWeight: 0.72,
    noiseWarp: 0.22,
    sacredness: 0.62,
    mutation: 0.22,
    colorPhase: hash(seed + 8.3),
    seed,
  });
}

function blendAttractor(
  parent: MandalaGenome,
  target: MandalaGenome,
  progress: number,
  mutationAmount: number,
  seed: number,
): MandalaGenome {
  const targetPull = lerp(0.1, 0.34, progress);
  const mutate = (
    currentValue: number,
    targetValue: number,
    range: number,
    salt: number,
    min: number,
    max: number,
  ) =>
    clamp(
      lerp(currentValue, targetValue, targetPull) + signedHash(seed + salt) * range * mutationAmount,
      min,
      max,
    );

  return normalizeBiases({
    attractor: progress > 0.64 ? target.attractor : parent.attractor,
    ringCount: Math.round(mutate(parent.ringCount, target.ringCount, 1.2, 1.1, 3, 5)),
    symmetry: mutate(parent.symmetry, target.symmetry, 3.8, 2.7, 5, 20),
    density: mutate(parent.density, target.density, 0.18, 3.4, 0.72, 1.42),
    aperture: mutate(parent.aperture, target.aperture, 0.12, 4.5, 0.1, 0.62),
    sharpness: mutate(parent.sharpness, target.sharpness, 0.8, 5.7, 0.7, 3.6),
    lineWidth: mutate(parent.lineWidth, target.lineWidth, 0.1, 6.9, 0.52, 0.96),
    petalBias: mutate(parent.petalBias, target.petalBias, 0.18, 7.3, 0.04, 1.2),
    spokeBias: mutate(parent.spokeBias, target.spokeBias, 0.18, 8.4, 0.04, 1.2),
    latticeBias: mutate(parent.latticeBias, target.latticeBias, 0.18, 9.5, 0.04, 1.2),
    triangleBias: mutate(parent.triangleBias, target.triangleBias, 0.18, 10.6, 0.04, 1.2),
    fillBias: mutate(parent.fillBias, target.fillBias, 0.1, 11.7, 0.06, 0.42),
    rotationSpeed: mutate(parent.rotationSpeed, target.rotationSpeed, 0.035, 12.8, 0.02, 0.16),
    pulseTravel: mutate(parent.pulseTravel, target.pulseTravel, 0.12, 13.9, 0.46, 1.0),
    centerWeight: mutate(parent.centerWeight, target.centerWeight, 0.14, 14.3, 0.4, 1.0),
    noiseWarp: mutate(parent.noiseWarp, target.noiseWarp, 0.08, 15.4, 0.04, 0.28),
    sacredness: clamp(lerp(parent.sacredness, target.sacredness, targetPull * 0.9), 0, 1),
    mutation: mutationAmount,
    colorPhase: fract(lerp(parent.colorPhase, target.colorPhase, 0.16) + signedHash(seed + 16.7) * 0.08),
    seed,
  });
}

function buildGenomeSequence(sessionSeed: number, densityBias: number): MandalaGenome[] {
  const attractors: SacredAttractor[] = ["lotus", "yantra", "flowerOfLife", "metatron"];
  const terminalAttractor = attractors[Math.floor(hash(sessionSeed + 99.1) * attractors.length)];
  let current = normalizeBiases({
    attractor: "lotus",
    ringCount: 4,
    symmetry: lerp(10, 16, densityBias),
    density: lerp(0.92, 1.28, densityBias),
    aperture: lerp(0.2, 0.34, densityBias),
    sharpness: 1.7,
    lineWidth: 0.78,
    petalBias: 0.42,
    spokeBias: 0.22,
    latticeBias: 0.24,
    triangleBias: 0.12,
    fillBias: 0.22,
    rotationSpeed: 0.082,
    pulseTravel: 0.82,
    centerWeight: 0.72,
    noiseWarp: 0.24,
    sacredness: 0.08,
    mutation: 0.42,
    colorPhase: hash(sessionSeed + 0.5),
    seed: sessionSeed,
  });
  const sequence = [current];

  for (let index = 1; index < SEQUENCE_LENGTH; index += 1) {
    const progress = index / (SEQUENCE_LENGTH - 1);
    const wanderingAttractor = attractors[Math.floor(hash(sessionSeed + index * 2.37) * attractors.length)];
    const targetAttractor = progress < 0.58 ? wanderingAttractor : terminalAttractor;
    const targetSeed = sessionSeed + index * 31.17;
    const target = createAttractorPreset(targetAttractor, densityBias, targetSeed);
    const mutationAmount = lerp(0.4, 0.045, Math.pow(progress, 1.12));
    current = blendAttractor(current, target, progress, mutationAmount, targetSeed);
    sequence.push(current);
  }

  return sequence;
}

function blendGenomeDirect(a: MandalaGenome, b: MandalaGenome, t: number): MandalaGenome {
  return normalizeBiases({
    attractor: t < 0.5 ? a.attractor : b.attractor,
    ringCount: Math.round(lerp(a.ringCount, b.ringCount, t)),
    symmetry: lerp(a.symmetry, b.symmetry, t),
    density: lerp(a.density, b.density, t),
    aperture: lerp(a.aperture, b.aperture, t),
    sharpness: lerp(a.sharpness, b.sharpness, t),
    lineWidth: lerp(a.lineWidth, b.lineWidth, t),
    petalBias: lerp(a.petalBias, b.petalBias, t),
    spokeBias: lerp(a.spokeBias, b.spokeBias, t),
    latticeBias: lerp(a.latticeBias, b.latticeBias, t),
    triangleBias: lerp(a.triangleBias, b.triangleBias, t),
    fillBias: lerp(a.fillBias, b.fillBias, t),
    rotationSpeed: lerp(a.rotationSpeed, b.rotationSpeed, t),
    pulseTravel: lerp(a.pulseTravel, b.pulseTravel, t),
    centerWeight: lerp(a.centerWeight, b.centerWeight, t),
    noiseWarp: lerp(a.noiseWarp, b.noiseWarp, t),
    sacredness: lerp(a.sacredness, b.sacredness, t),
    mutation: lerp(a.mutation, b.mutation, t),
    colorPhase: fract(lerp(a.colorPhase, b.colorPhase, t)),
    seed: lerp(a.seed, b.seed, t),
  });
}

function sampleGenomeAtPosition(sequence: MandalaGenome[], position: number): MandalaGenome {
  const sampled = sampleGenomeBlendAtPosition(sequence, position);
  return blendGenomeDirect(sampled.from, sampled.to, sampled.mix);
}

function sampleGenomeBlendAtPosition(sequence: MandalaGenome[], position: number) {
  const baseIndex = Math.floor(position);
  const mixAmount = fract(position);
  const indexA = ((baseIndex % sequence.length) + sequence.length) % sequence.length;
  const indexB = (indexA + 1) % sequence.length;
  return {
    from: sequence[indexA],
    to: sequence[indexB],
    mix: mixAmount,
  };
}

function toUniformA(genome: MandalaGenome) {
  return [genome.ringCount, genome.symmetry, genome.density, genome.aperture];
}

function toUniformB(genome: MandalaGenome) {
  return [genome.sharpness, genome.lineWidth, genome.petalBias, genome.spokeBias];
}

function toUniformC(genome: MandalaGenome) {
  return [genome.latticeBias, genome.triangleBias, genome.fillBias, genome.rotationSpeed];
}

function toUniformD(genome: MandalaGenome) {
  return [genome.pulseTravel, genome.centerWeight, genome.noiseWarp, genome.colorPhase];
}

function toUniformE(genome: MandalaGenome) {
  return [attractorToNumber(genome.attractor), genome.sacredness, genome.mutation, genome.seed];
}

const SHADER_SOURCE = `
uniform float2 resolution;
uniform float contentTime;
uniform float densityBias;
uniform float sceneOuterR;
uniform float scenePhase;
uniform float motifMode;
uniform float annulusInnerT;
uniform float secondaryLayerGate;
uniform float4 layerA;
uniform float4 layerB;
uniform float4 layerC;
uniform float4 layerD;
uniform float4 layerE;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    total += valueNoise(p) * amplitude;
    p = p * 2.0 + vec2(13.7, 17.3);
    amplitude *= 0.56;
  }
  return total;
}

float band(float d, float width) {
  float localFeather = clamp(width * 0.28, 0.00018, 0.006);
  return 1.0 - smoothstep(width, width + localFeather, d);
}

float triangleSdf(vec2 p) {
  const float k = 1.7320508;
  p.x = abs(p.x) - 1.0;
  p.y = p.y + 1.0 / k;
  if (p.x + k * p.y > 0.0) {
    p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
  }
  p.x -= clamp(p.x, -2.0, 0.0);
  return -length(p) * sign(p.y);
}

float petalRadiusShape(float cosinePetal, float radius, float lengthScale, float aperture, float sharpness) {
  float petalWave = pow(max(cosinePetal, 0.0001), sharpness);
  float blend = pow(max(petalWave, 0.0001), mix(3.4, 0.92, aperture));
  return mix(radius * mix(0.12, 0.24, aperture), radius * lengthScale, blend);
}

float petalLine(
  vec2 p,
  float petals,
  float radius,
  float lengthScale,
  float aperture,
  float sharpness,
  float width
) {
  vec2 polar = vec2(atan(p.y, p.x), length(p));
  float cosinePetal = 0.5 + 0.5 * cos(polar.x * petals);
  float petalRadius = petalRadiusShape(cosinePetal, radius, lengthScale, aperture, sharpness);
  return band(abs(polar.y - petalRadius), width);
}

float petalFill(
  vec2 p,
  float petals,
  float radius,
  float lengthScale,
  float aperture,
  float sharpness,
  float width
) {
  vec2 polar = vec2(atan(p.y, p.x), length(p));
  float cosinePetal = 0.5 + 0.5 * cos(polar.x * petals);
  float petalRadius = petalRadiusShape(cosinePetal, radius, lengthScale, aperture, sharpness);
  float innerGate = smoothstep(radius * 0.05, radius * 0.24, polar.y);
  float outerGate = 1.0 - smoothstep(petalRadius - width * 2.8, petalRadius + width * 1.8, polar.y);
  return clamp(innerGate * outerGate, 0.0, 1.0);
}

float spokeField(vec2 p, float spokes, float radius, float width) {
  vec2 polar = vec2(atan(p.y, p.x), length(p));
  float spokePulse = pow(abs(cos(polar.x * spokes * 0.5)), mix(36.0, 140.0, clamp(1.0 - width * 60.0, 0.0, 1.0)));
  float radialGate =
    smoothstep(radius * 0.06, radius * 0.36, polar.y) *
    (1.0 - smoothstep(radius * 1.08, radius * 1.42, polar.y));
  return spokePulse * radialGate;
}

float latticeField(vec2 p, float nodes, float radius, float cellRadius, float width) {
  float angle = atan(p.y, p.x);
  float stepAngle = TAU / max(nodes, 3.0);
  float snapped = floor(angle / stepAngle + 0.5) * stepAngle;
  vec2 center = vec2(cos(snapped), sin(snapped)) * radius;
  return band(abs(length(p - center) - cellRadius), width);
}

float triangleField(vec2 p, float radius, float width, float rotation) {
  vec2 q = (p * rotate2d(rotation)) / max(radius, 0.001);
  float outline = abs(triangleSdf(q * 1.6));
  return band(outline, width / max(radius, 0.001) * 1.6);
}

vec3 paletteByPhase(float phaseA, float phaseB, float mixAmount) {
  vec3 a = mix(vec3(0.82, 0.62, 1.0), vec3(1.0, 0.88, 0.72), phaseA);
  vec3 b = mix(vec3(0.64, 0.84, 1.0), vec3(0.98, 0.72, 0.94), phaseB);
  return mix(a, b, mixAmount);
}

vec3 motifOrnament(
  vec2 p,
  float width,
  float symmetry,
  float aperture,
  float sharpness,
  float phase,
  float pulse
) {
  float radius = length(p);
  float angle = atan(p.y, p.x);
  float mode = floor(motifMode + 0.5);
  float innerT = annulusInnerT;
  float rawBandWidth = max(1.0 - innerT, 0.001);
  float edgePadding = rawBandWidth * 0.1;
  float bandInner = innerT + edgePadding;
  float bandOuter = 1.0 - edgePadding;
  float bandWidth = max(bandOuter - bandInner, rawBandWidth * 0.18);
  float bandCenter = bandInner + bandWidth * 0.5;
  float pixelWidth = 1.0 / min(resolution.x, resolution.y) / max(sceneOuterR, 0.0006);
  float stroke = max(width * 1.05, pixelWidth * 1.25);
  float line = 0.0;
  float fill = 0.0;
  float accent = 0.0;

  if (mode < 0.5) {
    float beads = floor(clamp(symmetry * 1.08, 12.0, 24.0));
    float ringRadius = bandCenter;
    float stepAngle = TAU / beads;
    float snapped = floor(angle / stepAngle + 0.5) * stepAngle;
    float beadSeed = floor(angle / stepAngle + 0.5);
    float beadRadius = bandWidth * mix(0.14, 0.2, hash11(beadSeed + phase * 7.3 + 1.7));
    float beadOffset = bandWidth * mix(-0.012, 0.012, hash11(beadSeed + 4.1));
    vec2 beadCenter = vec2(cos(snapped), sin(snapped)) * (ringRadius + beadOffset);
    float outerBead = band(length(p - beadCenter), beadRadius + stroke * 0.55);
    float innerHole = band(length(p - beadCenter), beadRadius * 0.5);
    float beadRing = clamp(outerBead - innerHole * 0.92, 0.0, 1.0);
    line = beadRing;
    fill = beadRing * 0.04;
    accent = beadRing * (0.18 + pulse * 0.1);
  } else if (mode < 2.5) {
    float teeth = floor(clamp(symmetry * 1.1, 10.0, 26.0));
    float ringRadius = bandCenter;
    float toothPhase = fract((angle / TAU) * teeth);
    float triangle = 1.0 - abs(toothPhase * 2.0 - 1.0);
    float softened = pow(clamp(triangle, 0.0, 1.0), 0.72);
    float toothRadius = ringRadius + (softened - 0.5) * bandWidth * 0.56;
    line = band(abs(radius - toothRadius), stroke * 1.45);
    fill = 0.0;
    accent = line * 0.1;
  } else {
    float petals = floor(clamp(symmetry * 0.9, 6.0, 18.0));
    float lotusBase = bandCenter - bandWidth * 0.34;
    float lotusTop = bandCenter + bandWidth * 0.34;
    float petalWave = pow(max(0.5 + 0.5 * cos(angle * petals), 0.0001), sharpness * 0.9);
    float petalTipRadius = lotusBase + mix(bandWidth * 0.12, lotusTop - lotusBase, petalWave);
    float petalOuterLine = band(abs(radius - petalTipRadius), stroke * 1.25 + bandWidth * 0.015);
    float petalBody =
      smoothstep(lotusBase - bandWidth * 0.02, lotusBase + bandWidth * 0.08, radius) *
      (1.0 - smoothstep(petalTipRadius - bandWidth * 0.16, petalTipRadius + bandWidth * 0.03, radius));
    float innerSupport = band(abs(radius - lotusBase), stroke * 0.9 + bandWidth * 0.01);
    line = petalOuterLine + innerSupport * 0.42;
    fill = petalBody * 0.34;
    accent = petalOuterLine * 0.18;
  }

  return vec3(line, fill, accent);
}

vec3 mandalaScene(
  vec2 p,
  float4 A,
  float4 B,
  float4 C,
  float4 D,
  float4 E,
  float breath,
  float pulse,
  float phase
) {
  float ringCount = floor(A.x + 0.5);
  float symmetry = A.y;
  float density = A.z;
  float aperture = A.w;
  float sharpness = B.x;
  float lineWidth = B.y;
  float petalBias = B.z;
  float spokeBias = B.w;
  float latticeBias = C.x;
  float triangleBias = C.y;
  float fillBias = C.z;
  float rotationSpeed = C.w;
  float pulseTravel = D.x;
  float centerWeight = D.y;
  float noiseWarp = D.z;
  float sacredness = E.y;
  float mutation = E.z;
  float seed = E.w;

  float warpNoise = fbm(p * (1.8 + density * 0.8 + noiseWarp * 1.8) + vec2(seed * 0.07, contentTime * 0.01));
  vec2 warpDirection = normalize(p + vec2(0.0001, 0.0));
  p += warpDirection * (warpNoise - 0.5) * (0.008 + noiseWarp * 0.016) * (0.18 + mutation * 0.18);

  float lineField = 0.0;
  float fillField = 0.0;
  float accentField = 0.0;
  float totalWeight = max(petalBias + spokeBias + latticeBias + triangleBias, 0.0001);

  for (int i = 0; i < 5; i++) {
    if (float(i) >= ringCount) {
      break;
    }

    float fi = float(i);
    float ringSeed = seed * 1.71 + fi * 19.3;
    float ringT = (fi + 1.0) / max(ringCount, 1.0);
    float localSymmetry = floor(clamp(mix(symmetry * 0.72, symmetry * 1.24, hash11(ringSeed + 1.2)) * density, 5.0, 28.0));
    float localRadius = mix(0.12, 0.84, ringT) * mix(0.94, 1.04, hash11(ringSeed + 2.1));
    float localLength = mix(0.72, 1.54, hash11(ringSeed + 3.4)) * mix(0.9, 1.08, petalBias);
    float localAperture = clamp(aperture + (hash11(ringSeed + 4.5) - 0.5) * (0.18 + mutation * 0.18), 0.08, 0.72);
    float localSharpness = clamp(sharpness + (hash11(ringSeed + 5.6) - 0.5) * (0.36 + mutation * 0.5), 0.6, 3.8);
    float localWidth = mix(0.0045, 0.011, lineWidth) * mix(1.0, 0.72, ringT);
    float rotation = contentTime * mix(-1.0, 1.0, hash11(ringSeed + 6.7)) * rotationSpeed * 0.12;
    vec2 rp = p * rotate2d(rotation);
    float localBreath = breath * mix(0.015, 0.075, hash11(ringSeed + 8.9));
    float localPulse = pulse * mix(0.015, 0.08, hash11(ringSeed + 9.3));
    float animatedRadius = localRadius * (1.0 + localBreath + localPulse * (0.06 + ringT * 0.08));

    float petal = petalLine(rp, localSymmetry, animatedRadius, localLength, localAperture, localSharpness, localWidth);
    float petalFillField = petalFill(rp, localSymmetry, animatedRadius, localLength, localAperture, localSharpness, localWidth);
    float spokes = spokeField(rp, localSymmetry, animatedRadius, localWidth);
    float lattice = latticeField(rp, localSymmetry, animatedRadius, animatedRadius * mix(0.18, 0.28, localAperture), localWidth * 0.9);
    float triangle = triangleField(rp, animatedRadius * mix(0.58, 0.96, ringT), localWidth, fi * PI / max(localSymmetry, 3.0));
    float angle = atan(rp.y, rp.x);
    float travellingPulse =
      pow(0.5 + 0.5 * cos(angle * localSymmetry - contentTime * pulseTravel * 0.18 + ringSeed), 8.0);

    float motifLine = (petal * petalBias + spokes * spokeBias + lattice * latticeBias + triangle * triangleBias) / totalWeight;
    lineField += motifLine;
    fillField += mix(petalFillField, lattice * 0.4, latticeBias) * fillBias * (0.08 + ringT * 0.08);
    accentField += motifLine * travellingPulse * 0.18;
  }

  float sceneRadius = length(p);
  vec3 ornament = motifOrnament(p, mix(0.005, 0.012, lineWidth), symmetry, aperture, sharpness, phase, pulse);
  lineField *= secondaryLayerGate;
  fillField *= secondaryLayerGate;
  accentField *= secondaryLayerGate;

  float coreGlow = exp(-pow(sceneRadius / mix(0.08, 0.16, centerWeight), 1.4)) * 0.18 * secondaryLayerGate;
  float bindu = exp(-pow(sceneRadius / 0.03, 1.7)) * secondaryLayerGate;
  float auraNoise = fbm(p * (2.2 + densityBias * 1.2) + vec2(phase * 1.7, contentTime * 0.008 + seed * 0.03));
  float aura = exp(-pow(sceneRadius / 0.88, 1.7)) * (0.003 + auraNoise * 0.002 + sacredness * 0.002) * secondaryLayerGate;

  lineField = clamp(lineField + ornament.x * 0.82 + bindu * 0.45 + coreGlow * 0.05, 0.0, 1.4);
  fillField = clamp(fillField + ornament.y * 0.7 + aura + coreGlow * 0.04, 0.0, 1.1);
  accentField = clamp(accentField + ornament.z * 0.8 + bindu * 0.18, 0.0, 0.8);
  return vec3(lineField, fillField, accentField);
}

half4 main(vec2 fragcoord) {
  float minRes = min(resolution.x, resolution.y);
  vec2 uv = (fragcoord - resolution * 0.5) / minRes;
  vec2 sceneUv = uv / max(sceneOuterR, 0.0006);
  float breath = 0.5 + 0.5 * sin(contentTime * 0.4);
  float pulse = pow(0.5 + 0.5 * sin(contentTime * 0.9), 2.0);
  vec3 scene = mandalaScene(sceneUv, layerA, layerB, layerC, layerD, layerE, breath, pulse, scenePhase);
  float sceneRadius = length(sceneUv);
  vec3 lineColor = paletteByPhase(layerD.w, fract(layerD.w + 0.21), 0.52 + densityBias * 0.14);
  vec3 fillColor = mix(lineColor, vec3(1.0, 0.96, 0.99), 0.24);
  vec3 accentColor = mix(vec3(1.0, 0.97, 0.99), lineColor, 0.3);
  if (motifMode < 0.5) {
    lineColor = vec3(0.22, 0.96, 1.0);
    fillColor = vec3(0.1, 0.84, 0.9);
    accentColor = vec3(0.92, 1.0, 1.0);
  } else if (motifMode < 1.5) {
    lineColor = vec3(0.22, 0.96, 1.0);
    fillColor = vec3(0.1, 0.84, 0.9);
    accentColor = vec3(0.92, 1.0, 1.0);
  } else {
    lineColor = vec3(0.22, 0.96, 1.0);
    fillColor = vec3(0.1, 0.84, 0.9);
    accentColor = vec3(0.92, 1.0, 1.0);
  }
  float edgeFade = 1.0 - smoothstep(1.02, 1.22, sceneRadius);
  vec3 color =
    fillColor * scene.y * 0.22 +
    lineColor * scene.x * 0.18 +
    accentColor * scene.z * 0.12;
  color *= edgeFade;
  return half4(color, 1.0);
}
`;

const effect = Skia.RuntimeEffect.Make(SHADER_SOURCE);

if (!effect) {
  throw new Error("Failed to compile Bindu Succession Lab shader.");
}

const EFFECT = effect;

export interface BinduSuccessionLabCanvasProps {
  isActive?: boolean;
  sceneOffset?: number;
  densityBias?: number;
  sessionSeed?: number;
  flowSpeed?: number;
  debugGeometry?: boolean;
  tubeRingOuterR?: number;
  tubeRingInnerR?: number;
  tubeBinduOuterR?: number;
}

export function BinduSuccessionLabCanvas({
  isActive = true,
  sceneOffset = 0,
  densityBias = 0.5,
  sessionSeed = 1,
  flowSpeed = 0.72,
  debugGeometry = false,
  tubeRingOuterR = 0.88,
  tubeRingInnerR = 0.24,
  tubeBinduOuterR = 0.11,
}: BinduSuccessionLabCanvasProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const timeSeconds = useAnimationClock(isActive);
  const genomes = useMemo(() => buildGenomeSequence(sessionSeed, densityBias), [densityBias, sessionSeed]);
  const contentTime = timeSeconds * 0.12;
  const geometryTime = (timeSeconds * flowSpeed) / TUBE_SCENE_DURATION_SECONDS + sceneOffset;
  const geometryGeneration = Math.floor(geometryTime);
  const geometryPhase = fract(geometryTime);
  const ringOuterRadius = Math.max(tubeRingOuterR, 0.76);
  const ringInnerRadius = clamp(tubeRingInnerR, 0.14, ringOuterRadius - 0.08);
  // Keep the full mandala within the viewport while still leaving
  // enough room for the outer shell to dissolve before it disappears.
  const stackOuterLimit = 0.48;
  const shellSpacing = stackOuterLimit / TUBE_VISIBLE_LAYER_COUNT;
  const embryoOuterRadius = clamp(Math.min(tubeBinduOuterR * 0.2, ringInnerRadius * 0.24), 0.014, shellSpacing * 0.22);
  const outerCullLimit = stackOuterLimit + shellSpacing * 1.4;
  const geometryToGenomeRatio = TUBE_SCENE_DURATION_SECONDS / TUBE_GENOME_SCENE_DURATION_SECONDS;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const minDimension = Math.max(1, Math.min(size.width, size.height));
  const centerX = size.width * 0.5;
  const centerY = size.height * 0.5;

  const shellStack = useMemo<ShellLayer[]>(() => {
    const newestOuterRadius = embryoOuterRadius + geometryPhase * shellSpacing;

    return Array.from({ length: TUBE_RENDER_SHELL_COUNT }, (_, index) => {
      const generation = geometryGeneration - index;
      const outerRadius = newestOuterRadius + index * shellSpacing;
      const innerRadius = index === 0 ? 0 : newestOuterRadius + (index - 1) * shellSpacing;
      const genomePosition = generation * geometryToGenomeRatio + TUBE_GENOME_PHASE_OFFSET;
      const genomeBlend = sampleGenomeBlendAtPosition(genomes, genomePosition);
      const fade = 1 - smoothstep(stackOuterLimit * 0.88, outerCullLimit, outerRadius);

      return {
        generation,
        genomeBlend,
        innerRadius,
        outerRadius,
        fade: clamp(fade, 0, 1),
        kind: index === 0 ? ("embryoDisk" as const) : ("annulus" as const),
      };
    }).filter((shell) => shell.innerRadius < outerCullLimit && shell.fade > 0.001);
  }, [
    embryoOuterRadius,
    geometryGeneration,
    geometryPhase,
    geometryToGenomeRatio,
    genomes,
    outerCullLimit,
    shellSpacing,
    stackOuterLimit,
  ]);

  const boundaryDrawData = useMemo(
    () =>
      shellStack.map((shell) => {
        const radiusPx = shell.outerRadius * minDimension;
        const seed = sessionSeed * 17.31 + shell.generation * 3.17;
        const path = createSoftInkBoundaryPath(centerX, centerY, radiusPx, seed);
        const echoRadius = radiusPx * (1 + lerp(0.0014, 0.0028, hash(seed + 8.2)));
        const echoPath = createSoftInkBoundaryPath(centerX, centerY, echoRadius, seed + 11.4);
        const style = boundaryStyleForRing(shell.generation, seed, minDimension);

        return {
          key: shell.generation,
          radius: shell.outerRadius,
          path,
          echoPath,
          harmonicClass: style.harmonicClass,
          strokeWidth: style.strokeWidth,
          echoStrokeWidth: style.echoStrokeWidth,
          primaryColor: style.primaryColor,
          echoColor: style.echoColor,
          debugColor: style.debugColor,
        };
      }),
    [centerX, centerY, minDimension, sessionSeed, shellStack],
  );

  const shellDrawData = useMemo(
    () =>
      shellStack.map((shell, index) => {
        const blendedGenome = blendGenomeDirect(shell.genomeBlend.from, shell.genomeBlend.to, shell.genomeBlend.mix);
        const path = Skia.Path.Make();
        path.addPath(boundaryDrawData[index].path);
        if (shell.kind === "annulus" && index > 0) {
          path.addPath(boundaryDrawData[index - 1].path);
          path.setFillType(FillType.EvenOdd);
        }

        const outerDissolve = 1 - smoothstep(stackOuterLimit * 0.72, outerCullLimit, shell.outerRadius);
        const dissolveOpacity = clamp(shell.fade * outerDissolve, 0, 1);
        const boundaryDissolve = Math.pow(dissolveOpacity, 0.82);
        const hazeAmount = 1 - outerDissolve;

        return {
          ...shell,
          index,
          path,
          annulusInnerT: shell.outerRadius > 0.0001 ? shell.innerRadius / shell.outerRadius : 0,
          fillOpacity: clamp(0.16 + dissolveOpacity * 0.84, 0.08, 1),
          glowOpacity: 0,
          strokeOpacity: clamp((0.18 + boundaryDissolve * 0.32 + boundaryDrawData[index].harmonicClass * 0.04) * dissolveOpacity, 0.04, 0.58),
          hazeOpacity: clamp(shell.fade * hazeAmount * 0.22, 0, 0.16),
          hazeStrokeWidth: boundaryDrawData[index].echoStrokeWidth * lerp(1.8, 4.6, hazeAmount),
          shaderUniforms: {
            resolution: [Math.max(size.width, 1), Math.max(size.height, 1)],
            contentTime,
            densityBias,
            sceneOuterR: shell.outerRadius,
            scenePhase: generationPhase(shell.generation + shell.genomeBlend.mix),
            motifMode: motifModeForGeneration(shell.generation),
            annulusInnerT: shell.outerRadius > 0.0001 ? shell.innerRadius / shell.outerRadius : 0,
            secondaryLayerGate: SHOW_SECONDARY_SCENE_LAYERS ? 1 : 0,
            layerA: toUniformA(blendedGenome),
            layerB: toUniformB(blendedGenome),
            layerC: toUniformC(blendedGenome),
            layerD: toUniformD(blendedGenome),
            layerE: toUniformE(blendedGenome),
          },
        };
      }),
    [boundaryDrawData, contentTime, densityBias, outerCullLimit, shellStack, size.height, size.width, stackOuterLimit],
  );

  const boundaryRadii = useMemo(
    () =>
      shellDrawData
        .map((shell, index) => ({
          key: shell.generation,
          radius: shell.outerRadius,
          path: boundaryDrawData[index].path,
          echoPath: boundaryDrawData[index].echoPath,
          opacity: shell.strokeOpacity,
          glowOpacity: shell.glowOpacity,
          hazeOpacity: shell.hazeOpacity,
          hazeStrokeWidth: shell.hazeStrokeWidth,
          strokeWidth: boundaryDrawData[index].strokeWidth,
          echoStrokeWidth: boundaryDrawData[index].echoStrokeWidth,
          primaryColor: boundaryDrawData[index].primaryColor,
          echoColor: boundaryDrawData[index].echoColor,
          debugColor: boundaryDrawData[index].debugColor,
        }))
        .filter((boundary) => boundary.radius < outerCullLimit),
    [boundaryDrawData, outerCullLimit, shellDrawData],
  );

  return (
    <View onLayout={handleLayout} style={styles.container}>
      <Canvas style={styles.canvas}>
        <Fill color="#000000" />
        {debugGeometry ? (
          <>
            {shellDrawData
              .slice()
              .reverse()
              .map((shell) => (
                <Path
                  key={`geometry-shell-${shell.generation}`}
                  path={shell.path}
                  color={shell.kind === "embryoDisk" ? "rgba(136, 124, 180, 0.3)" : "rgba(86, 98, 138, 0.18)"}
                />
              ))}
            {boundaryRadii.map((boundary) => (
              <Path
                key={`geometry-boundary-${boundary.key}`}
                path={boundary.path}
                color={boundary.debugColor}
                style="stroke"
                strokeWidth={boundary.strokeWidth}
              />
            ))}
          </>
        ) : (
          <>
            {shellDrawData
              .slice()
              .reverse()
              .map((shell) => (
                <Group key={`shell-content-${shell.generation}`} clip={shell.path}>
                  <Group opacity={shell.fillOpacity}>
                    <Fill>
                      <Shader source={EFFECT} uniforms={shell.shaderUniforms} />
                    </Fill>
                  </Group>
                </Group>
              ))}
            {boundaryRadii.map((boundary) => (
              <Group key={`shell-boundary-${boundary.key}`} opacity={boundary.opacity}>
                {boundary.hazeOpacity > 0.001 ? (
                  <Group opacity={boundary.hazeOpacity}>
                    <Path
                      path={boundary.echoPath}
                      color={boundary.echoColor}
                      style="stroke"
                      strokeWidth={boundary.hazeStrokeWidth}
                    />
                  </Group>
                ) : null}
                <Path
                  path={boundary.echoPath}
                  color={boundary.echoColor}
                  style="stroke"
                  strokeWidth={boundary.echoStrokeWidth}
                />
                <Path
                  path={boundary.path}
                  color={boundary.primaryColor}
                  style="stroke"
                  strokeWidth={boundary.strokeWidth}
                />
              </Group>
            ))}
          </>
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  canvas: {
    flex: 1,
  },
});
