import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";

import type {
  BioSignalFrame,
  EvolutionProfile,
  PalettePreset,
  PetalProfile,
  RevealMode,
  MandalaSessionState,
  VisualRecipe,
} from "@/modules/mandala/core/types";
import { EVOLUTION_SHADER_SHARED_BLOCK } from "@/modules/mandala/ui/evolution-shader";
import { getEvolutionShaderBlock } from "@/modules/mandala/ui/evolution-registry";

function visualRecipeToUniform(recipe: VisualRecipe): number {
  switch (recipe) {
    case "tunnelBloom":
      return 1;
    case "yantraPulse":
      return 2;
    case "fractalBloom":
      return 3;
    case "metatronPortal":
      return 4;
    case "lotusBloom":
    default:
      return 0;
  }
}

function revealModeToUniform(mode: RevealMode): number {
  switch (mode) {
    case "irisWave":
      return 1;
    case "pulseGate":
      return 2;
    case "centerBloom":
    default:
      return 0;
  }
}

function palettePresetToUniform(palette: PalettePreset): number {
  switch (palette) {
    case "violetMist":
      return 1;
    case "emeraldDream":
      return 2;
    case "sunsetRose":
      return 3;
    case "midnightGold":
    default:
      return 0;
  }
}

function petalProfileToUniform(profile: PetalProfile): number {
  switch (profile) {
    case "almond":
      return 1;
    case "lotusSpear":
      return 2;
    case "roundedSpoon":
      return 3;
    case "flame":
      return 4;
    case "heartPetal":
      return 5;
    case "splitPetal":
      return 6;
    case "oval":
      return 7;
    case "teardrop":
    default:
      return 0;
  }
}

function evolutionProfileToUniform(profile: EvolutionProfile): number {
  switch (profile) {
    case "spiralDrift":
      return 1;
    case "tidalBreath":
      return 2;
    case "haloCascade":
      return 3;
    case "rebirth":
    default:
      return 0;
  }
}

export type RenderMode = "static" | "evolving";

function renderModeToUniform(mode: RenderMode): number {
  switch (mode) {
    case "evolving":
      return 1;
    case "static":
    default:
      return 0;
  }
}

function buildLayerUniforms(
  sessionState: MandalaSessionState,
  bioFrame: BioSignalFrame,
  size: { width: number; height: number },
  timeSeconds: number,
  renderMode: RenderMode,
  layerRole: number,
) {
  return {
    resolution: [Math.max(size.width, 1), Math.max(size.height, 1)],
    time: timeSeconds,
    topologyType: sessionState.geometry.topologyType,
    morphTarget: sessionState.kinetics.morphTarget,
    progressionMode: sessionState.geometry.progressionMode,
    gridType: sessionState.geometry.gridType,
    sacredPreset: sessionState.geometry.sacredPreset,
    lineMask: sessionState.geometry.lineMask,
    ringDensity: sessionState.geometry.ringDensity,
    beamCount: sessionState.geometry.beamCount,
    aperture: sessionState.geometry.aperture,
    twistFactor: sessionState.geometry.twistFactor,
    spiralOrder: sessionState.geometry.spiralOrder,
    overlapFactor: sessionState.geometry.overlapFactor,
    binduSize: sessionState.geometry.binduSize,
    curvature: sessionState.primitives.curvature,
    vertices: sessionState.primitives.vertices,
    strokeWidth: sessionState.primitives.strokeWidth,
    complexity: sessionState.primitives.complexity,
    fractalDimension: sessionState.complexity.fractalDimension,
    recursionDepth: sessionState.complexity.recursionDepth,
    symmetryDeviation: sessionState.imperfection.symmetryDeviation,
    hueMain: sessionState.appearance.hueMain,
    hueRange: sessionState.appearance.hueRange,
    saturation: sessionState.appearance.saturation,
    luminanceBase: sessionState.appearance.luminanceBase,
    ganzfeldMode: sessionState.appearance.ganzfeldMode ? 1 : 0,
    targetHz: sessionState.modulation.targetHz,
    waveform: sessionState.modulation.waveform,
    dutyCycle: sessionState.modulation.dutyCycle,
    zoomVelocity: sessionState.kinetics.zoomVelocity,
    rotationVelocity: sessionState.kinetics.rotationVelocity,
    motionLogic: sessionState.kinetics.motionLogic,
    breathPhase: bioFrame.breathPhase,
    pulsePhase: bioFrame.pulsePhase,
    breathRate: bioFrame.breathRate,
    pulseRate: bioFrame.pulseRate,
    rmssd: bioFrame.rmssd,
    stressIndex: bioFrame.stressIndex,
    breathToScaleWeight: sessionState.bioWeights.breathToScale,
    pulseToGlowWeight: sessionState.bioWeights.pulseToGlow,
    rmssdToComplexityWeight: sessionState.bioWeights.rmssdToComplexity,
    stressToEntropyWeight: sessionState.bioWeights.stressToEntropy,
    visualRecipe: visualRecipeToUniform(sessionState.artDirection.visualRecipe),
    layerCount: sessionState.artDirection.layerCount,
    petalOpacity: sessionState.artDirection.petalOpacity,
    ornamentDensity: sessionState.artDirection.ornamentDensity,
    depthStrength: sessionState.artDirection.depthStrength,
    glowStrength: sessionState.artDirection.glowStrength,
    revealMode: revealModeToUniform(sessionState.artDirection.revealMode),
    palettePreset: palettePresetToUniform(sessionState.artDirection.palettePreset),
    petalProfile: petalProfileToUniform(sessionState.artDirection.petalProfile),
    evolutionProfile: evolutionProfileToUniform(sessionState.artDirection.evolutionProfile),
    renderMode: renderModeToUniform(renderMode),
    layerRole,
  };
}

function buildShaderSource(evolutionShaderBlock: string) {
  return `
// shader-source-version: petal-profiles-v1
uniform float2 resolution;
uniform float time;
uniform int topologyType;
uniform int morphTarget;
uniform int progressionMode;
uniform int gridType;
uniform int sacredPreset;
uniform int lineMask;
uniform float ringDensity;
uniform float beamCount;
uniform float aperture;
uniform float twistFactor;
uniform float spiralOrder;
uniform float overlapFactor;
uniform float binduSize;
uniform float curvature;
uniform float vertices;
uniform float strokeWidth;
uniform float complexity;
uniform float fractalDimension;
uniform float recursionDepth;
uniform float symmetryDeviation;
uniform float hueMain;
uniform float hueRange;
uniform float saturation;
uniform float luminanceBase;
uniform float ganzfeldMode;
uniform float targetHz;
uniform int waveform;
uniform float dutyCycle;
uniform float zoomVelocity;
uniform float rotationVelocity;
uniform int motionLogic;
uniform float breathPhase;
uniform float pulsePhase;
uniform float breathRate;
uniform float pulseRate;
uniform float rmssd;
uniform float stressIndex;
uniform float breathToScaleWeight;
uniform float pulseToGlowWeight;
uniform float rmssdToComplexityWeight;
uniform float stressToEntropyWeight;
uniform int visualRecipe;
uniform int layerCount;
uniform float petalOpacity;
uniform float ornamentDensity;
uniform float depthStrength;
uniform float glowStrength;
uniform int revealMode;
uniform int palettePreset;
uniform int petalProfile;
uniform int evolutionProfile;
uniform int renderMode;
uniform int layerRole;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
const float PHI = 1.61803398875;

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 paletteColor(int preset, float t) {
  if (preset == 1) {
    return hsv2rgb(vec3(fract(0.73 + t * 0.08), 0.28 + t * 0.18, 0.36 + t * 0.42));
  }
  if (preset == 2) {
    return hsv2rgb(vec3(fract(0.38 + t * 0.1), 0.34 + t * 0.22, 0.34 + t * 0.38));
  }
  if (preset == 3) {
    return hsv2rgb(vec3(fract(0.96 + t * 0.06), 0.42 + t * 0.18, 0.38 + t * 0.44));
  }
  return hsv2rgb(vec3(fract(0.11 + t * 0.05), 0.18 + t * 0.2, 0.4 + t * 0.45));
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

vec2 hash21(float p) {
  return vec2(
    fract(sin(p * 127.1) * 43758.5453123),
    fract(sin((p + 11.7) * 311.7) * 43758.5453123)
  );
}

${EVOLUTION_SHADER_SHARED_BLOCK}

float band(float d, float width) {
  float feather = clamp(width * 0.6, 0.00045, 0.0045);
  return 1.0 - smoothstep(width, width + feather, d);
}

float hexRadius(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

vec2 hexCell(vec2 p) {
  vec2 q = vec2(p.x * 2.0 / 1.7320508, p.y + p.x * 0.57735026);
  vec2 qi = floor(q + 0.5);
  vec2 f = q - qi;
  return vec2((f.x * 1.7320508) * 0.5, f.y - f.x * 0.5);
}

float flowerPattern(vec2 p, float overlap, float width) {
  vec2 grid = hexCell(p * 4.0);
  float r = 0.32 * overlap;
  float d = abs(length(grid) - r);
  return band(d, width);
}

float triangleSdf(vec2 p, float scale, float flip) {
  p *= scale;
  p.y *= flip;
  const float k = 1.7320508;
  p.x = abs(p.x) - 1.0;
  p.y = p.y + 1.0 / k;
  if (p.x + k * p.y > 0.0) {
    p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  }
  p.x -= clamp(p.x, -2.0, 0.0);
  return -length(p) * sign(p.y);
}

float sriYantraPattern(vec2 p, float width, float bindu) {
  float triUp = abs(triangleSdf(p, 1.6, 1.0));
  float triUpInner = abs(triangleSdf(p * rotate2d(PI / 15.0) * 1.12, 1.95, 1.0));
  float triDown = abs(triangleSdf(p * rotate2d(PI / 9.0), 1.35, -1.0));
  float triDownInner = abs(triangleSdf(p * rotate2d(-PI / 12.0) * 1.18, 1.72, -1.0));
  float triInner = abs(triangleSdf(p * rotate2d(-PI / 7.0), 2.0, 1.0));
  float ring = abs(length(p) - 0.42);
  float d = min(triUp, min(triUpInner, min(triDown, min(triDownInner, min(triInner, ring)))));
  float binduRing = abs(length(p) - bindu);
  return max(band(d, width), band(binduRing, width * 0.9));
}

float lineDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

bool maskEnabled(int mask, int bit) {
  float normalizedMask = floor(float(mask) / float(bit));
  return mod(normalizedMask, 2.0) >= 1.0;
}

float metatronPattern(vec2 p, float overlap, float width, int mask) {
  float ring = flowerPattern(p, overlap, width);
  float lineField = 0.0;
  float circleField = 0.0;
  vec2 a = vec2(0.0, 0.56);
  vec2 b = vec2(-0.48, -0.28);
  vec2 c = vec2(0.48, -0.28);
  vec2 d = vec2(0.0, -0.56);
  vec2 e = vec2(-0.56, 0.0);
  vec2 f = vec2(0.56, 0.0);
  vec2 g = vec2(-0.28, 0.48);
  vec2 h = vec2(0.28, 0.48);
  vec2 i = vec2(-0.28, -0.48);
  vec2 j = vec2(0.28, -0.48);
  circleField = max(circleField, band(abs(length(p) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - a) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - b) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - c) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - d) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - e) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - f) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - g) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - h) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - i) - (0.18 * overlap)), width * 0.85));
  circleField = max(circleField, band(abs(length(p - j) - (0.18 * overlap)), width * 0.85));
  if (maskEnabled(mask, 1)) {
    lineField = max(lineField, band(lineDistance(p, a, b), width));
    lineField = max(lineField, band(lineDistance(p, a, c), width));
    lineField = max(lineField, band(lineDistance(p, b, c), width));
  }
  if (maskEnabled(mask, 2)) {
    lineField = max(lineField, band(lineDistance(p, b, d), width));
    lineField = max(lineField, band(lineDistance(p, c, d), width));
    lineField = max(lineField, band(lineDistance(p, vec2(-0.56, 0.0), vec2(0.56, 0.0)), width));
  }
  if (maskEnabled(mask, 4)) {
    lineField = max(lineField, band(lineDistance(p, vec2(-0.42, 0.42), vec2(0.42, -0.42)), width));
    lineField = max(lineField, band(lineDistance(p, vec2(-0.42, -0.42), vec2(0.42, 0.42)), width));
  }
  return max(max(ring, lineField), circleField * 0.84);
}

float topologyPattern(int topology, vec2 p, float density, float width) {
  vec2 polar = vec2(atan(p.y, p.x), length(p));
  if (topology == 0) {
    float progression = float(progressionMode == 1) * 0.8 + float(progressionMode == 2) * 1.4;
    float spacing = density * (1.0 + progression * (1.0 - polar.y));
    return band(abs(fract(polar.y * spacing - time * zoomVelocity * 0.08) - 0.5), width);
  }
  if (topology == 1) {
    float petals = abs(sin(polar.x * max(3.0, beamCount * 0.5)));
    float openness = mix(0.02, 0.48, aperture);
    float radial = abs(fract(polar.y * density * 0.5 + time * 0.08) - 0.5);
    return band(abs(petals - openness) + radial * 0.3, width * 1.2);
  }
  if (topology == 2) {
    float spiral = abs(sin(polar.x * max(1.0, spiralOrder) + polar.y * twistFactor * 4.0 - time * 0.6));
    return band(spiral, width * 1.15);
  }
  if (topology == 3) {
    vec2 lattice = p * (2.4 + density * 0.1);
    if (gridType == 6) {
      float d = abs(hexRadius(hexCell(lattice)) - 0.38);
      return band(d, width * 1.1);
    }
    if (gridType == 3) {
      float tri = abs(triangleSdf(fract(lattice) - 0.5, 3.4, 1.0));
      return band(tri, width * 1.3);
    }
    float square = min(abs(fract(lattice.x) - 0.5), abs(fract(lattice.y) - 0.5));
    return band(square, width);
  }

  if (sacredPreset == 1) {
    return flowerPattern(p, overlapFactor, width);
  }
  if (sacredPreset == 2) {
    return sriYantraPattern(p, width, binduSize);
  }
  return metatronPattern(p, overlapFactor, width, lineMask);
}

float radialRosette(vec2 p, float petals, float radius, float width) {
  vec2 polar = vec2(atan(p.y, p.x), length(p));
  float petalShape = 0.58 + 0.42 * (0.5 + 0.5 * cos(polar.x * petals));
  float shell = abs(polar.y - radius * petalShape);
  return band(shell, width);
}

float ornamentalBands(vec2 p, float density, float width) {
  vec2 polar = vec2(atan(p.y, p.x), length(p));
  float spokes = abs(sin(polar.x * density));
  float rings = abs(fract(polar.y * (density * 0.72)) - 0.5);
  return band(spokes * 0.22 + rings * 0.9, width);
}

float lotusFlowerField(
  vec2 p,
  float petals,
  float width,
  float apertureValue,
  float overlapValue,
  float ornamentValue,
  float detailMultiplier
) {
  vec2 polar = vec2(atan(p.y, p.x), length(p));
  float safePetals = max(2.0, petals);
  float cosinePetal = 0.5 + 0.5 * cos(polar.x * safePetals);
  float axisDistance = 1.0 - cosinePetal;
  float overlapMix = clamp((overlapValue - 0.82) / 0.42, 0.0, 1.0);
  float curvePower = mix(0.8, 2.6, clamp(curvature, 0.0, 1.0));
  float aperturePower = mix(3.8, 1.1, clamp(apertureValue, 0.0, 1.0));
  float innerRadius = mix(0.025, 0.09, overlapMix);
  float outerRadius = mix(0.24, 0.46, overlapMix);
  float neckPower = mix(0.42, 0.92, apertureValue);
  float shoulderPower = mix(1.6, 4.2, clamp(curvature, 0.0, 1.0));
  float axisPower = mix(0.45, 1.1, apertureValue);
  float tipBoost = 1.0;
  float baseTightness = 1.0;
  float neckWidth = 0.24;
  float neckMixA = 0.22;
  float neckMixB = 0.96;
  float ridgeWeight = 0.46;
  float shoulderBias = 0.0;
  float splitTip = 0.0;
  float tipNotch = 0.0;
  float rootCurve = 0.72;
  float rootCupWidth = 0.16;
  float rootCupLift = 0.0;
  float rootCupWeight = 0.42;
  float rootAnchorScale = 0.12;
  float rootSocketWidth = 0.38;
  float rootSocketWeight = 0.18;
  float innerContourWeight = 1.0;
  int blendMode = 0;

  if (petalProfile == 1) {
    curvePower *= 1.45;
    aperturePower = mix(2.2, 0.82, apertureValue);
    innerRadius *= 1.18;
    outerRadius *= 0.82;
    neckPower = mix(0.62, 1.1, apertureValue);
    axisPower = mix(0.9, 1.9, apertureValue);
    neckMixA = 0.62;
    neckMixB = 1.08;
    neckWidth = 0.14;
    ridgeWeight = 0.18;
    rootCurve = 0.84;
    rootCupWidth = 0.12;
    rootCupWeight = 0.26;
    rootAnchorScale = 0.08;
    rootSocketWeight = 0.16;
    blendMode = 1;
  } else if (petalProfile == 2) {
    curvePower *= 1.35;
    aperturePower = mix(4.6, 1.2, apertureValue);
    outerRadius *= 1.12;
    tipBoost = 1.08;
    neckMixA = 0.18;
    neckMixB = 0.84;
    neckWidth = 0.16;
    baseTightness = 0.88;
    rootCurve = 0.62;
    rootCupWidth = 0.14;
    rootCupWeight = 0.34;
    rootAnchorScale = 0.1;
    rootSocketWidth = 0.34;
    rootSocketWeight = 0.14;
  } else if (petalProfile == 3) {
    curvePower *= 0.58;
    aperturePower = mix(1.2, 0.62, apertureValue);
    innerRadius *= 1.4;
    outerRadius *= 0.76;
    tipBoost = 0.94;
    baseTightness = 1.32;
    neckMixA = 0.84;
    neckMixB = 1.2;
    neckWidth = 0.14;
    ridgeWeight = 0.08;
    rootCurve = 0.94;
    rootCupWidth = 0.1;
    rootCupWeight = 0.18;
    rootAnchorScale = 0.06;
    rootSocketWidth = 0.28;
    rootSocketWeight = 0.1;
    blendMode = 2;
  } else if (petalProfile == 4) {
    curvePower *= 1.55;
    aperturePower = mix(4.9, 1.34, apertureValue);
    outerRadius *= 1.08;
    tipBoost = 1.12;
    baseTightness = 0.82;
    shoulderBias = 0.08;
    neckMixA = 0.12;
    neckMixB = 0.72;
    neckWidth = 0.14;
    rootCurve = 0.56;
    rootCupWidth = 0.12;
    rootCupLift = 0.06;
    rootCupWeight = 0.26;
    rootAnchorScale = 0.08;
    rootSocketWeight = 0.2;
  } else if (petalProfile == 5) {
    curvePower *= 1.08;
    aperturePower = mix(3.2, 1.0, apertureValue);
    innerRadius *= 1.02;
    outerRadius *= 0.98;
    shoulderBias = 0.12;
    neckMixA = 0.32;
    neckMixB = 0.92;
    neckWidth = 0.18;
    tipNotch = smoothstep(0.72, 0.98, cosinePetal) * 0.028;
    rootCurve = 0.68;
    rootCupWidth = 0.12;
    rootCupWeight = 0.28;
    rootAnchorScale = 0.09;
    rootSocketWeight = 0.2;
    ridgeWeight = 0.06;
    innerContourWeight = 0.08;
  } else if (petalProfile == 6) {
    curvePower *= 1.12;
    aperturePower = mix(3.6, 1.02, apertureValue);
    splitTip = 0.0;
    tipNotch = smoothstep(0.82, 1.0, cosinePetal) * 0.052;
    neckMixA = 0.26;
    neckMixB = 0.88;
    neckWidth = 0.18;
    ridgeWeight = 0.12;
    rootCurve = 0.7;
    rootCupWidth = 0.12;
    rootCupWeight = 0.24;
    rootAnchorScale = 0.08;
    rootSocketWidth = 0.32;
    rootSocketWeight = 0.12;
  } else if (petalProfile == 7) {
    curvePower *= 0.5;
    aperturePower = mix(0.94, 0.54, apertureValue);
    innerRadius *= 1.55;
    outerRadius *= 0.72;
    tipBoost = 0.9;
    baseTightness = 1.45;
    axisPower = mix(1.05, 2.1, apertureValue);
    neckMixA = 0.88;
    neckMixB = 1.16;
    neckWidth = 0.12;
    ridgeWeight = 0.04;
    rootCurve = 1.02;
    rootCupWidth = 0.09;
    rootCupWeight = 0.14;
    rootAnchorScale = 0.05;
    rootSocketWidth = 0.24;
    rootSocketWeight = 0.08;
    blendMode = 2;
  }

  float petalWave = pow(cosinePetal, curvePower);
  float petalShoulder = pow(cosinePetal, shoulderPower) + shoulderBias * (1.0 - petalWave) * cosinePetal;
  float petalAxis = pow(max(cosinePetal, 0.0001), axisPower);
  float petalBlend = pow(max(petalWave, 0.0001), aperturePower);
  if (blendMode == 1) {
    petalBlend = pow(sin(cosinePetal * PI * 0.5), mix(0.92, 1.24, apertureValue));
  } else if (blendMode == 2) {
    petalBlend = pow(cosinePetal, mix(0.38, 0.82, apertureValue));
  }
  float neckProfile = pow(max(petalWave, 0.0001), neckPower);
  float petalRadius = mix(innerRadius, outerRadius, petalBlend);
  petalRadius *= mix(0.96, 1.08 * tipBoost, petalShoulder);
  petalRadius -= splitTip * smoothstep(0.84, 1.0, cosinePetal);
  petalRadius -= tipNotch * smoothstep(0.9, 1.0, cosinePetal);
  float rootAnchorRadius = innerRadius * max(0.028, rootAnchorScale * baseTightness);
  petalRadius = mix(rootAnchorRadius, petalRadius, petalAxis);
  float tipThinness = smoothstep(0.82, 1.0, petalWave);
  float centerThinness = 1.0 - smoothstep(innerRadius * 0.92, innerRadius * 1.95, polar.y);
  float localWidth = width * (1.0 - 0.36 * max(tipThinness, centerThinness));
  float mainOutline = band(abs(polar.y - petalRadius), localWidth);
  float rootCupBlend = pow(max(cosinePetal, 0.0001), mix(1.18, 2.1, apertureValue));
  float rootRadius =
    mix(rootAnchorRadius * 0.8, innerRadius * rootCurve, rootCupBlend * petalAxis) +
    innerRadius * rootCupLift * cosinePetal;
  float rootCup =
    band(abs(polar.y - rootRadius), width * rootCupWidth * mix(0.58, 0.82, petalAxis)) *
    smoothstep(innerRadius * 0.98, innerRadius * 0.03, polar.y) *
    pow(max(cosinePetal, 0.0001), 1.35);
  float rootSocket =
    band(abs(polar.y - (rootAnchorRadius + innerRadius * 0.12)) + axisDistance * innerRadius * 0.16, width * rootSocketWidth) *
    smoothstep(innerRadius * 0.52, innerRadius * 0.02, polar.y) *
    pow(max(cosinePetal, 0.0001), mix(1.6, 2.8, apertureValue));
  float detailStrength = clamp(
    (complexity * 0.75 + (fractalDimension - 1.05) * 0.9 + float(recursionDepth) * 0.08) *
      detailMultiplier,
    0.0,
    1.0
  );
  float detailEnabled = step(0.001, (complexity + float(recursionDepth) * 0.18) * detailMultiplier);
  float innerPetalField = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= recursionDepth) {
      break;
    }
    float fi = float(i);
    float contourT = 0.3 + fi * 0.12;
    float contourRadius = petalRadius * mix(0.36, 0.78, contourT) * (0.98 - fi * 0.06);
    float contourWave = (1.0 - petalWave) * mix(0.008, 0.028, 1.0 - curvature);
    float contour = band(abs(polar.y - contourRadius) + contourWave, width * (0.52 - fi * 0.06));
    innerPetalField = max(innerPetalField, contour * detailStrength * (0.34 - fi * 0.05));
  }
  innerPetalField *= detailEnabled * innerContourWeight;
  float petalRidge =
    band(abs(polar.y - petalRadius * mix(0.56, 0.74, curvature)) + (1.0 - petalWave) * mix(0.012, 0.03, 1.0 - curvature), width * 0.5) *
    ornamentValue *
    detailMultiplier;
  return max(
    max(mainOutline, max(rootCup * rootCupWeight, rootSocket * rootSocketWeight)),
    max(innerPetalField, petalRidge * ridgeWeight)
  );
}

float lotusFlowerMask(
  vec2 p,
  float petals,
  float width,
  float apertureValue,
  float overlapValue
) {
  vec2 polar = vec2(atan(p.y, p.x), length(p));
  float safePetals = max(2.0, petals);
  float cosinePetal = 0.5 + 0.5 * cos(polar.x * safePetals);
  float overlapMix = clamp((overlapValue - 0.82) / 0.42, 0.0, 1.0);
  float curvePower = mix(0.8, 2.6, clamp(curvature, 0.0, 1.0));
  float aperturePower = mix(3.8, 1.1, clamp(apertureValue, 0.0, 1.0));
  float innerRadius = mix(0.025, 0.09, overlapMix);
  float outerRadius = mix(0.24, 0.46, overlapMix);
  float axisPower = mix(0.45, 1.1, apertureValue);
  float tipBoost = 1.0;
  float baseTightness = 1.0;
  float shoulderPower = mix(1.6, 4.2, clamp(curvature, 0.0, 1.0));
  float shoulderBias = 0.0;
  float rootAnchorScale = 0.12;
  int blendMode = 0;

  if (petalProfile == 1) {
    curvePower *= 1.45;
    aperturePower = mix(2.2, 0.82, apertureValue);
    innerRadius *= 1.18;
    outerRadius *= 0.82;
    axisPower = mix(0.9, 1.9, apertureValue);
    rootAnchorScale = 0.08;
    blendMode = 1;
  } else if (petalProfile == 2) {
    curvePower *= 1.35;
    aperturePower = mix(4.6, 1.2, apertureValue);
    outerRadius *= 1.12;
    tipBoost = 1.08;
    baseTightness = 0.88;
    rootAnchorScale = 0.1;
  } else if (petalProfile == 3) {
    curvePower *= 0.58;
    aperturePower = mix(1.2, 0.62, apertureValue);
    innerRadius *= 1.4;
    outerRadius *= 0.76;
    tipBoost = 0.94;
    baseTightness = 1.32;
    rootAnchorScale = 0.06;
    blendMode = 2;
  } else if (petalProfile == 4) {
    curvePower *= 1.55;
    aperturePower = mix(4.9, 1.34, apertureValue);
    outerRadius *= 1.08;
    tipBoost = 1.12;
    baseTightness = 0.82;
    shoulderBias = 0.08;
    rootAnchorScale = 0.08;
  } else if (petalProfile == 5) {
    curvePower *= 1.08;
    aperturePower = mix(3.2, 1.0, apertureValue);
    innerRadius *= 1.02;
    outerRadius *= 0.98;
    shoulderBias = 0.12;
    rootAnchorScale = 0.09;
  } else if (petalProfile == 6) {
    curvePower *= 1.12;
    aperturePower = mix(3.6, 1.02, apertureValue);
    rootAnchorScale = 0.08;
  } else if (petalProfile == 7) {
    curvePower *= 0.5;
    aperturePower = mix(0.94, 0.54, apertureValue);
    innerRadius *= 1.55;
    outerRadius *= 0.72;
    tipBoost = 0.9;
    baseTightness = 1.45;
    axisPower = mix(1.05, 2.1, apertureValue);
    rootAnchorScale = 0.05;
    blendMode = 2;
  }

  float petalWave = pow(cosinePetal, curvePower);
  float petalShoulder = pow(cosinePetal, shoulderPower) + shoulderBias * (1.0 - petalWave) * cosinePetal;
  float petalAxis = pow(max(cosinePetal, 0.0001), axisPower);
  float petalBlend = pow(max(petalWave, 0.0001), aperturePower);
  if (blendMode == 1) {
    petalBlend = pow(sin(cosinePetal * PI * 0.5), mix(0.92, 1.24, apertureValue));
  } else if (blendMode == 2) {
    petalBlend = pow(cosinePetal, mix(0.38, 0.82, apertureValue));
  }

  float petalRadius = mix(innerRadius, outerRadius, petalBlend);
  petalRadius *= mix(0.96, 1.08 * tipBoost, petalShoulder);
  float rootAnchorRadius = innerRadius * max(0.028, rootAnchorScale * baseTightness);
  float fillRadius = mix(rootAnchorRadius, petalRadius, petalAxis);
  float outerMask = 1.0 - smoothstep(fillRadius - width * 0.8, fillRadius + width * 1.3, polar.y);
  float innerMask = smoothstep(rootAnchorRadius - width * 1.4, rootAnchorRadius + width * 1.2, polar.y);
  return clamp(outerMask * innerMask, 0.0, 1.0);
}

float softCloud(vec2 p, float radius, float softness) {
  float normalized = length(p) / max(radius, 0.001);
  return exp(-pow(normalized, mix(2.6, 1.45, softness)));
}

float recipeBlend(
  int recipe,
  float basePattern,
  float targetPattern,
  float rosetteA,
  float rosetteB,
  float filigree,
  float sacredField,
  float tunnelField
) {
  if (recipe == 1) {
    return max(tunnelField, mix(basePattern, targetPattern, 0.45) + rosetteB * 0.5);
  }
  if (recipe == 2) {
    return max(sacredField, rosetteA * 0.85 + filigree * 0.35);
  }
  if (recipe == 3) {
    return max(filigree, rosetteA * 0.7 + rosetteB * 0.9 + targetPattern * 0.5);
  }
  if (recipe == 4) {
    return max(sacredField, tunnelField * 0.5 + filigree * 0.55);
  }
  return max(rosetteA, mix(basePattern, targetPattern, 0.35) + filigree * 0.4);
}

float scenePatternConfig(
  vec2 p,
  float width,
  int layerCountValue,
  float beamCountValue,
  float apertureValue,
  float overlapValue,
  float ornamentValue,
  float detailMultiplier,
  float rotationOffset
) {
  int safeLayerCount = layerCountValue < 1 ? 1 : layerCountValue;
  float normalizedLayers = clamp(float(safeLayerCount), 1.0, 6.0);
  float safeBeamCount = max(2.0, beamCountValue);
  float layeredField = 0.0;
  float frontOcclusion = 0.0;
  float layerAngleStep = TAU / (safeBeamCount * normalizedLayers);
  for (int i = 0; i < 6; i++) {
    if (i >= safeLayerCount) {
      break;
    }
    float fi = float(i);
    float layerBlend = fi / max(normalizedLayers - 1.0, 1.0);
    float layerScale = 1.0;
    float layerPetals = safeBeamCount;
    float layerWidth = width * mix(1.0, 0.92, layerBlend);
    float layerOrnament = ornamentValue * mix(1.0, 0.8, layerBlend);
    float layerAperture = apertureValue;
    float layerOverlap = overlapValue;
    float layerAngleOffset = rotationOffset + fi * layerAngleStep;
    vec2 rotatedP = p * rotate2d(layerAngleOffset);
    float layerLifecycle = 1.0;
    if (visualRecipe == 0 && renderMode == 1 && safeLayerCount > 1) {
      float layerSeed = fi * 0.73 + safeBeamCount * 0.041 + float(evolutionProfile) * 0.29;
      float layerNoise = pinkNoise(vec2(layerSeed, time * 0.018 + layerBlend * 4.3));
      float layerCycleSpeed = 0.024 + ornamentValue * 0.005 + depthStrength * 0.003;
      if (evolutionProfile == 1) {
        layerCycleSpeed *= 0.92;
      } else if (evolutionProfile == 2) {
        layerCycleSpeed *= 0.74;
      } else if (evolutionProfile == 3) {
        layerCycleSpeed *= 0.86;
      }
      float layerPhaseOffset = (fi / normalizedLayers) * mix(0.16, 0.34, depthStrength) + layerNoise * 0.08;
      float layerCycle = fract(time * layerCycleSpeed + layerPhaseOffset + rotationOffset * 0.025);
      float layerInception = 1.0 - smoothstep(0.04, 0.18, layerCycle);
      float layerBloom = smoothstep(0.1, 0.34, layerCycle) * (1.0 - smoothstep(0.56, 0.82, layerCycle));
      float layerDissolution = smoothstep(0.72, 0.96, layerCycle);
      layerLifecycle = clamp(0.3 + layerInception * 0.12 + layerBloom * 0.58 - layerDissolution * 0.12, 0.2, 1.0);
      if (evolutionProfile == 2) {
        layerLifecycle = clamp(0.62 + layerBloom * 0.26 - layerDissolution * 0.06, 0.5, 1.0);
      } else if (evolutionProfile == 1) {
        layerLifecycle = clamp(0.24 + layerInception * 0.08 + layerBloom * 0.44 - layerDissolution * 0.06, 0.2, 0.92);
      }
    }
    float layerField = lotusFlowerField(
      rotatedP * layerScale,
      layerPetals,
      layerWidth,
      layerAperture,
      layerOverlap,
      layerOrnament,
      detailMultiplier
    );
    layerField *= layerLifecycle;
    if (visualRecipe == 0 && petalOpacity > 0.001 && i > 0) {
      layerField *= 1.0 - frontOcclusion;
    }
    layeredField = max(layeredField, layerField);
    if (visualRecipe == 0 && petalOpacity > 0.001) {
      float layerMask = lotusFlowerMask(
        rotatedP * layerScale,
        layerPetals,
        layerWidth,
        layerAperture,
        layerOverlap
      );
      frontOcclusion = max(frontOcclusion, layerMask * mix(0.58, 1.0, layerLifecycle) * petalOpacity);
    }
  }
  float pattern = layeredField;
  return clamp(pattern, 0.0, 1.0);
}

${evolutionShaderBlock}

float revealField(float dist, float phase, int mode) {
  if (mode == 1) {
    return 1.0 - smoothstep(0.15 + phase * 0.05, 0.72 + phase * 0.18, dist);
  }
  if (mode == 2) {
    float pulseRadius = 0.18 + 0.16 * sin(phase * TAU);
    return 1.0 - smoothstep(pulseRadius, pulseRadius + 0.22, dist);
  }
  return 1.0 - smoothstep(0.06 + phase * 0.05, 0.36 + phase * 0.24, dist);
}

float waveformValue(float phase) {
  if (waveform == 1) {
    return step(1.0 - dutyCycle, fract(phase));
  }
  if (waveform == 2) {
    return fract(phase);
  }
  return 0.5 + 0.5 * sin(phase * TAU);
}

half4 main(vec2 fragcoord) {
  float minRes = min(resolution.x, resolution.y);
  vec2 baseUv = (fragcoord - resolution * 0.5) / minRes;
  bool isCloudBloom = motionLogic == 1;
  float zoomAmount = abs(zoomVelocity);
  float pulseSpeed = 0.18 + zoomAmount * 0.55;
  float pulseWave = sin(time * pulseSpeed);
  float organicNoise = pinkNoiseSigned(baseUv * 2.4 + vec2(time * 0.045, time * 0.028));
  float flowerScale = isCloudBloom
    ? 1.08 - depthStrength * 0.05 - zoomAmount * 0.015
    : 0.7 - zoomVelocity * 0.08 * sin(time * pulseSpeed);

  vec2 uv = baseUv * flowerScale;
  if (renderMode == 1) {
    float warpDrift = pinkNoise(vec2(time * 0.006, 15.7 + beamCount * 0.021));
    float warpStrength =
      0.01 +
      depthStrength * 0.008 +
      ornamentDensity * 0.004 +
      (warpDrift - 0.5) * 0.004;
    vec2 warpDirection = normalize(baseUv + vec2(0.0001, 0.0));
    uv += warpDirection * organicNoise * warpStrength * smoothstep(0.04, 0.7, length(baseUv));
  }
  uv *= rotate2d(time * rotationVelocity * 0.16);

  float width =
    clamp(strokeWidth * mix(0.36, 0.72, 1.0 - curvature * 0.25), 0.00035, 0.026) *
    mix(1.02, 0.68, curvature);
  float currentPattern = scenePatternConfig(
    uv,
    width,
    layerCount,
    beamCount,
    aperture,
    overlapFactor,
    ornamentDensity,
    1.0,
    0.0
  );
  float pattern = renderMode == 1
    ? evolvingPattern(uv, width, zoomAmount, 1.04)
    : currentPattern;
  float overlapMix = clamp((overlapFactor - 0.82) / 0.42, 0.0, 1.0);
  float bijaAura = softCloud(baseUv, mix(0.13, 0.2, overlapMix), 0.68);
  float bijaCore = softCloud(baseUv, mix(0.022, 0.038, overlapMix), 0.34);

  float flicker = 0.96;
  float glow = 0.7 + glowStrength * 0.6;
  float hue = fract((hueMain + hueRange * 0.08 * sin(time * 0.05)) / 360.0);
  float secondaryHue = fract(hue + 0.03 + 0.05 * ornamentDensity);
  vec3 baseColor = mix(
    hsv2rgb(vec3(hue, saturation, luminanceBase + 0.14)),
    paletteColor(palettePreset, 0.28),
    0.55
  );
  vec3 accentColor = mix(
    hsv2rgb(vec3(secondaryHue, clamp(saturation * 0.88, 0.0, 1.0), luminanceBase + 0.28)),
    paletteColor(palettePreset, 0.72),
    0.72
  );
  vec3 pearlColor = mix(vec3(1.0, 0.96, 0.98), paletteColor(palettePreset, 0.92), 0.38);
  vec3 bijaColor = mix(pearlColor, accentColor, 0.18);
  vec3 shadowColor = mix(paletteColor(palettePreset, 0.08), vec3(0.06, 0.05, 0.12), 0.55);
  float edgeFade = smoothstep(1.14, 0.08, length(baseUv));
  float luminancePulse = mix(0.55, 1.0, flicker) * glow;
  float colorMix = clamp(pattern * luminancePulse, 0.0, 1.0);
  float cloudRadius = mix(0.28, 0.44, glowStrength);
  if (isCloudBloom) {
    cloudRadius = mix(0.3, 0.42, depthStrength);
  }
  float cloudPulseAmplitude = isCloudBloom ? (0.04 + zoomAmount * 0.05) : (0.015 + glowStrength * 0.02);
  float cloudRadiusAnimated = cloudRadius * (1.0 + cloudPulseAmplitude * pulseWave);
  float cloudCore = softCloud(baseUv, cloudRadiusAnimated, 0.72 + glowStrength * 0.22);
  float centralHalo = cloudCore * (isCloudBloom ? (0.26 + glowStrength * 0.44) : (0.16 + glowStrength * 0.22));
  float backgroundHalo =
    softCloud(baseUv, cloudRadiusAnimated * 1.28, 0.88) *
    (isCloudBloom ? (0.14 + glowStrength * 0.22) : (0.05 + glowStrength * 0.08));
  float glowWidthFactor = smoothstep(0.00035, 0.01, width);
  float frontGlow =
    smoothstep(0.0, 0.08 + glowStrength * 0.22, pattern) *
    (0.08 + glowStrength * 0.32) *
    mix(0.32, 1.0, glowWidthFactor);
  vec3 backgroundColor =
    paletteColor(palettePreset, 0.12) * backgroundHalo +
    paletteColor(palettePreset, 0.9) * centralHalo * 0.36;
  vec3 mainColor = mix(baseColor * 0.45, accentColor, colorMix);
  vec3 seedColor = mix(bijaColor, vec3(1.0, 0.985, 0.99), 0.42);
  vec3 frontColor =
    accentColor * frontGlow +
    bijaColor * bijaAura * (0.08 + glowStrength * 0.06) +
    paletteColor(palettePreset, 0.78) * centralHalo * 0.18;
  vec3 color = backgroundColor;
  float alpha = 1.0;
  float extraLayerAlpha = smoothstep(1.15, 2.1, float(layerCount));

  if (layerRole == 0) {
    color = backgroundColor;
    alpha = 1.0;
  } else if (layerRole == 1) {
    color = mainColor;
    alpha = clamp(pattern * (0.5 + glowStrength * 0.4) * edgeFade, 0.0, 0.95);
  } else if (layerRole == 2) {
    color = seedColor * (0.42 + bijaAura * 0.28) + pearlColor * bijaCore * 0.34;
    alpha = clamp((bijaAura * (0.18 + glowStrength * 0.18) + bijaCore * 0.28) * edgeFade, 0.0, 0.62);
  } else {
    color = frontColor + paletteColor(palettePreset, 0.6) * centralHalo * 0.12;
    alpha = clamp(frontGlow * (0.14 + extraLayerAlpha * 0.1) * edgeFade, 0.0, 0.28);
  }

  return half4(color * edgeFade, alpha);
}
`;
}

function buildShaderEffect(shaderSource: string) {
  const effect = Skia.RuntimeEffect.Make(shaderSource);
  if (!effect) {
    throw new Error("Failed to compile MANDALA shader.");
  }
  return effect;
}

export interface MandalaCanvasProps {
  sessionState: MandalaSessionState;
  bioFrame: BioSignalFrame;
  isActive?: boolean;
  renderMode?: RenderMode;
}

function useTimeSecondsWhileActive(isActive: boolean) {
  const [timeSeconds, setTimeSeconds] = useState(0);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      lastTickRef.current = null;
      return;
    }

    lastTickRef.current = Date.now();
    const intervalId = setInterval(() => {
      const now = Date.now();
      const lastTick = lastTickRef.current ?? now;
      lastTickRef.current = now;
      setTimeSeconds((current) => current + (now - lastTick) / 1000);
    }, 1000 / 30);

    return () => clearInterval(intervalId);
  }, [isActive]);

  return timeSeconds;
}

export function MandalaCanvas({
  sessionState,
  bioFrame,
  isActive = true,
  renderMode = "evolving",
}: MandalaCanvasProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const timeSeconds = useTimeSecondsWhileActive(isActive);
  const shaderEffect = useMemo(() => {
    const evolutionShaderBlock = getEvolutionShaderBlock(sessionState.artDirection.visualRecipe);
    return buildShaderEffect(buildShaderSource(evolutionShaderBlock));
  }, [sessionState.artDirection.visualRecipe]);
  const layerUniforms = useMemo(
    () =>
      [0, 1, 2, 3].map((layerRole) =>
        buildLayerUniforms(sessionState, bioFrame, size, timeSeconds, renderMode, layerRole),
      ),
    [bioFrame, renderMode, sessionState, size, timeSeconds],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View onLayout={handleLayout} style={styles.container}>
      <Canvas style={styles.canvas}>
        {layerUniforms.map((uniforms) => (
          <Fill key={uniforms.layerRole}>
            <Shader source={shaderEffect} uniforms={uniforms} />
          </Fill>
        ))}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#060816",
  },
  canvas: {
    flex: 1,
  },
});
