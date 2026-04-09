export const EVOLUTION_SHADER_SHARED_BLOCK = String.raw`
float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

float easeInOut(float t) {
  t = clamp01(t);
  return t * t * (3.0 - 2.0 * t);
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

float pinkNoise(vec2 p) {
  float total = 0.0;
  float amplitude = 1.0;
  float norm = 0.0;
  vec2 domain = p;
  for (int i = 0; i < 5; i++) {
    total += valueNoise(domain) * amplitude;
    norm += amplitude;
    domain = domain * 2.0 + vec2(17.0, 31.0);
    amplitude *= 0.5;
  }
  return total / max(norm, 0.0001);
}

float pinkNoiseSigned(vec2 p) {
  return pinkNoise(p) * 2.0 - 1.0;
}

float growthEnvelope(float t) {
  float birth = smoothstep(0.02, 0.3, t);
  float fade = 1.0 - smoothstep(0.58, 0.96, t);
  return clamp01(birth * fade);
}
`;
