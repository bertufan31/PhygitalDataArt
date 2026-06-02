// ---------------------------------------------------------------------------
// Shared GLSL building blocks for art styles. Inject into a shader string with
// a template literal, e.g.  `precision highp float; ${NOISE_GLSL} void main(){…}`
//
// Provides: snoise(vec2) simplex noise, fbm(vec2) 4-octave fractal noise, and
// curl(vec2) a divergence-free flow field (great for streaming particles).
// ---------------------------------------------------------------------------

export const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  float fbm(vec2 p){
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * snoise(p);
      p = p * 2.02 + vec2(7.13, 3.71);
      a *= 0.5;
    }
    return s;
  }
  vec2 curl(vec2 p){
    float e = 0.1;
    float n1 = snoise(p + vec2(0.0, e));
    float n2 = snoise(p - vec2(0.0, e));
    float n3 = snoise(p + vec2(e, 0.0));
    float n4 = snoise(p - vec2(e, 0.0));
    return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
  }
`;

// ---------------------------------------------------------------------------
// Shared "data → effect" GLSL for fullscreen field shaders. Implements the three
// distinct reactions over a common uniform layout:
//   uFxPos[i] = vec4(x, y, ageNorm, kind)   kind: 0 ripple, 1 blast, 2 disrupt
//   uFxColor[i] = vec3
// Coordinates are in aspect-corrected centred-UV space: cuv = (uv-0.5) with
// cuv.x *= aspect. Use it like:
//   vec2 cuv = (uv-0.5); cuv.x *= uFxAspect;
//   vec2 p   = (cuv + fxDisplace(cuv)) * SCALE;   // disruption warps the field
//   ... sample your field with p ...
//   col += fxColor(cuv);                          // ripple + blast + shock edge
// ---------------------------------------------------------------------------
export const FX_GLSL = /* glsl */ `
  #ifndef FX_MAX
  #define FX_MAX 16
  #endif
  uniform vec4  uFxPos[FX_MAX];
  uniform vec3  uFxColor[FX_MAX];
  uniform int   uFxCount;
  uniform float uFxAspect;

  // DISRUPTION only: radial shockwave that displaces the field at its front.
  vec2 fxDisplace(vec2 cuv){
    vec2 disp = vec2(0.0);
    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      if (uFxPos[i].w < 1.5) continue;            // skip ripple/blast
      vec2 c = (uFxPos[i].xy - 0.5); c.x *= uFxAspect;
      vec2 d = cuv - c;
      float dist = length(d) + 1e-5;
      float age = uFxPos[i].z;
      float shell = exp(-pow((dist - age * 0.8) * 7.0, 2.0));
      disp += (d / dist) * shell * (1.0 - age) * 0.14;
    }
    return disp;
  }

  // RIPPLE + BLAST colour, plus the bright DISRUPTION shock edge.
  vec3 fxColor(vec2 cuv){
    vec3 col = vec3(0.0);
    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      vec4 fx = uFxPos[i];
      vec2 c = (fx.xy - 0.5); c.x *= uFxAspect;
      float dist = distance(cuv, c);
      float age = fx.z;
      float fade = 1.0 - age;
      if (fx.w < 0.5) {
        // RIPPLE: soft, thin, expanding ring.
        float ring = exp(-pow((dist - age * 0.6) * 9.0, 2.0));
        col += uFxColor[i] * ring * fade;
      } else if (fx.w < 1.5) {
        // BLAST: bright filled bloom.
        col += uFxColor[i] * exp(-dist * dist * 45.0) * fade * 2.0;
      } else {
        // DISRUPTION: sharp bright shock edge (the warp is in fxDisplace).
        float shell = exp(-pow((dist - age * 0.8) * 11.0, 2.0));
        col += uFxColor[i] * shell * fade * 1.3;
      }
    }
    return col;
  }
`;

