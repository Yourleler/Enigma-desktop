// Original procedural night sky. Integrate light through vertical, folded
// sheets: the lower green rim, long rays and violet upper emission move as
// one volume instead of translating a blurred wallpaper.
export const auroraVertex = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

export const auroraFragment = `
precision highp float;
uniform vec2 resolution;
uniform float time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 screen = (uv - .5) * vec2(resolution.x / resolution.y, 1.0);
  // Look obliquely up into the sky; different heights project to different
  // positions in the same sheet, creating perspective and vertical rays.
  vec3 ray = normalize(vec3(screen.x * 1.55 - screen.y * .18, max(.12, screen.y * .98 + .46), 1.35));
  vec3 light = vec3(0.0);
  float drift = time * .16;
  float activity = .5 + .5 * sin(time * .071 + .4 * sin(time * .037));
  float sampleOffset = hash(gl_FragCoord.xy);
  for (int i = 0; i < 96; i++) {
    float sampleHeight = (float(i) + sampleOffset) / 96.0;
    float h = 1.0 + 2.2 * sampleHeight * sampleHeight;
    float stepWeight = 4.4 * max(sampleHeight, .005) / (96.0 * .034);
    vec2 p = ray.xz * (h / ray.y);
    // A local curl slowly tightens and releases while travelling waves pass
    // through it. It does not rotate the complete background or its stars.
    vec2 center = vec2(sin(time * .043) * 1.6, 3.2);
    vec2 relative = p - center;
    float curl = exp(-dot(relative, relative) * .6) * (.35 + .65 * activity);
    float cs = cos(curl), sn = sin(curl);
    p = center + mat2(cs, -sn, sn, cs) * relative;
    float bend = .6 * sin(p.x * .73 + drift * .42)
      + .35 * sin(p.x * 2.6 - drift * .64 + .35 * sin(p.x * 4.3))
      + .09 * sin(p.x * 8.1 + drift * .28);
    float folds = (noise(vec2(p.x * 2.8 + drift * .19, p.y * .55)) - .5) * .55;
    float sheet = p.y - 2.75 - bend - folds;
    float separation = 1.13 + .22 * sin(p.x * 1.3 - drift * .51);
    // Two sheets at different distances, with a thin lower edge that becomes
    // more diffuse high above it. Fine density variation makes light shafts.
    float width = .085 + (h - 1.0) * .038;
    float density = exp(-pow(sheet / width, 2.0))
      + (.36 + activity * .2) * exp(-pow((sheet - separation) / (width * 1.25), 2.0));
    // A single high-frequency axis produced long, evenly spaced bars near
    // the centre of the view. Let broad folds carry the light, with sparse
    // warped fibres that lose definition at different heights.
    float broad = noise(p * vec2(4.5, 1.4) + vec2(-drift * .12, drift * .06));
    float shear = (noise(vec2(p.x * 2.1 + drift * .12, p.y * .8)) - .5) * .18;
    float fibre = noise(vec2((p.x + shear) * 30.0 + drift * .1, p.y * 1.5 + h * .75));
    float definition = (1.0 - smoothstep(1.2, 2.0 + broad * .6, h)) * smoothstep(.2, .78, broad);
    float shafts = .45 + .16 * broad + mix(.2, 1.0, definition) * .36 * fibre;
    float clusters = .3 + .7 * broad;
    // Colour emissions have separate height envelopes and timing. Purple
    // leads a travelling excitation; the green afterglow follows it. High
    // red emission changes more slowly. Yellow is a local warm highlight.
    float front = .5 + .5 * sin(p.x * 1.35 - drift * 1.9 + .6 * sin(p.x * .7));
    float afterglow = .5 + .5 * sin(p.x * 1.35 - drift * 1.9 + .36 + .6 * sin(p.x * .7));
    float pulse = .65 + .35 * afterglow;
    float warm = pow(.5 + .5 * sin(p.x * .9 - time * .082 + 1.6), 5.0);
    float green = (exp(-(h - 1.12) * 2.5) + .48 * exp(-pow((h - 1.15) / .09, 2.0))) * smoothstep(1.02, 1.14, h);
    vec3 greenColor = mix(vec3(.2, 1.0, .39), vec3(.9, .96, .22), warm * exp(-(h - 1.0) * 5.0) * .8);
    float purple = exp(-pow((h - 1.055) / .05, 2.0)) * (.12 + .85 * pow(front, 3.0));
    float red = exp(-pow((h - 2.25) / .6, 2.0)) * (.18 + .26 * activity) * (.4 + .6 * noise(vec2(p.x * .7, time * .024)));
    float violet = exp(-pow((h - 1.85) / .45, 2.0)) * .22 * (.4 + .6 * front);
    vec3 emission = greenColor * green * pulse
      + vec3(.69, .12, 1.0) * purple
      + vec3(1.0, .07, .26) * red
      + vec3(.36, .19, .8) * violet;
    light += emission * density * shafts * clusters * .32 * stepWeight;
  }
  vec3 sky = mix(vec3(.015, .024, .042), vec3(.009, .018, .033), uv.y);
  // Sparse, stationary stars remain subordinate to text and glass highlights.
  vec2 cell = floor(uv * resolution / 3.0);
  float star = step(.9994, hash(cell)) * pow(max(0.0, 1.0 - length(fract(uv * resolution / 3.0) - .5) * 2.0), 4.0);
  sky += star * .09;
  vec3 color = sky + (vec3(1.0) - exp(-light * 1.8)) * .72;
  // Keep the work area readable without painting an opaque card over it.
  float vignette = 1.0 - .22 * smoothstep(.25, .95, length(screen * vec2(.65, 1.0)));
  gl_FragColor = vec4(color * vignette, 1.0);
}
`;
