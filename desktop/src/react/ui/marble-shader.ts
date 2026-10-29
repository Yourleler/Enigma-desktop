// Original domain-warped mineral ribbons, with no repeating contour pattern.
export const marbleFunction = `
float marbleFbm(vec2 p) {
  float value = 0.0, amplitude = .5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = mat2(.8, -.6, .6, .8) * p * 2.03 + 4.7;
    amplitude *= .46;
  }
  return value;
}
vec3 marbleColor() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 p = (uv - .5) * vec2(resolution.x / resolution.y, 1.0);
  float drift = time * .065;
  vec2 warp = vec2(marbleFbm(p * 1.25 + vec2(drift * .22, 4.8)), marbleFbm(p * 1.35 + vec2(12.4, -drift * .18)));
  vec2 q = p + (warp - .45) * .64;
  q += vec2(sin(time * .045) * .075, cos(time * .037) * .035);
  float pigment = 0.0;
  for (int i = 0; i < 4; i++) {
    float seed = float(i) * 19.37 + 3.8;
    float offset = i == 0 ? -.46 : i == 1 ? -.12 : i == 2 ? .08 : .51;
    float slope = i == 0 ? -.12 : i == 1 ? .36 : i == 2 ? .28 : -.20;
    float bend = (marbleFbm(vec2(q.x * 1.65 + drift, seed)) - .45) * .43;
    float distance = q.y + q.x * slope - offset - bend;
    float width = .009 + .046 * pow(noise(vec2(q.x * 2.7 - drift * .4, seed + 3.1)), 2.0);
    float presence = smoothstep(.17, .73, marbleFbm(q * 1.8 + vec2(seed, drift * .25)));
    float core = exp(-pow(distance / width, 2.0));
    float wash = exp(-pow(distance / (width * 3.3), 2.0));
    pigment += (core * .23 + wash * .09) * presence;
    float branch = distance + .035 + .1 * noise(vec2(q.x * 3.0, seed + drift * .2));
    pigment += exp(-pow(branch / (width * .6), 2.0)) * .045 * smoothstep(.52, .78, noise(q * 3.7 + seed));
  }
  vec3 pearl = vec3(.982, .978, .991);
  vec3 mineral = vec3(.64, .51, .77);
  vec3 color = mix(pearl, mineral, min(pigment, .28));
  color += (noise(gl_FragCoord.xy * .8) - .5) * .0012;
  return color;
}
`;
