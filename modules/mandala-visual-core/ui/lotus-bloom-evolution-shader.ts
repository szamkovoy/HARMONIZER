export const LOTUS_BLOOM_EVOLUTION_SHADER_BLOCK = String.raw`
float evolvingPattern(vec2 p, float width, float zoomAmount, float baseRadius) {
  float timeNoise = pinkNoise(vec2(time * 0.035, 1.7 + beamCount * 0.03));
  float evolutionSpeed =
    0.024 +
    depthStrength * 0.01 +
    ornamentDensity * 0.007 +
    (timeNoise - 0.5) * 0.006;
  if (evolutionProfile == 2) {
    evolutionSpeed *= 0.72;
  } else if (evolutionProfile == 3) {
    evolutionSpeed *= 0.84;
  }
  float evolutionTime = time * evolutionSpeed;
  float sceneIndex = floor(evolutionTime);
  float scenePhase = fract(evolutionTime);
  float easedPhase = easeInOut(scenePhase);
  float currentNoise = pinkNoise(vec2(sceneIndex * 0.31, 2.4));
  float nextNoise = pinkNoise(vec2((sceneIndex + 1.0) * 0.31, 2.4));
  float morphNoise = pinkNoise(vec2(sceneIndex * 0.19 + easedPhase * 0.6, 6.2));
  float currentSignedNoise = currentNoise * 2.0 - 1.0;
  float nextSignedNoise = nextNoise * 2.0 - 1.0;
  float organicPhase = easeInOut(clamp01(easedPhase * 0.82 + morphNoise * 0.18));
  float growth = growthEnvelope(organicPhase);
  float currentDriftA = pinkNoiseSigned(vec2(sceneIndex * 0.27, 8.1));
  float nextDriftA = pinkNoiseSigned(vec2((sceneIndex + 1.0) * 0.27, 8.1));
  float currentDriftB = pinkNoiseSigned(vec2(sceneIndex * 0.31 + 3.7, 9.4));
  float nextDriftB = pinkNoiseSigned(vec2((sceneIndex + 1.0) * 0.31 + 3.7, 9.4));
  float currentDriftC = pinkNoiseSigned(vec2(sceneIndex * 0.23 + 7.1, 10.6));
  float nextDriftC = pinkNoiseSigned(vec2((sceneIndex + 1.0) * 0.23 + 7.1, 10.6));
  float currentDriftD = pinkNoiseSigned(vec2(sceneIndex * 0.19 + 11.3, 12.2));
  float nextDriftD = pinkNoiseSigned(vec2((sceneIndex + 1.0) * 0.19 + 11.3, 12.2));
  float livingWave = mix(currentDriftA, nextDriftA, organicPhase);

  float currentPetals = max(2.0, beamCount);
  float nextPetals = max(2.0, beamCount);

  int currentLayers = layerCount < 1 ? 1 : layerCount;
  int nextLayers = layerCount < 1 ? 1 : layerCount;

  float currentAperture = clamp(aperture + currentSignedNoise * 0.07, 0.1, 1.0);
  float nextAperture = clamp(aperture + nextSignedNoise * 0.07, 0.1, 1.0);
  float currentOverlap = clamp(overlapFactor + currentSignedNoise * 0.04, 0.7, 1.4);
  float nextOverlap = clamp(overlapFactor + nextSignedNoise * 0.04, 0.7, 1.4);
  float currentOrnament = clamp(ornamentDensity * (0.9 + currentSignedNoise * 0.1), 0.0, 1.0);
  float nextOrnament = clamp(ornamentDensity * (0.9 + nextSignedNoise * 0.1), 0.0, 1.0);
  float currentDetail = 0.94 + currentSignedNoise * 0.08;
  float nextDetail = 0.94 + nextSignedNoise * 0.08;
  float currentRotation = currentSignedNoise * TAU * 0.014 + currentDriftA * TAU * 0.006;
  float nextRotation = nextSignedNoise * TAU * 0.014 + nextDriftA * TAU * 0.007;
  float currentScale = 1.0 + currentSignedNoise * 0.018 + currentDriftC * 0.012;
  float nextScale = 1.0 + nextSignedNoise * 0.018 + nextDriftC * 0.014;
  float layerDrift = 0.0;

  if (evolutionProfile == 1) {
    currentRotation += currentSignedNoise * TAU * 0.02;
    nextRotation += nextSignedNoise * TAU * 0.026;
    currentScale += currentDriftB * 0.01;
    nextScale += nextDriftB * 0.016;
  } else if (evolutionProfile == 2) {
    currentRotation *= 0.42;
    nextRotation *= 0.42;
    currentScale += currentDriftC * 0.028;
    nextScale += nextDriftC * 0.032;
    currentOrnament *= 0.88;
    nextOrnament *= 0.88;
  } else if (evolutionProfile == 3) {
    layerDrift = smoothstep(0.12, 0.88, organicPhase);
    currentScale += currentDriftD * 0.006;
    nextScale += nextDriftD * 0.01;
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
    width * 0.96,
    int(clamp(float(nextLayers) + layerDrift, 1.0, 6.0)),
    nextPetals,
    nextAperture,
    nextOverlap,
    nextOrnament,
    nextDetail,
    nextRotation
  );

  float birthScaleStart = 2.7 - zoomAmount * 0.22;
  if (evolutionProfile == 1) {
    birthScaleStart = 3.0 - zoomAmount * 0.18;
  } else if (evolutionProfile == 2) {
    birthScaleStart = 2.1 - zoomAmount * 0.12;
  } else if (evolutionProfile == 3) {
    birthScaleStart = 2.45 - zoomAmount * 0.16;
  }
  float nextBirthScale = mix(birthScaleStart, nextScale, organicPhase);
  float bornScene = scenePatternConfig(
    p * nextBirthScale,
    width * mix(0.68, 0.98, organicPhase),
    int(clamp(float(nextLayers) + layerDrift, 1.0, 6.0)),
    nextPetals,
    nextAperture,
    nextOverlap,
    nextOrnament,
    nextDetail,
    nextRotation
  );

  float birthRadius = mix(0.045, baseRadius * (0.86 + depthStrength * 0.2), organicPhase);
  float emergenceMask = 1.0 - smoothstep(birthRadius, birthRadius + 0.1, length(p));
  float morphBlend = smoothstep(0.14, 0.84, organicPhase);
  float revealBlend = smoothstep(0.08, 0.72, organicPhase);
  float livingBlend = 0.08 + 0.08 * (0.5 + 0.5 * livingWave);
  float anchorField = mix(currentScene, nextScene, clamp(morphBlend * 0.86 + livingBlend, 0.0, 1.0));
  float bornField = max(nextScene * 0.3, bornScene) * emergenceMask * growth;

  if (evolutionProfile == 1) {
    revealBlend = smoothstep(0.02, 0.54, organicPhase);
    anchorField = mix(currentScene, nextScene, clamp(morphBlend * 0.94 + livingBlend * 0.9, 0.0, 1.0));
  } else if (evolutionProfile == 2) {
    float tidalWave = 0.5 + 0.5 * sin(time * 0.11 + sceneIndex * 0.33);
    revealBlend = smoothstep(0.22, 0.9, organicPhase);
    anchorField = mix(
      currentScene * (0.88 + tidalWave * 0.16),
      nextScene * (0.82 + (1.0 - tidalWave) * 0.14),
      clamp(morphBlend * 0.42 + livingBlend * 0.22, 0.0, 1.0)
    );
    bornField *= 0.32;
  } else if (evolutionProfile == 3) {
    float haloRadius = mix(baseRadius * 0.08, baseRadius * 0.98, organicPhase);
    float haloRing = band(abs(length(p) - haloRadius), width * 1.2);
    bornField = max(bornField, nextScene * haloRing * 0.92);
    revealBlend = smoothstep(0.18, 0.94, organicPhase);
    anchorField = mix(currentScene, nextScene, clamp(morphBlend * 0.56 + livingBlend * 0.2, 0.0, 1.0));
  }

  return max(anchorField, bornField * revealBlend);
}
`;
