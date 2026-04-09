export const DEFAULT_EVOLUTION_SHADER_BLOCK = String.raw`
float evolvingPattern(vec2 p, float width, float zoomAmount, float baseRadius) {
  float phase = easeInOut(fract(time * (0.026 + depthStrength * 0.01 + ornamentDensity * 0.008)));
  float scale = mix(1.22 - zoomAmount * 0.08, 1.0, phase);
  float birthRadius = mix(0.05, baseRadius * (0.88 + depthStrength * 0.2), phase);
  float reveal = 1.0 - smoothstep(birthRadius, birthRadius + 0.12, length(p));
  float currentScene = scenePatternConfig(
    p,
    width,
    layerCount,
    beamCount,
    aperture,
    overlapFactor,
    ornamentDensity,
    1.0,
    0.0
  );
  float nextScene = scenePatternConfig(
    p * scale,
    width * mix(0.72, 0.98, phase),
    layerCount,
    beamCount,
    aperture,
    overlapFactor,
    ornamentDensity,
    1.0,
    0.0
  );

  return max(currentScene * (1.0 - smoothstep(0.18, 0.92, phase)), nextScene * reveal * smoothstep(0.06, 0.84, phase));
}
`;
