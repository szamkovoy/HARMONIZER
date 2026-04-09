import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";

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

const SCENE_DURATION_SECONDS = 18;
const TUBE_SCENE_DURATION_SECONDS = 7.2;
const TUBE_GENOME_SCENE_DURATION_SECONDS = 21.6;
const TUBE_GENOME_PHASE_OFFSET =
  (TUBE_SCENE_DURATION_SECONDS * 0.5) / TUBE_GENOME_SCENE_DURATION_SECONDS;
const TUBE_VISIBLE_LAYER_COUNT = 6;
const TUBE_ANNULUS_LAYER_COUNT = 4;
const SEQUENCE_LENGTH = 96;
const DEPTH_LAYER_COUNT = 5;

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

function numberToAttractor(value: number): SacredAttractor {
  if (value >= 2.5) {
    return "metatron";
  }
  if (value >= 1.5) {
    return "flowerOfLife";
  }
  if (value >= 0.5) {
    return "yantra";
  }
  return "lotus";
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

  const blended = normalizeBiases({
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

  return blended;
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
  const baseIndex = Math.floor(position);
  const mixAmount = fract(position);
  const indexA = ((baseIndex % sequence.length) + sequence.length) % sequence.length;
  const indexB = (indexA + 1) % sequence.length;
  return blendGenomeDirect(sequence[indexA], sequence[indexB], mixAmount);
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
uniform float time;
uniform float sceneTime;
uniform float tubeGeometryTime;
uniform float densityBias;
uniform float flowSpeed;
uniform float inspectMode;
uniform float tubeMode;
uniform float tubeRingOuterR;
uniform float tubeRingInnerR;
uniform float tubeBinduOuterR;
uniform float4 layer0A;
uniform float4 layer0B;
uniform float4 layer0C;
uniform float4 layer0D;
uniform float4 layer0E;
uniform float4 layer1A;
uniform float4 layer1B;
uniform float4 layer1C;
uniform float4 layer1D;
uniform float4 layer1E;
uniform float4 layer2A;
uniform float4 layer2B;
uniform float4 layer2C;
uniform float4 layer2D;
uniform float4 layer2E;
uniform float4 layer3A;
uniform float4 layer3B;
uniform float4 layer3C;
uniform float4 layer3D;
uniform float4 layer3E;
uniform float4 layer4A;
uniform float4 layer4B;
uniform float4 layer4C;
uniform float4 layer4D;
uniform float4 layer4E;
uniform float4 layer5A;
uniform float4 layer5B;
uniform float4 layer5C;
uniform float4 layer5D;
uniform float4 layer5E;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

vec2 radialMapToBand(
  vec2 uv,
  float innerScreen,
  float outerScreen,
  float innerScene,
  float outerScene
) {
  float radius = length(uv);
  float angle = atan(uv.y, uv.x);
  float bandWidth = max(outerScreen - innerScreen, 0.0001);
  float t = clamp((radius - innerScreen) / bandWidth, 0.0, 1.0);
  float mappedRadius = mix(innerScene, outerScene, t);
  return vec2(cos(angle), sin(angle)) * mappedRadius;
}

vec2 radialMapToDisk(vec2 uv, float outerScreen, float outerScene) {
  float radius = length(uv);
  float angle = atan(uv.y, uv.x);
  float t = clamp(radius / max(outerScreen, 0.0001), 0.0, 1.0);
  float mappedRadius = t * outerScene;
  return vec2(cos(angle), sin(angle)) * mappedRadius;
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

float signedHash11(float p) {
  return hash11(p) * 2.0 - 1.0;
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
  float feather = clamp(width * 0.7, 0.00045, 0.02);
  return 1.0 - smoothstep(width, width + feather, d);
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

float revealFromCenter(float radius, float front, float feather) {
  return 1.0 - smoothstep(front - feather, front + feather, radius);
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
  float scenePhase
) {
  float inspectBlend = inspectMode;
  float ringCount = floor(mix(A.x + 0.5, min(A.x, 3.0), inspectBlend));
  float symmetry = mix(A.y, max(A.y * 0.82, 7.0), inspectBlend);
  float density = A.z;
  float aperture = A.w;
  float sharpness = B.x;
  float lineWidth = mix(B.y, min(B.y * 1.42, 1.0), inspectBlend);
  float petalBias = mix(B.z, B.z * 1.28 + 0.1, inspectBlend);
  float spokeBias = mix(B.w, B.w * 0.08, inspectBlend);
  float latticeBias = mix(C.x, C.x * 0.14, inspectBlend);
  float triangleBias = mix(C.y, C.y * 0.18, inspectBlend);
  float fillBias = mix(C.z, min(C.z * 1.35 + 0.08, 0.52), inspectBlend);
  float rotationSpeed = C.w;
  float pulseTravel = D.x;
  float centerWeight = D.y;
  float noiseWarp = D.z;
  float sacredness = E.y;
  float mutation = E.z;
  float seed = E.w;

  float motionTime = time * flowSpeed * mix(1.0, 0.12, inspectBlend);
  float warpNoise = fbm(p * (1.8 + density * 0.8 + noiseWarp * 2.0) + vec2(seed * 0.07, motionTime * mix(0.022, 0.004, inspectBlend)));
  vec2 warpDirection = normalize(p + vec2(0.0001, 0.0));
  p += warpDirection * (warpNoise - 0.5) * (0.015 + noiseWarp * 0.03) * mix(0.4 + mutation * 0.6, 0.08, inspectBlend);

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
    float localSymmetry = floor(clamp(mix(symmetry * 0.72, symmetry * 1.24, hash11(ringSeed + 1.2)) * density, 4.0, 28.0));
    float radius = mix(0.12, 0.84, ringT) * mix(0.94, 1.04, hash11(ringSeed + 2.1));
    float localLength = mix(0.72, 1.54, hash11(ringSeed + 3.4)) * mix(0.9, 1.08, petalBias) * mix(1.0, 0.58, inspectBlend);
    float localAperture = clamp(aperture + (hash11(ringSeed + 4.5) - 0.5) * (0.18 + mutation * 0.18) + inspectBlend * 0.12, 0.08, 0.78);
    float localSharpness = clamp((sharpness + (hash11(ringSeed + 5.6) - 0.5) * (0.36 + mutation * 1.1)) * mix(1.0, 0.72, inspectBlend), 0.6, 3.8);
    float localWidth = mix(0.0045, 0.011, lineWidth) * mix(1.0, 0.72, ringT) * mix(1.0, 1.45, inspectBlend);
    float rotation = motionTime * mix(-1.0, 1.0, hash11(ringSeed + 6.7)) * rotationSpeed * mix(1.0, 0.006, inspectBlend);
    rotation += (hash11(ringSeed + 7.8) - 0.5) * mutation * mix(0.4, 0.012, inspectBlend);
    vec2 rp = p * rotate2d(rotation);
    float localBreath = breath * mix(0.015, 0.085, hash11(ringSeed + 8.9)) * mix(1.0, 0.28, inspectBlend);
    float localPulse = pulse * mix(0.03, 0.16, hash11(ringSeed + 9.3)) * mix(1.0, 0.08, inspectBlend);
    float localRadius = radius * (1.0 + localBreath + localPulse * (0.12 + ringT * 0.12));

    float petal = petalLine(rp, localSymmetry, localRadius, localLength, localAperture, localSharpness, localWidth);
    float petalFillField = petalFill(rp, localSymmetry, localRadius, localLength, localAperture, localSharpness, localWidth);
    float spokes = spokeField(rp, localSymmetry, localRadius, localWidth);
    float lattice = latticeField(rp, localSymmetry, localRadius, localRadius * mix(0.18, 0.28, localAperture), localWidth * 0.9);
    float triangle = triangleField(rp, localRadius * mix(0.58, 0.96, ringT), localWidth, fi * PI / max(localSymmetry, 3.0));
    float angle = atan(rp.y, rp.x);
    float travellingPulse = pow(0.5 + 0.5 * cos(angle * localSymmetry - motionTime * pulseTravel * (0.8 + ringT) * mix(1.0, 0.02, inspectBlend) + ringSeed), 8.0);
    float beadPulse = band(abs(length(rp) - localRadius * mix(0.46, 0.82, localAperture)), localWidth * 0.55) *
      pow(0.5 + 0.5 * cos(angle * localSymmetry * 2.0 + ringSeed * 1.7), 10.0);

    float motifLine = (petal * petalBias + spokes * spokeBias + lattice * latticeBias + triangle * triangleBias) / totalWeight;
    lineField += motifLine + beadPulse * (0.1 + ringT * 0.12) * mix(1.0, 0.14, inspectBlend);
    fillField += mix(petalFillField, lattice * 0.4, latticeBias) * fillBias * (0.08 + ringT * 0.08);
    accentField += motifLine * travellingPulse * (0.22 + pulse * 0.26) * mix(1.0, 0.22, inspectBlend);
  }

  float radius = length(p);
  float coreGlow = exp(-pow(radius / mix(0.08, 0.16, centerWeight), 1.4));
  float bindu = exp(-pow(radius / 0.028, 1.7));
  float binduRing = band(abs(radius - mix(0.046, 0.082, 0.5 + 0.5 * sin(motionTime * mix(0.18, 0.025, inspectBlend)))), 0.0042);
  float auraNoise = fbm(p * (2.4 + densityBias * 1.4) + vec2(scenePhase * 2.0, motionTime * mix(0.02, 0.004, inspectBlend) + seed * 0.03));
  float aura = exp(-pow(radius / 0.88, 1.7)) * (0.05 + auraNoise * 0.04 + sacredness * 0.04);

  lineField = clamp(lineField + bindu * 0.9, 0.0, 1.5) * mix(1.0, 0.64, inspectBlend);
  fillField = clamp(fillField + aura + coreGlow * 0.08, 0.0, 1.1) * mix(1.0, 1.18, inspectBlend);
  accentField = clamp(accentField + binduRing * 0.4 + coreGlow * 0.16 + bindu * 0.7, 0.0, 1.0);
  return vec3(lineField, fillField, accentField);
}

vec3 tubeMandalaScene(
  vec2 p,
  float4 A,
  float4 B,
  float4 C,
  float4 D,
  float4 E,
  float breath
) {
  float ringCount = floor(clamp(A.x + 0.5, 3.0, 5.0));
  float symmetry = clamp(A.y * 0.58, 5.0, 10.0);
  float density = A.z;
  float aperture = clamp(A.w + 0.08, 0.12, 0.78);
  float sharpness = clamp(B.x * 0.82, 0.8, 2.4);
  float lineWidth = clamp(B.y * 1.16, 0.48, 1.0);
  float petalBias = max(B.z, 0.54);
  float spokeBias = B.w * 0.08;
  float latticeBias = C.x * 0.08;
  float fillBias = clamp(C.z + 0.14, 0.12, 0.58);
  float centerWeight = D.y;
  float sacredness = E.y;
  float seed = E.w;

  float warpNoise = fbm(p * (1.6 + density * 0.5) + vec2(seed * 0.05, seed * 0.031));
  vec2 warpDirection = normalize(p + vec2(0.0001, 0.0));
  p += warpDirection * (warpNoise - 0.5) * 0.007;

  float lineField = 0.0;
  float fillField = 0.0;
  float accentField = 0.0;
  float totalWeight = max(petalBias + spokeBias + latticeBias, 0.0001);
  float sceneRadius = length(p);
  float ringOuter = max(tubeRingOuterR, 0.55);
  float ringInner = clamp(tubeRingInnerR, 0.05, ringOuter - 0.05);
  float sceneGate =
    smoothstep(ringInner - 0.012, ringInner + 0.05, sceneRadius) *
    (1.0 - smoothstep(ringOuter - 0.06, ringOuter + 0.016, sceneRadius));

  for (int i = 0; i < 5; i++) {
    if (float(i) >= ringCount) {
      break;
    }

    float fi = float(i);
    float ringSeed = seed * 1.71 + fi * 19.3;
    float ringT = (fi + 1.0) / max(ringCount, 1.0);
    float localSymmetry = floor(clamp(mix(symmetry * 0.9, symmetry * 1.06, hash11(ringSeed + 1.2)), 5.0, 18.0));
    float radius = mix(0.12, 0.88, ringT) * mix(0.97, 1.03, hash11(ringSeed + 2.1));
    float localLength = mix(0.54, 0.78, hash11(ringSeed + 3.4)) * mix(0.96, 1.06, petalBias);
    float localAperture = clamp(aperture + 0.26 + (hash11(ringSeed + 4.5) - 0.5) * 0.1, 0.44, 0.88);
    float localSharpness = clamp(sharpness + (hash11(ringSeed + 5.6) - 0.5) * 0.24, 0.8, 2.8);
    float localWidth = mix(0.0052, 0.0125, lineWidth) * mix(1.0, 0.78, ringT);
    float rotation = signedHash11(ringSeed + 6.7) * 0.04;
    vec2 rp = p * rotate2d(rotation);
    float localBreath = breath * mix(0.01, 0.045, hash11(ringSeed + 8.9));
    float localRadius = radius * (1.0 + localBreath * (0.15 + ringT * 0.08));

    float petal = petalLine(rp, localSymmetry, localRadius, localLength, localAperture, localSharpness, localWidth);
    float petalFillField = petalFill(rp, localSymmetry, localRadius, localLength, localAperture, localSharpness, localWidth);
    float spokes = spokeField(rp, localSymmetry, localRadius, localWidth);
    float lattice = latticeField(rp, localSymmetry, localRadius, localRadius * mix(0.18, 0.24, localAperture), localWidth * 0.9);
    float motifLine = (petal * petalBias + spokes * spokeBias + lattice * latticeBias) / totalWeight;
    float ringPresence = sceneGate * mix(0.72, 1.18, smoothstep(0.0, 1.0, ringT));
    lineField += motifLine * ringPresence;
    fillField += mix(petalFillField, lattice * 0.25, latticeBias) * fillBias * (0.12 + ringT * 0.14) * ringPresence;
    accentField += petal * 0.05 * ringPresence;
  }

  float coreGlow = exp(-pow(sceneRadius / mix(0.09, 0.15, centerWeight), 1.45));
  float bindu = exp(-pow(sceneRadius / max(ringInner * 0.32, 0.018), 1.7));
  float auraNoise = fbm(p * (2.0 + densityBias * 1.1) + vec2(seed * 0.03, seed * 0.021));
  float aura = exp(-pow(sceneRadius / 0.9, 1.7)) * (0.03 + auraNoise * 0.025 + sacredness * 0.035);

  lineField = clamp(
    lineField +
      bindu * 0.08 * sceneGate +
      coreGlow * 0.03,
    0.0,
    1.35
  );
  fillField = clamp(fillField + aura * sceneGate + coreGlow * 0.02, 0.0, 1.1);
  accentField = clamp(accentField + bindu * 0.06 * sceneGate, 0.0, 0.6);
  return vec3(lineField, fillField, accentField);
}

vec3 tubeCoreScene(
  vec2 p,
  float4 A,
  float4 B,
  float4 C,
  float4 D,
  float4 E,
  float breath
) {
  float ringCount = floor(clamp(A.x + 0.5, 3.0, 5.0));
  float symmetry = clamp(A.y * 0.58, 5.0, 10.0);
  float density = A.z;
  float aperture = clamp(A.w + 0.08, 0.12, 0.78);
  float sharpness = clamp(B.x * 0.82, 0.8, 2.4);
  float lineWidth = clamp(B.y * 1.16, 0.48, 1.0);
  float petalBias = max(B.z, 0.54);
  float spokeBias = B.w * 0.08;
  float latticeBias = C.x * 0.08;
  float fillBias = clamp(C.z + 0.14, 0.12, 0.58);
  float centerWeight = D.y;
  float sacredness = E.y;
  float seed = E.w;

  float warpNoise = fbm(p * (1.6 + density * 0.5) + vec2(seed * 0.05, seed * 0.031));
  vec2 warpDirection = normalize(p + vec2(0.0001, 0.0));
  p += warpDirection * (warpNoise - 0.5) * 0.006;

  float lineField = 0.0;
  float fillField = 0.0;
  float accentField = 0.0;
  float totalWeight = max(petalBias + spokeBias + latticeBias, 0.0001);
  float sceneRadius = length(p);
  float ringOuter = max(tubeRingOuterR, 0.55);
  float coreGate = 1.0 - smoothstep(ringOuter - 0.06, ringOuter + 0.016, sceneRadius);

  for (int i = 0; i < 5; i++) {
    if (float(i) >= ringCount) {
      break;
    }

    float fi = float(i);
    float ringSeed = seed * 1.71 + fi * 19.3;
    float ringT = (fi + 1.0) / max(ringCount, 1.0);
    float localSymmetry = floor(clamp(mix(symmetry * 0.9, symmetry * 1.06, hash11(ringSeed + 1.2)), 5.0, 18.0));
    float radius = mix(0.1, 0.82, ringT) * mix(0.97, 1.03, hash11(ringSeed + 2.1));
    float localLength = mix(0.5, 0.74, hash11(ringSeed + 3.4)) * mix(0.96, 1.06, petalBias);
    float localAperture = clamp(aperture + 0.22 + (hash11(ringSeed + 4.5) - 0.5) * 0.08, 0.36, 0.82);
    float localSharpness = clamp(sharpness + (hash11(ringSeed + 5.6) - 0.5) * 0.2, 0.8, 2.8);
    float localWidth = mix(0.0052, 0.0125, lineWidth) * mix(1.0, 0.8, ringT);
    float rotation = signedHash11(ringSeed + 6.7) * 0.03;
    vec2 rp = p * rotate2d(rotation);
    float localBreath = breath * mix(0.01, 0.04, hash11(ringSeed + 8.9));
    float localRadius = radius * (1.0 + localBreath * (0.12 + ringT * 0.08));

    float petal = petalLine(rp, localSymmetry, localRadius, localLength, localAperture, localSharpness, localWidth);
    float petalFillField = petalFill(rp, localSymmetry, localRadius, localLength, localAperture, localSharpness, localWidth);
    float spokes = spokeField(rp, localSymmetry, localRadius, localWidth);
    float lattice = latticeField(rp, localSymmetry, localRadius, localRadius * mix(0.18, 0.24, localAperture), localWidth * 0.9);
    float motifLine = (petal * petalBias + spokes * spokeBias + lattice * latticeBias) / totalWeight;
    float ringPresence = coreGate * mix(0.78, 1.14, smoothstep(0.0, 1.0, ringT));
    lineField += motifLine * ringPresence;
    fillField += mix(petalFillField, lattice * 0.22, latticeBias) * fillBias * (0.14 + ringT * 0.12) * ringPresence;
    accentField += petal * 0.05 * ringPresence;
  }

  float coreGlow = exp(-pow(sceneRadius / mix(0.08, 0.14, centerWeight), 1.4));
  float bindu = exp(-pow(sceneRadius / 0.03, 1.7));
  float auraNoise = fbm(p * (2.0 + densityBias * 1.1) + vec2(seed * 0.03, seed * 0.021));
  float aura = exp(-pow(sceneRadius / 0.88, 1.7)) * (0.04 + auraNoise * 0.025 + sacredness * 0.03);

  lineField = clamp(lineField + bindu * 0.22 + coreGlow * 0.04, 0.0, 1.35);
  fillField = clamp(fillField + aura * coreGate + coreGlow * 0.06, 0.0, 1.1);
  accentField = clamp(accentField + bindu * 0.1, 0.0, 0.6);
  return vec3(lineField, fillField, accentField);
}

void layerUniforms(
  int index,
  out float4 A,
  out float4 B,
  out float4 C,
  out float4 D,
  out float4 E
) {
  if (index == 0) {
    A = layer0A; B = layer0B; C = layer0C; D = layer0D; E = layer0E; return;
  }
  if (index == 1) {
    A = layer1A; B = layer1B; C = layer1C; D = layer1D; E = layer1E; return;
  }
  if (index == 2) {
    A = layer2A; B = layer2B; C = layer2C; D = layer2D; E = layer2E; return;
  }
  if (index == 3) {
    A = layer3A; B = layer3B; C = layer3C; D = layer3D; E = layer3E; return;
  }
  if (index == 4) {
    A = layer4A; B = layer4B; C = layer4C; D = layer4D; E = layer4E; return;
  }
  A = layer5A; B = layer5B; C = layer5C; D = layer5D; E = layer5E;
}

half4 main(vec2 fragcoord) {
  float minRes = min(resolution.x, resolution.y);
  vec2 uv = (fragcoord - resolution * 0.5) / minRes;
  float motionTime = time * flowSpeed;
  float flow = sceneTime;
  if (tubeMode > 0.5) {
    flow = tubeGeometryTime;
    float breath = 0.5 + 0.5 * sin(motionTime * 0.12);
    float radius = length(uv);
    float phase = fract(flow);
    float ringOuter = max(tubeRingOuterR, 0.55);
    float stackOuterLimit = 1.24;
    float stackStep = stackOuterLimit / float(${TUBE_VISIBLE_LAYER_COUNT});
    float coreRadius = phase * stackStep;
    float previewRadius = max(coreRadius, clamp(tubeBinduOuterR, 0.055, 0.16));
    float feather = 0.0075;
    vec3 color = vec3(0.0);

    for (int raw = 0; raw < ${TUBE_VISIBLE_LAYER_COUNT - 1}; raw++) {
      int i = ${TUBE_VISIBLE_LAYER_COUNT - 2} - raw;
      int layerIndex = i + 1;
      float fi = float(i);
      float innerRadius = coreRadius + fi * stackStep;
      float outerRadius = innerRadius + stackStep;
      float outerMask = 1.0 - smoothstep(outerRadius - feather, outerRadius + feather, radius);
      float innerMask = 1.0 - smoothstep(innerRadius - feather, innerRadius + feather, radius);
      float visibleMask = clamp(outerMask - innerMask, 0.0, 1.0);
      float fade = 1.0 - smoothstep(1.18, 1.62, outerRadius) * 0.78;

      float4 A;
      float4 B;
      float4 C;
      float4 D;
      float4 E;
      layerUniforms(layerIndex, A, B, C, D, E);

      vec2 diskUv = radialMapToDisk(uv, max(outerRadius, 0.0006), ringOuter);
      vec3 scene = tubeCoreScene(diskUv, A, B, C, D, E, breath);
      vec3 lineColor = paletteByPhase(D.w, fract(D.w + 0.21), 0.5 + densityBias * 0.14 + fi * 0.024);
      vec3 fillColor = mix(lineColor, vec3(1.0, 0.95, 0.98), 0.22);
      vec3 accentColor = mix(vec3(1.0, 0.96, 0.98), lineColor, 0.36);
      float boundaryLine = band(abs(radius - outerRadius), feather * 0.34);

      color += fillColor * scene.y * 0.3 * visibleMask * fade;
      color += lineColor * scene.x * 0.22 * visibleMask * fade;
      color += accentColor * scene.z * 0.18 * visibleMask * fade;
      color += mix(vec3(1.0, 0.97, 0.99), lineColor, 0.24) * boundaryLine * 0.1 * fade;
    }

    float previewMask = 1.0 - smoothstep(previewRadius - feather, previewRadius + feather, radius);
    vec2 previewUv = radialMapToDisk(uv, max(previewRadius, 0.0006), stackOuterLimit);
    float previewLocalRadius = length(previewUv);
    vec3 previewColor = vec3(0.0);

    for (int j = 0; j < ${TUBE_VISIBLE_LAYER_COUNT - 1}; j++) {
      float fj = float(j);
      float previewInner = coreRadius + fj * stackStep;
      float previewOuter = previewInner + stackStep;
      float previewOuterMask =
        1.0 - smoothstep(previewOuter - feather, previewOuter + feather, previewLocalRadius);
      float previewInnerMask =
        1.0 - smoothstep(previewInner - feather, previewInner + feather, previewLocalRadius);
      float previewShellMask = clamp(previewOuterMask - previewInnerMask, 0.0, 1.0);

      float4 A;
      float4 B;
      float4 C;
      float4 D;
      float4 E;
      layerUniforms(j + 1, A, B, C, D, E);

      vec2 bandUv = radialMapToBand(previewUv, previewInner, previewOuter, tubeRingInnerR, ringOuter);
      vec3 scene = tubeMandalaScene(bandUv, A, B, C, D, E, breath);
      vec3 lineColor = paletteByPhase(D.w, fract(D.w + 0.18), 0.48 + densityBias * 0.12 + fj * 0.02);
      vec3 fillColor = mix(lineColor, vec3(1.0, 0.96, 0.99), 0.24);
      float previewBoundary = band(abs(previewLocalRadius - previewOuter), feather * 0.34);

      previewColor += fillColor * scene.y * 0.14 * previewShellMask;
      previewColor += lineColor * scene.x * 0.12 * previewShellMask;
      previewColor += mix(vec3(1.0, 0.97, 0.99), lineColor, 0.22) * previewBoundary * 0.06;
    }

    float previewCoreRadius = max(coreRadius, stackStep * 0.22);
    float previewCoreMask =
      1.0 - smoothstep(previewCoreRadius - feather, previewCoreRadius + feather, previewLocalRadius);
    vec2 previewCoreUv = radialMapToDisk(previewUv, max(previewCoreRadius, 0.0006), ringOuter);
    vec3 previewCoreScene = tubeCoreScene(previewCoreUv, layer0A, layer0B, layer0C, layer0D, layer0E, breath);
    vec3 previewCoreColor = paletteByPhase(layer0D.w, fract(layer0D.w + 0.17), 0.58 + densityBias * 0.12);
    vec3 previewCoreFill = mix(previewCoreColor, vec3(1.0, 0.97, 0.99), 0.34);
    float previewCoreBoundary = band(abs(previewLocalRadius - previewCoreRadius), feather * 0.34);
    previewColor += previewCoreFill * previewCoreScene.y * 0.22 * previewCoreMask;
    previewColor += previewCoreColor * previewCoreScene.x * 0.16 * previewCoreMask;
    previewColor += mix(vec3(1.0, 0.97, 0.99), previewCoreColor, 0.24) * previewCoreBoundary * 0.08;

    color += previewColor * previewMask;

    color += vec3(1.0, 0.96, 0.98) * exp(-pow(radius / 0.06, 1.45)) * 0.06;
    color *= 1.0 - smoothstep(1.35, 1.78, radius) * 0.28;
    return half4(color, 1.0);
  }

  float breath = 0.5 + 0.5 * sin(motionTime * mix(0.19, 0.03, inspectMode));
  float pulse = pow(0.5 + 0.5 * sin(motionTime * mix(1.22, 0.08, inspectMode)), 2.2);
  float alphaFlicker = 0.5 + 0.5 * sin(motionTime * TAU * mix(8.7, 0.06, inspectMode));
  vec3 color = vec3(0.0);

  for (int i = 0; i < ${DEPTH_LAYER_COUNT}; i++) {
    float fi = float(i);
    float inspectGate = mix(1.0, 1.0 - step(2.5, fi), inspectMode);
    float normalSlicePhase = fract(flow + fi / float(${DEPTH_LAYER_COUNT}));
    float inspectSlicePhase = fract(motionTime * 0.048 + fi * 0.31);
    float slicePhase = mix(normalSlicePhase, inspectSlicePhase, inspectMode);
    float normalSliceScale = exp2(mix(-4.2, 2.2, normalSlicePhase));
    float inspectSliceScale = exp2(mix(-2.25, 0.9, inspectSlicePhase));
    float sliceScale = mix(normalSliceScale, inspectSliceScale, inspectMode);
    float4 A;
    float4 B;
    float4 C;
    float4 D;
    float4 E;
    layerUniforms(i, A, B, C, D, E);
    vec2 inspectDrift = vec2(
      sin(motionTime * 0.22 + fi * 1.7),
      cos(motionTime * 0.17 + fi * 1.3)
    ) * (1.0 - inspectSlicePhase) * 0.045;
    vec2 sceneUv = mix(uv, uv + inspectDrift, inspectMode);
    vec3 scene = mandalaScene(sceneUv / sliceScale, A, B, C, D, E, breath, pulse, slicePhase);
    float normalVisibility =
      smoothstep(0.04, 0.2, slicePhase) *
      (1.0 - smoothstep(0.74, 0.96, slicePhase));
    normalVisibility *= mix(0.62, 1.0, 1.0 - slicePhase);
    float inspectVisibility =
      smoothstep(0.02, 0.16, inspectSlicePhase) *
      (1.0 - smoothstep(0.76, 0.98, inspectSlicePhase));
    inspectVisibility *= mix(0.36, 1.0, smoothstep(0.12, 0.82, inspectSlicePhase));
    float visibility = mix(normalVisibility, inspectVisibility * inspectGate, inspectMode);
    vec3 lineColor = paletteByPhase(D.w, fract(D.w + 0.23), 0.52 + densityBias * 0.18);
    vec3 fillColor = mix(lineColor, vec3(1.0, 0.95, 0.98), 0.22);
    vec3 accentColor = mix(vec3(1.0, 0.96, 0.98), lineColor, 0.34);
    color += fillColor * scene.y * mix(0.22, 0.3, inspectMode) * visibility;
    color += lineColor * scene.x * mix(0.34 + alphaFlicker * 0.015, 0.18, inspectMode) * visibility;
    color += accentColor * scene.z * mix(0.3, 0.18, inspectMode) * visibility;
  }

  color += vec3(1.0, 0.96, 0.98) * exp(-pow(length(uv) / 0.08, 1.4)) * (0.12 + pulse * 0.16);
  return half4(color, 1.0);
}
`;

const effect = Skia.RuntimeEffect.Make(SHADER_SOURCE);

if (!effect) {
  throw new Error("Failed to compile Bindu Succession Flow shader.");
}

const EFFECT = effect;

export interface BinduSuccessionFlowCanvasProps {
  isActive?: boolean;
  sceneOffset?: number;
  densityBias?: number;
  sessionSeed?: number;
  flowSpeed?: number;
  inspectMode?: boolean;
  tubeMode?: boolean;
  /** Нормализованный радиус внешнего кольца мандалы в пространстве tube-сцены (совпадает с внешним кольцом кольцевого пояса). */
  tubeRingOuterR?: number;
  /** Нормализованный радиус внутреннего кольца (граница «дырки» / следующего уровня). Подбирается под визуальный разрыв. */
  tubeRingInnerR?: number;
  /** Внешний радиус биджи в пространстве сцены; внутри — превью следующей мандалы. Меньше `tubeRingInnerR`. */
  tubeBinduOuterR?: number;
}

export function BinduSuccessionFlowCanvas({
  isActive = true,
  sceneOffset = 0,
  densityBias = 0.5,
  sessionSeed = 1,
  flowSpeed = 1,
  inspectMode = false,
  tubeMode = false,
  tubeRingOuterR = 0.88,
  tubeRingInnerR = 0.24,
  tubeBinduOuterR = 0.11,
}: BinduSuccessionFlowCanvasProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const timeSeconds = useAnimationClock(isActive);
  const genomes = useMemo(() => buildGenomeSequence(sessionSeed, densityBias), [densityBias, sessionSeed]);
  const streamSceneTime = (timeSeconds * flowSpeed) / SCENE_DURATION_SECONDS + sceneOffset;
  const tubeGeometrySceneTime = (timeSeconds * flowSpeed) / TUBE_SCENE_DURATION_SECONDS + sceneOffset;
  const sceneTime = tubeMode ? tubeGeometrySceneTime : streamSceneTime;
  const streamLayerGenomes = useMemo(
    () =>
      Array.from({ length: DEPTH_LAYER_COUNT }, (_, index) =>
        sampleGenomeAtPosition(genomes, streamSceneTime + index / DEPTH_LAYER_COUNT),
      ),
    [genomes, streamSceneTime],
  );
  const tubeLayerGenomes = useMemo(() => {
    const geometryGeneration = Math.floor(tubeGeometrySceneTime);
    const geometryToGenomeRatio = TUBE_SCENE_DURATION_SECONDS / TUBE_GENOME_SCENE_DURATION_SECONDS;
    return Array.from({ length: TUBE_VISIBLE_LAYER_COUNT }, (_, index) => {
      const generation = geometryGeneration + 1 - index;
      const genomePosition = generation * geometryToGenomeRatio + sceneOffset + TUBE_GENOME_PHASE_OFFSET;
      return sampleGenomeAtPosition(genomes, genomePosition);
    });
  }, [genomes, sceneOffset, tubeGeometrySceneTime]);
  const layerGenomes = tubeMode ? tubeLayerGenomes : streamLayerGenomes;
  const layer5Genome = layerGenomes[5] ?? layerGenomes[layerGenomes.length - 1];
  const uniforms = useMemo(
    () => ({
      resolution: [Math.max(size.width, 1), Math.max(size.height, 1)],
      time: timeSeconds,
      sceneTime,
      tubeGeometryTime: tubeGeometrySceneTime,
      densityBias,
      flowSpeed,
      inspectMode: inspectMode ? 1 : 0,
      tubeMode: tubeMode ? 1 : 0,
      tubeRingOuterR,
      tubeRingInnerR,
      tubeBinduOuterR,
      layer0A: toUniformA(layerGenomes[0]),
      layer0B: toUniformB(layerGenomes[0]),
      layer0C: toUniformC(layerGenomes[0]),
      layer0D: toUniformD(layerGenomes[0]),
      layer0E: toUniformE(layerGenomes[0]),
      layer1A: toUniformA(layerGenomes[1]),
      layer1B: toUniformB(layerGenomes[1]),
      layer1C: toUniformC(layerGenomes[1]),
      layer1D: toUniformD(layerGenomes[1]),
      layer1E: toUniformE(layerGenomes[1]),
      layer2A: toUniformA(layerGenomes[2]),
      layer2B: toUniformB(layerGenomes[2]),
      layer2C: toUniformC(layerGenomes[2]),
      layer2D: toUniformD(layerGenomes[2]),
      layer2E: toUniformE(layerGenomes[2]),
      layer3A: toUniformA(layerGenomes[3]),
      layer3B: toUniformB(layerGenomes[3]),
      layer3C: toUniformC(layerGenomes[3]),
      layer3D: toUniformD(layerGenomes[3]),
      layer3E: toUniformE(layerGenomes[3]),
      layer4A: toUniformA(layerGenomes[4]),
      layer4B: toUniformB(layerGenomes[4]),
      layer4C: toUniformC(layerGenomes[4]),
      layer4D: toUniformD(layerGenomes[4]),
      layer4E: toUniformE(layerGenomes[4]),
      layer5A: toUniformA(layer5Genome),
      layer5B: toUniformB(layer5Genome),
      layer5C: toUniformC(layer5Genome),
      layer5D: toUniformD(layer5Genome),
      layer5E: toUniformE(layer5Genome),
    }),
    [
      densityBias,
      flowSpeed,
      inspectMode,
      layer5Genome,
      layerGenomes,
      sceneTime,
      size.height,
      size.width,
      timeSeconds,
      tubeGeometrySceneTime,
      tubeBinduOuterR,
      tubeMode,
      tubeRingInnerR,
      tubeRingOuterR,
    ],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View onLayout={handleLayout} style={styles.container}>
      <Canvas style={styles.canvas}>
        <Fill color="#000000" />
        <Fill>
          <Shader source={EFFECT} uniforms={uniforms} />
        </Fill>
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
