/**
 * GLSL ES 3.00 shaders.
 *
 * Everything in the playfield is drawn by ONE instanced program: each instance is a
 * rotated quad whose fragment shader evaluates an analytic SDF for its shape. Output is
 * premultiplied: rgb = solid*alpha + emissive, a = solid alpha. With blendFunc(ONE,
 * ONE_MINUS_SRC_ALPHA) this lets a single draw call mix opaque-ish dark bodies with
 * purely additive glows — and still be pixel-sharp at the native device pixel ratio.
 */

export const SH = {
  GLOW: 0,
  DISC: 1,
  HALF: 2,
  RING: 3,
  TRI: 4,
  SEG: 5,
  GLYPH: 6,
  STAR: 7,
  BUBBLE: 8,
  ARC: 9,
  WAVE: 10,
  SPARK: 11,
  BEAM: 12,
} as const;

export const SPRITE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_xf;
layout(location=2) in vec2 a_size;
layout(location=3) in vec4 a_ca;
layout(location=4) in vec4 a_cb;
layout(location=5) in vec4 a_p;
uniform vec4 u_view;
out vec2 v_local;
out vec2 v_size;
flat out int v_shape;
out vec4 v_ca;
out vec4 v_cb;
out vec4 v_p;
void main() {
  vec2 l = a_corner * a_size;
  float c = cos(a_xf.z), s = sin(a_xf.z);
  vec2 w = vec2(l.x * c - l.y * s, l.x * s + l.y * c) + a_xf.xy;
  gl_Position = vec4((w + u_view.zw) * u_view.xy, 0.0, 1.0);
  v_local = l;
  v_size = a_size;
  v_shape = int(a_xf.w + 0.5);
  v_ca = a_ca;
  v_cb = a_cb;
  v_p = a_p;
}`;

export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_size;
flat in int v_shape;
in vec4 v_ca;
in vec4 v_cb;
in vec4 v_p;
uniform float u_px;       // world units per device pixel (anti-aliasing width)
uniform float u_time;
uniform vec3 u_darkRim;   // glowing outline of dark sides (theme dependent)
uniform float u_hc;       // high contrast 0..1
uniform float u_encode;   // HDR encode scale (1 with float targets, 0.5 with RGBA8)
uniform sampler2D u_atlas;
out vec4 o;

float aa(float d) { return clamp(0.5 - d / (u_px * 1.25), 0.0, 1.0); }

vec4 outp(vec3 solid, float a, vec3 emis) {
  return vec4((solid * a + emis) * u_encode, a);
}

// sphere-ish shading helper: returns normal-z like term for point p inside radius r
float sphereZ(vec2 p, float r) { float q = 1.0 - dot(p, p) / (r * r); return sqrt(max(q, 0.0)); }

vec4 shGlow() {
  float r = length(v_local) / v_size.x;
  float f = exp(-r * r * 4.5) * (1.0 - smoothstep(0.75, 1.0, r));
  return outp(vec3(0.0), 0.0, v_ca.rgb * v_ca.a * f);
}

vec4 shDisc() {
  float R = v_p.x;
  float d = length(v_local) - R;
  float a = aa(d) * v_ca.a;
  float g = exp(-max(d, 0.0) / max(v_p.y, 1.0)) * (1.0 - smoothstep(0.85, 1.0, length(v_local) / v_size.x));
  vec3 emis = v_cb.rgb * v_cb.a * g * (1.0 - a);
  // hot core
  float core = 1.0 - smoothstep(0.0, R, length(v_local));
  return outp(v_ca.rgb * (1.0 + v_p.z * core), a, emis);
}

vec4 shHalf() {
  float R = v_p.x;
  float flash = v_p.y;
  float fade = v_p.z;
  vec2 p = v_local;
  float L = length(p);
  float d = L - R;
  float a = aa(d);
  float light = smoothstep(-u_px, u_px, p.x);
  float z = sphereZ(p, R);
  // light half: glossy porcelain
  vec3 lc = v_ca.rgb;
  float lam = 0.62 + 0.38 * clamp(dot(normalize(vec3(p / R, z)), normalize(vec3(-0.45, -0.55, 0.7))), 0.0, 1.0);
  vec2 hp = p / R - vec2(0.08, -0.38);
  float spec = exp(-dot(hp, hp) * 22.0) * 0.85;
  vec3 lightCol = lc * lam + vec3(spec) * 1.4;
  // dark half: deep glass with fresnel rim
  float fres = pow(1.0 - z, 2.2);
  vec3 darkCol = v_cb.rgb * (0.55 + 0.45 * z) + u_darkRim * fres * (0.9 + 0.8 * u_hc);
  vec3 col = mix(darkCol, lightCol, light);
  // seam
  float seam = exp(-abs(p.x) / (u_px * 1.5 + R * 0.015)) * (1.0 - smoothstep(R - 2.0 * u_px, R, L));
  col += lc * seam * 0.35;
  col = mix(col, vec3(1.6), flash * 0.75);
  // halos: light side soft glow, dark side thin danger outline
  float outside = max(d, 0.0);
  float halo = (1.0 - smoothstep(0.85, 1.0, L / v_size.x));
  vec3 emis = lc * light * exp(-outside / (R * 0.22 + 4.0)) * 0.42 * halo;
  emis += u_darkRim * (1.0 - light) * exp(-outside / (R * 0.06 + 2.0)) * (0.85 + 0.9 * u_hc) * halo;
  emis *= (1.0 - a);
  return outp(col, a * fade, emis * fade);
}

vec4 shRing() {
  float R = v_p.x, T = v_p.y * 0.5;
  float L = length(v_local);
  float d = abs(L - R) - T;
  float a = aa(d) * v_p.w;
  float halo = 1.0 - smoothstep(0.85, 1.0, L / v_size.x);
  vec3 emis = v_ca.rgb * exp(-max(d, 0.0) / (T * 1.4 + 2.0)) * 0.35 * halo * (1.0 - a);
  // inner fill (mines): dark core with pulsing red heart
  float inner = aa(L - (R - T)) * v_cb.a;
  float pulse = v_p.z;
  vec3 innerCol = v_cb.rgb * (0.4 + 0.6 * (1.0 - L / R)) + vec3(1.6, 0.12, 0.08) * pulse * exp(-L / (R * 0.35)) * v_cb.a;
  vec3 col = mix(innerCol, v_ca.rgb, a > 0.001 ? clamp(a / max(v_p.w, 0.001), 0.0, 1.0) : 0.0);
  float alpha = max(a, inner * v_p.w);
  return outp(col, alpha, emis * v_p.w);
}

// equilateral triangle sdf, centroid at origin, apex on +y, circumradius c (matches collision.ts)
float sdTri(vec2 p, float c) {
  const float k = 1.7320508;
  float r = c * 0.8660254;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

vec4 shTri() {
  float r = v_p.x;
  vec2 p = v_local;
  float d = sdTri(p, r);
  float a = aa(d);
  float fade = v_p.z;
  vec3 col;
  vec3 emis;
  float outside = max(d, 0.0);
  float halo = 1.0 - smoothstep(0.8, 1.0, length(p) / v_size.x);
  if (v_p.w > 0.5) {
    col = v_ca.rgb;
    emis = v_cb.rgb * v_cb.a * exp(-outside / (r * 0.25 + 2.0)) * halo;
  } else {
    float light = smoothstep(-u_px, u_px, p.x);
    float shade = 0.75 + 0.25 * clamp(-p.y / r + 0.5, 0.0, 1.0);
    float edge = exp(d / (r * 0.12 + u_px));
    vec3 darkCol = v_cb.rgb + u_darkRim * edge * (0.9 + 0.8 * u_hc);
    vec3 lightCol = v_ca.rgb * shade + vec3(0.5) * edge;
    col = mix(darkCol, lightCol, light);
    col = mix(col, vec3(1.6), v_p.y * 0.75);
    emis = (v_ca.rgb * light * 0.4 + u_darkRim * (1.0 - light) * 0.8) * exp(-outside / (r * 0.16 + 2.0)) * halo;
  }
  emis *= (1.0 - a);
  return outp(col, a * fade * v_ca.a, emis * fade);
}

vec4 shSeg() {
  float hl = v_p.x, r = v_p.y;
  vec2 p = v_local;
  vec2 q = vec2(max(abs(p.x) - hl, 0.0), p.y);
  float d = length(q) - r;
  float dash = 1.0;
  if (v_p.w > 0.0) {
    float t = fract((p.x - u_time * v_p.w * 1.5) / v_p.w);
    dash = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.5, 0.58, t));
  }
  float a = aa(d) * v_ca.a * dash;
  float halo = 1.0 - smoothstep(0.8, 1.0, length(vec2(max(abs(p.x) - hl, 0.0), p.y)) / max(v_size.y, 0.001));
  vec3 emis = v_cb.rgb * v_cb.a * exp(-max(d, 0.0) / max(v_p.z, 0.5)) * dash * halo;
  return outp(v_ca.rgb, a, emis * (1.0 - a));
}

vec4 shGlyph() {
  vec2 uv = mix(v_p.xy, v_p.zw, v_local / v_size * 0.5 + 0.5);
  vec4 t = texture(u_atlas, uv);
  float a = t.r * v_ca.a;
  // soft dark backing (from the blurred channel) keeps text readable over bright effects
  float shadow = t.g * 0.55 * v_ca.a;
  vec3 emis = v_cb.rgb * v_cb.a * t.g * (1.0 - a) * 0.7;
  return vec4((v_ca.rgb * a + emis) * u_encode, a + shadow * (1.0 - a));
}

vec4 shStar() {
  float R = v_p.x, L = v_p.y, n = abs(v_p.z), heat = v_p.w;
  bool crystal = v_p.z < 0.0;
  vec2 p = v_local;
  float len = length(p);
  float ang = atan(p.y, p.x);
  float tri = 1.0 - abs(fract(ang * n / 6.2831853) * 2.0 - 1.0);
  float edge = R + L * pow(tri, crystal ? 1.6 : 2.6);
  float d = (len - edge) * 0.8;
  float a = aa(d);
  vec3 col;
  if (crystal) {
    float facet = fract(ang * n / 6.2831853 + 0.5);
    float sh = 0.55 + 0.45 * abs(facet * 2.0 - 1.0);
    col = v_cb.rgb * sh + v_ca.rgb * exp(d / (R * 0.12)) * 0.8;
  } else {
    float inner = len / edge;
    vec3 hot = vec3(1.9, 0.18, 0.06) * heat;
    col = v_cb.rgb * (0.35 + 0.65 * inner) + (v_ca.rgb * 0.55 + hot) * pow(inner, 6.0) + hot * 0.35 * (1.0 - inner);
  }
  float halo = 1.0 - smoothstep(0.8, 1.0, len / v_size.x);
  vec3 glowC = crystal ? v_ca.rgb : mix(v_ca.rgb, vec3(2.2, 0.25, 0.1), heat);
  vec3 emis = glowC * exp(-max(d, 0.0) / (R * 0.32)) * 0.55 * halo * (1.0 - a);
  return outp(col, a * v_ca.a, emis * v_ca.a);
}

vec4 shBubble() {
  float R = v_p.x;
  float L = length(v_local);
  float d = L - R;
  float a = aa(d);
  float z = sphereZ(v_local, R);
  float fres = pow(1.0 - z, 3.0);
  vec2 hp = v_local / R - vec2(-0.35, -0.42);
  float spec = exp(-dot(hp, hp) * 14.0);
  vec3 col = v_cb.rgb * (0.6 + 0.4 * z) + v_ca.rgb * fres * 1.3 + vec3(spec) * 0.8;
  float halo = 1.0 - smoothstep(0.8, 1.0, L / v_size.x);
  vec3 emis = v_ca.rgb * exp(-max(d, 0.0) / (R * 0.18)) * 0.6 * halo * (1.0 - a);
  return outp(col, a * v_ca.a, emis * v_ca.a);
}

vec4 shArc() {
  float R = v_p.x, T = v_p.y * 0.5, f = v_p.z;
  vec2 p = v_local;
  float L = length(p);
  float ang = atan(p.y, p.x); // rotated by instance rot (start angle)
  float t = ang < 0.0 ? ang + 6.2831853 : ang;
  t /= 6.2831853;
  float d = abs(L - R) - T;
  float band = aa(d);
  float on = smoothstep(f + 0.002, f - 0.002, t) * step(0.0005, f);
  vec3 emis = v_ca.rgb * on * band + v_ca.rgb * on * exp(-max(d, 0.0) / (T * 2.0)) * 0.6 * (1.0 - band);
  float trackA = band * v_cb.a * (1.0 - on);
  return outp(v_cb.rgb, trackA, emis * v_ca.a);
}

vec4 shWave() {
  float R = v_p.x, B = v_p.y;
  float L = length(v_local);
  float x = (L - R) / B;
  float f = exp(-x * x * 3.0);
  float inner = L < R ? mix(1.0, smoothstep(0.0, 1.0, L / R), v_p.z) : 1.0;
  return outp(vec3(0.0), 0.0, v_ca.rgb * v_ca.a * f * inner);
}

vec4 shSpark() {
  float R = v_p.x;
  vec2 p = v_local;
  float L = length(p);
  float shapeR = R;
  float d;
  if (v_p.y > 1.5) {          // diamond
    d = (abs(p.x) + abs(p.y)) * 0.7071 - R * 0.86;
  } else if (v_p.y > 0.5) {   // 4-point star
    vec2 q = abs(p) / R;
    d = (pow(pow(q.x, 0.55) + pow(q.y, 0.55), 1.0 / 0.55) - 1.25) * R * 0.45;
  } else {
    d = L - shapeR;
  }
  float a = aa(d);
  float core = 1.0 - smoothstep(0.0, R, L);
  vec3 col = mix(v_ca.rgb, vec3(3.2), 0.35 + 0.65 * core);
  float halo = 1.0 - smoothstep(0.7, 1.0, L / v_size.x);
  vec3 emis = v_ca.rgb * (exp(-max(d, 0.0) / (R * 0.4)) * 0.7 + exp(-max(d, 0.0) / (R * 1.4)) * 0.16) * halo * (1.0 - a);
  float k = v_p.z;
  return outp(col, a * k, emis * k);
}

vec4 shBeam() {
  vec2 p = v_local / v_size;
  float f = exp(-p.x * p.x * 9.0) * (1.0 - p.y * p.y);
  return outp(vec3(0.0), 0.0, v_ca.rgb * v_ca.a * f);
}

void main() {
  vec4 c;
  if (v_shape == 0) c = shGlow();
  else if (v_shape == 1) c = shDisc();
  else if (v_shape == 2) c = shHalf();
  else if (v_shape == 3) c = shRing();
  else if (v_shape == 4) c = shTri();
  else if (v_shape == 5) c = shSeg();
  else if (v_shape == 6) c = shGlyph();
  else if (v_shape == 7) c = shStar();
  else if (v_shape == 8) c = shBubble();
  else if (v_shape == 9) c = shArc();
  else if (v_shape == 10) c = shWave();
  else if (v_shape == 11) c = shSpark();
  else c = shBeam();
  o = c;
}`;

export const FS_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Living nebula / aurora background with optional Prism chevrons. */
export const BG_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_res;          // pixels
uniform float u_time;
uniform vec3 u_c0;           // deep
uniform vec3 u_c1;           // nebula A
uniform vec3 u_c2;           // nebula B
uniform vec3 u_c3;           // accent
uniform float u_prism;       // 0..1
uniform vec2 u_par;          // parallax offset (world units/1000)
uniform float u_beat;        // 0..1 pulse
uniform float u_hc;
uniform float u_encode;
uniform float u_aspect;      // width / short side
uniform float u_aspectY;
out vec4 o;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  // coordinates in "short side" units, centered
  vec2 p = (v_uv - 0.5) * vec2(u_aspect, u_aspectY);
  float t = u_time * 0.035;
  vec2 q = p * 1.35 + u_par * 0.35;
  vec2 w = vec2(fbm(q + vec2(t, -t * 0.7)), fbm(q + vec2(-t * 0.6, t) + 5.2));
  float n = fbm(q + w * 1.7 + vec2(t * 0.4, 0.0));
  float n2 = fbm(q * 0.6 - w + vec2(0.0, t * 0.5) + 11.0);
  // aurora curtains
  float curtain = pow(smoothstep(0.35, 0.95, n), 1.6);
  float veil = smoothstep(0.3, 0.85, n2);
  vec3 col = u_c0;
  col = mix(col, u_c1, curtain * 0.85);
  col = mix(col, u_c2, veil * 0.55 * (1.0 - curtain * 0.5));
  col += u_c3 * pow(curtain * veil, 2.0) * 0.55;
  // soft central glow behind the core, breathing with music
  float r = length(p);
  col += u_c3 * exp(-r * r * 5.0) * (0.07 + 0.05 * u_beat);
  // prism: animated chevrons
  if (u_prism > 0.001) {
    float y = p.y * 9.0 + abs(p.x) * 9.0 - u_time * 6.0;
    float chev = smoothstep(0.42, 0.5, abs(fract(y) - 0.5));
    vec3 pc = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + u_time * 0.25 + p.y * 0.4));
    col = mix(col, col * 0.55 + pc * (0.18 + 0.32 * chev) * (0.8 + 0.4 * u_beat), u_prism);
  }
  col *= mix(1.0, 0.6, u_hc);
  o = vec4(col * u_encode, 1.0);
}`;

/** First bloom pass: soft threshold + 13-tap downsample (Jimenez 2014). */
export const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_threshold;   // <0 = no threshold
uniform float u_decode;
out vec4 o;
vec3 s(vec2 off) { return texture(u_src, v_uv + off * u_texel).rgb; }
void main() {
  vec3 a = s(vec2(-2, -2)), b = s(vec2(0, -2)), c = s(vec2(2, -2));
  vec3 d = s(vec2(-1, -1)), e = s(vec2(1, -1));
  vec3 f = s(vec2(-2, 0)), g = s(vec2(0, 0)), h = s(vec2(2, 0));
  vec3 i = s(vec2(-1, 1)), j = s(vec2(1, 1));
  vec3 k = s(vec2(-2, 2)), l = s(vec2(0, 2)), m = s(vec2(2, 2));
  vec3 col = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;
  if (u_threshold >= 0.0) {
    col *= u_decode;
    float br = max(col.r, max(col.g, col.b));
    float knee = 0.45;
    float soft = clamp(br - u_threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float contrib = max(soft, br - u_threshold) / max(br, 1e-4);
    col *= contrib;
    col = min(col, vec3(24.0));
  }
  o = vec4(col, 1.0);
}`;

/** Bloom upsample: 9-tap tent, additively blended onto the next larger mip. */
export const UP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_radius;
uniform float u_weight;
out vec4 o;
void main() {
  vec2 r = u_texel * u_radius;
  vec3 c = texture(u_src, v_uv + vec2(-r.x, -r.y)).rgb
    + texture(u_src, v_uv + vec2(0.0, -r.y)).rgb * 2.0
    + texture(u_src, v_uv + vec2(r.x, -r.y)).rgb
    + texture(u_src, v_uv + vec2(-r.x, 0.0)).rgb * 2.0
    + texture(u_src, v_uv).rgb * 4.0
    + texture(u_src, v_uv + vec2(r.x, 0.0)).rgb * 2.0
    + texture(u_src, v_uv + vec2(-r.x, r.y)).rgb
    + texture(u_src, v_uv + vec2(0.0, r.y)).rgb * 2.0
    + texture(u_src, v_uv + vec2(r.x, r.y)).rgb;
  o = vec4(c / 16.0 * u_weight, 1.0);
}`;

/** Final composite: scene + bloom, chromatic aberration, flash, breathing, vignette, tone map, grain. */
export const COMP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomStr;
uniform float u_ca;
uniform float u_flash;
uniform vec3 u_flashCol;
uniform float u_vignette;
uniform float u_grain;
uniform float u_time;
uniform float u_breath;   // slow-motion breathing 0..1
uniform float u_decode;
uniform float u_desat;
uniform vec2 u_aspect;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 tonemap(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  if (m > 0.82) {
    float k = 0.82 + (1.0 - exp(-(m - 0.82) * 2.6)) * 0.18;
    vec3 n = c * (k / m);
    // very bright highlights blossom towards white
    float w = clamp((m - 1.0) * 0.22, 0.0, 0.55);
    c = mix(n, vec3(k), w);
  }
  return c;
}

void main() {
  vec2 uv = v_uv;
  vec2 dir = (uv - 0.5);
  vec3 col;
  if (u_ca > 0.0005) {
    vec2 off = dir * u_ca * 0.009;
    col.r = texture(u_scene, uv + off).r;
    col.g = texture(u_scene, uv).g;
    col.b = texture(u_scene, uv - off).b;
  } else {
    col = texture(u_scene, uv).rgb;
  }
  col *= u_decode;
  vec3 bloom = texture(u_bloom, uv).rgb;
  col += bloom * u_bloomStr;
  // slow-mo breathing: gentle desaturation pulse
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum) * vec3(0.9, 0.95, 1.1), u_breath * 0.35 + u_desat);
  col += u_flashCol * u_flash;
  // vignette (aspect-aware)
  vec2 vd = dir * 2.0;
  float v = 1.0 - smoothstep(0.62, 1.5, length(vd)) * u_vignette;
  col *= v;
  col = tonemap(col);
  col += (hash(uv * 1000.0 + fract(u_time * 7.3)) - 0.5) * u_grain;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
