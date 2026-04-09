export const LOTUS_BLOOM_EVOLUTION_SHADER_BLOCK = String.raw`
float sminPoly(float a, float b, float k) {
  float safeK = max(k, 0.0001);
  float h = clamp(0.5 + 0.5 * (b - a) / safeK, 0.0, 1.0);
  return mix(b, a, h) - safeK * h * (1.0 - h);
}

float softUnionField(float a, float b, float k) {
  return clamp01(1.0 - sminPoly(1.0 - clamp01(a), 1.0 - clamp01(b), k));
}

float phaseWindow(float t, float start, float fadeInEnd, float fadeOutStart, float end) {
  return smoothstep(start, fadeInEnd, t) * (1.0 - smoothstep(fadeOutStart, end, t));
}

float evolvingPattern(vec2 p, float width, float zoomAmount, float baseRadius) {
  float spectrumDriftA = pinkNoise(vec2(time * 0.006, 1.3 + beamCount * 0.017));
  float spectrumDriftB = pinkNoise(vec2(time * 0.0045, 4.9 + float(layerCount) * 0.13));
  float spectrumDriftC = pinkNoise(vec2(time * 0.0035, 8.7 + ornamentDensity * 2.1));
  float evolutionSpeed =
    0.022 +
    depthStrength * 0.008 +
    ornamentDensity * 0.005 +
    (spectrumDriftA - 0.5) * 0.004;
  if (evolutionProfile == 1) {
    evolutionSpeed *= 0.86;
  } else if (evolutionProfile == 2) {
    evolutionSpeed *= 0.68;
  } else if (evolutionProfile == 3) {
    evolutionSpeed *= 0.8;
  }

  float evolutionTime = time * evolutionSpeed;
  float sceneIndex = floor(evolutionTime);
  float scenePhase = fract(evolutionTime);
  float easedPhase = easeInOut(scenePhase);
  float morphNoise = pinkNoise(vec2(sceneIndex * mix(0.16, 0.28, spectrumDriftB) + easedPhase * 0.62, 6.2 + spectrumDriftC * 2.4));
  float organicPhase = easeInOut(clamp01(easedPhase * 0.78 + morphNoise * 0.22));
  float inception = phaseWindow(organicPhase, 0.0, 0.12, 0.18, 0.34);
  float bloom = phaseWindow(organicPhase, 0.1, 0.3, 0.48, 0.76);
  float transition = phaseWindow(organicPhase, 0.28, 0.5, 0.72, 0.9);
  float dissolution = smoothstep(0.72, 0.98, organicPhase);
  float growth = growthEnvelope(organicPhase);

  float currentNoise = pinkNoise(vec2(sceneIndex * mix(0.24, 0.36, spectrumDriftA), 2.4 + spectrumDriftB * 1.7));
  float nextNoise = pinkNoise(vec2((sceneIndex + 1.0) * mix(0.24, 0.36, spectrumDriftA), 2.9 + spectrumDriftC * 1.8));
  float currentSignedNoise = currentNoise * 2.0 - 1.0;
  float nextSignedNoise = nextNoise * 2.0 - 1.0;
  float currentDriftA = pinkNoiseSigned(vec2(sceneIndex * 0.27, 8.1 + spectrumDriftA * 2.0));
  float nextDriftA = pinkNoiseSigned(vec2((sceneIndex + 1.0) * 0.27, 8.1 + spectrumDriftB * 2.0));
  float currentDriftB = pinkNoiseSigned(vec2(sceneIndex * 0.31 + 3.7, 9.4 + spectrumDriftB * 1.8));
  float nextDriftB = pinkNoiseSigned(vec2((sceneIndex + 1.0) * 0.31 + 3.7, 9.4 + spectrumDriftC * 1.8));
  float currentDriftC = pinkNoiseSigned(vec2(sceneIndex * 0.23 + 7.1, 10.6 + spectrumDriftA * 1.6));
  float nextDriftC = pinkNoiseSigned(vec2((sceneIndex + 1.0) * 0.23 + 7.1, 10.6 + spectrumDriftB * 1.6));
  float currentDriftD = pinkNoiseSigned(vec2(sceneIndex * 0.19 + 11.3, 12.2 + spectrumDriftC * 1.5));
  float nextDriftD = pinkNoiseSigned(vec2((sceneIndex + 1.0) * 0.19 + 11.3, 12.2 + spectrumDriftA * 1.5));
  float livingWave = mix(currentDriftA, nextDriftA, organicPhase);

  float currentPetals = max(2.0, beamCount);
  float nextPetals = max(2.0, beamCount);
  int currentLayers = layerCount < 1 ? 1 : layerCount;
  int nextLayers = layerCount < 1 ? 1 : layerCount;

  float currentAperture = clamp(aperture + currentSignedNoise * 0.04 + currentDriftC * 0.018, 0.1, 1.0);
  float nextAperture = clamp(aperture + nextSignedNoise * 0.04 + nextDriftC * 0.018, 0.1, 1.0);
  float currentOverlap = clamp(overlapFactor + currentSignedNoise * 0.025 + currentDriftD * 0.012, 0.7, 1.4);
  float nextOverlap = clamp(overlapFactor + nextSignedNoise * 0.025 + nextDriftD * 0.012, 0.7, 1.4);
  float currentOrnament = clamp(ornamentDensity * mix(0.86, 1.06, currentNoise), 0.0, 1.0);
  float nextOrnament = clamp(ornamentDensity * mix(0.86, 1.08, nextNoise), 0.0, 1.0);
  float currentDetail = 0.92 + currentSignedNoise * 0.06 + currentDriftB * 0.04;
  float nextDetail = 0.92 + nextSignedNoise * 0.06 + nextDriftB * 0.04;
  float currentRotation = currentSignedNoise * TAU * 0.008 + currentDriftA * TAU * 0.004;
  float nextRotation = nextSignedNoise * TAU * 0.01 + nextDriftA * TAU * 0.005;
  float currentScale = 1.0 + currentSignedNoise * 0.01 + currentDriftC * 0.008;
  float nextScale = 1.0 + nextSignedNoise * 0.012 + nextDriftC * 0.01;

  if (evolutionProfile == 1) {
    currentRotation += currentDriftB * TAU * 0.024;
    nextRotation += nextDriftB * TAU * 0.03;
    currentScale *= mix(1.02, 0.985, organicPhase);
    nextScale *= mix(1.08, 0.96, organicPhase);
    currentOrnament *= 0.94;
    nextOrnament *= 0.96;
  } else if (evolutionProfile == 2) {
    float tidalBreath = 0.5 + 0.5 * sin(time * 0.11 + sceneIndex * 0.27);
    currentRotation *= 0.34;
    nextRotation *= 0.34;
    currentScale += currentDriftC * 0.016 + (tidalBreath - 0.5) * 0.022;
    nextScale += nextDriftC * 0.02 + ((1.0 - tidalBreath) - 0.5) * 0.024;
    currentOrnament *= 0.88;
    nextOrnament *= 0.88;
  } else if (evolutionProfile == 3) {
    currentScale += currentDriftD * 0.008;
    nextScale += nextDriftD * 0.012;
    currentOrnament *= 1.02;
    nextOrnament *= 1.08;
  }

  float currentScene = scenePatternConfig(
    p * currentScale,
    width,
    currentLayers,
    currentPetals,
    currentAperture,
    currentOverlap,
    currentOrnament,
    currentDetail,
    currentRotation
  );
  float nextScene = scenePatternConfig(
    p * nextScale,
    width * 0.97,
    nextLayers,
    nextPetals,
    nextAperture,
    nextOverlap,
    nextOrnament,
    nextDetail,
    nextRotation
  );

  float birthScaleStart = 2.5 - zoomAmount * 0.18;
  if (evolutionProfile == 1) {
    birthScaleStart = 2.1 - zoomAmount * 0.14;
  } else if (evolutionProfile == 2) {
    birthScaleStart = 1.56 - zoomAmount * 0.08;
  } else if (evolutionProfile == 3) {
    birthScaleStart = 2.3 - zoomAmount * 0.14;
  }
  float nextBirthScale = mix(birthScaleStart, nextScale, organicPhase);
  float bornScene = scenePatternConfig(
    p * nextBirthScale,
    width * mix(0.74, 0.99, organicPhase),
    nextLayers,
    nextPetals,
    nextAperture,
    nextOverlap,
    nextOrnament,
    nextDetail,
    nextRotation
  );

  float radius = length(p);
  float birthRadius = mix(0.042, baseRadius * (0.84 + depthStrength * 0.16), organicPhase);
  float emergenceMask = 1.0 - smoothstep(birthRadius, birthRadius + 0.1, radius);
  float transitionBlend = clamp(0.16 + transition * 0.54 + bloom * 0.12 + (0.5 + 0.5 * livingWave) * 0.08, 0.0, 1.0);
  float viscosity = mix(0.065, 0.14, 0.55 * spectrumDriftC + 0.45 * depthStrength);
  float anchorField = softUnionField(
    currentScene * (0.78 + bloom * 0.08 - dissolution * 0.08),
    nextScene * (0.28 + transitionBlend * 0.52),
    viscosity
  );
  float bornField = bornScene * emergenceMask * (0.26 + growth * 0.74);
  float finalField = softUnionField(anchorField, bornField, viscosity * 0.88);

  if (evolutionProfile == 0) {
    float centerDissolveRadius = mix(baseRadius * 0.08, baseRadius * 0.4, dissolution);
    float centerDissolve = smoothstep(centerDissolveRadius, centerDissolveRadius + 0.11, radius);
    anchorField = softUnionField(
      currentScene * centerDissolve * (0.72 + transition * 0.16),
      nextScene * (0.3 + bloom * 0.4 + transition * 0.1),
      viscosity
    );
    bornField = bornScene * emergenceMask * (0.42 + inception * 0.3 + bloom * 0.18);
    finalField = softUnionField(anchorField, bornField, viscosity);
  } else if (evolutionProfile == 1) {
    float inwardVeil = 1.0 - smoothstep(baseRadius * 0.14, baseRadius * 0.9, radius);
    anchorField = softUnionField(
      currentScene * (0.84 + inwardVeil * 0.08),
      nextScene * (0.3 + transition * 0.3 + inwardVeil * 0.14),
      viscosity * 0.74
    );
    bornField *= 0.18;
    finalField = softUnionField(anchorField, bornField, viscosity * 0.68);
  } else if (evolutionProfile == 2) {
    float tidalWave = 0.5 + 0.5 * sin(time * 0.11 + sceneIndex * 0.33);
    float outerMask = smoothstep(baseRadius * 0.18, baseRadius * 1.04, radius);
    float currentBreath = currentScene * (0.82 + outerMask * tidalWave * 0.16);
    float nextBreath = nextScene * (0.78 + outerMask * (1.0 - tidalWave) * 0.18);
    anchorField = softUnionField(
      currentBreath * (0.74 + bloom * 0.12),
      nextBreath * (0.28 + transition * 0.24),
      viscosity * 0.82
    );
    bornField *= 0.18;
    finalField = softUnionField(anchorField, bornField, viscosity * 0.72);
  } else if (evolutionProfile == 3) {
    float haloRadiusA = mix(baseRadius * 0.1, baseRadius * 0.44, organicPhase);
    float haloRadiusB = mix(baseRadius * 0.54, baseRadius * 1.02, organicPhase);
    float haloRing = max(
      band(abs(radius - haloRadiusA), width * 1.15),
      band(abs(radius - haloRadiusB), width * 1.05)
    );
    float cascadeField = nextScene * haloRing * (0.36 + bloom * 0.64);
    anchorField = softUnionField(
      currentScene * (0.74 + transition * 0.08),
      nextScene * (0.24 + transition * 0.28),
      viscosity * 0.84
    );
    finalField = softUnionField(anchorField, cascadeField, viscosity * 0.82);
    finalField = softUnionField(finalField, bornField * 0.54, viscosity * 0.72);
  }

  return clamp01(finalField);
}
`;
