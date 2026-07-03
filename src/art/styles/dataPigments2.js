// ---------------------------------------------------------------------------
// Art option: "Data Pigments II" — the liquid-metal field, rebuilt on-brand.
//
// Same soul as Data Pigments (domain-warped fractal liquid + data impacts that
// modulate the field itself), with the two complaints fixed:
//
//   • ON-BRAND COLOUR — the original coloured itself with a cycling rainbow
//     palette; those saturated hues survive the Recolour grade by design, so it
//     could never sit on brand. Here the liquid is coloured NATIVELY from the
//     active brand palette (background → primary → secondary ramp), eased
//     smoothly when the brand changes. Event colours still punch through.
//   • NO PIXELATION — the old per-frame animated film grain (pixel crawl) is
//     replaced with a static dither; real metallic shading (derivative normals,
//     soft specular) replaces harsh value ridges; and the piece renders at 2×
//     resolution (static resScale, honoured by the Stage) so it supersamples.
//
// Data reactions are unchanged: visitor → ripple wave through the pigment ·
// sale/flavour → bloom that recolours the structure (+ whole-field dye) ·
// product → a shockwave that warps and tears the field.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';

const FX_MAX = 16;
const BASE_ENERGY = 0.55;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  #define FX_MAX ${FX_MAX}
  varying vec2 vUv;
  uniform float uTime, uAspect, uEnergy, uWarp, uSpeed, uMetal, uTintAmount;
  uniform vec3  uTint;
  uniform vec3  uCDeep, uCMid, uCHi;   // brand: background → primary → secondary
  uniform vec4  uFxPos[FX_MAX];        // xy=pos(0..1), z=ageNorm, w=kind
  uniform vec3  uFxColor[FX_MAX];
  uniform int   uFxCount;

  ${NOISE_GLSL}

  void main(){
    vec2 uv = vUv;
    vec2 cuv = (uv - 0.5); cuv.x *= uAspect;

    // --- Effects modulate the field: displacement (disp), local intensity
    //     (heat) and a hue pulled into the structure (fxTint). No overlay. ---
    vec2 disp = vec2(0.0);
    float heat = 0.0;
    vec3 fxTint = vec3(0.0);
    float fxTintAmt = 0.0;
    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      vec4 fx = uFxPos[i];
      vec2 c = (fx.xy - 0.5); c.x *= uAspect;
      vec2 dv = cuv - c;
      float dist = length(dv) + 1e-5;
      vec2 dir = dv / dist;
      float age = fx.z;
      float fade = 1.0 - age;
      if (fx.w < 0.5) {
        // RIPPLE: a travelling wave ripples the pigment outward.
        float env = exp(-pow((dist - age * 0.7) * 6.0, 2.0));
        disp += dir * sin((dist - age * 0.7) * 38.0) * env * 0.05 * fade;
        heat += env * fade * 0.5;
      } else if (fx.w < 1.5) {
        // BLAST: bloom + recolour existing structure, gentle swell.
        float core = exp(-dist * dist * 22.0);
        disp += dir * core * fade * 0.04;
        heat += core * fade * 1.7;
        fxTint += uFxColor[i] * core * fade;
        fxTintAmt += core * fade;
      } else {
        // DISRUPTION: shockwave warps + tears the field.
        float shell = exp(-pow((dist - age * 0.85) * 7.0, 2.0));
        disp += dir * shell * fade * 0.18;
        heat -= shell * fade * 0.35;
        fxTint += uFxColor[i] * shell * fade * 0.5;
        fxTintAmt += shell * fade * 0.5;
      }
    }
    fxTintAmt = clamp(fxTintAmt, 0.0, 1.0);

    // --- The liquid: domain-warped fbm, as before. ---
    vec2 p = (cuv + disp) * 2.2;
    float t = uTime * 0.06 * uSpeed;
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t)));
    vec2 r = vec2(fbm(p + uWarp * q + vec2(1.7, 9.2) + 0.4 * t),
                  fbm(p + uWarp * q + vec2(8.3, 2.8) - 0.4 * t));
    float v = fbm(p + uWarp * r) * 0.5 + 0.5;
    float ridges = pow(smoothstep(0.22, 0.95, v), 1.6);

    // --- LIQUID METAL, ON BRAND: deep near-black pools, ridges lit through the
    //     brand palette, metallic shading from derivative normals with specular
    //     glints only on the peaks (no rainbow). ---
    vec3 N = normalize(vec3(-dFdx(v), -dFdy(v), 0.06));
    vec3 L = normalize(vec3(0.42, 0.55, 0.72));
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 52.0);

    vec3 base = mix(uCDeep * 0.45, uCMid, smoothstep(0.32, 0.82, v + 0.08 * length(r)));
    base = mix(base, mix(uCHi, vec3(1.0), 0.25), smoothstep(0.80, 0.99, v + 0.22 * ridges));
    vec3 col = base * (0.10 + 1.30 * ridges * (0.6 + 0.4 * uEnergy)) * (0.55 + 0.45 * diff);
    col += mix(uCHi, vec3(1.0), 0.6) * spec * uMetal * ridges; // glints on the peaks

    col *= (1.0 + heat);                                       // effects intensify the real pigment
    col = mix(col, fxTint * (0.5 + 1.5 * ridges), fxTintAmt);  // hue pulled INTO the structure
    col = mix(col, uTint * (0.5 + 1.2 * ridges), uTintAmount * ridges); // flavour dye

    col = col / (col + vec3(0.8));
    col = pow(col, vec3(0.85));
    float vig = smoothstep(1.3, 0.35, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= 0.55 + 0.45 * vig;
    // Static dither (banding relief) — no animated grain, no pixel crawl.
    float g = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.008;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export class DataPigments2 extends BaseArt {
  static id = 'data-pigments-2';
  static label = 'Data Pigments II';
  static resScale = 2; // supersampled — renders at 2× and downsamples (no pixelation)
  static params = [
    { key: 'warp', type: 'range', label: 'Warp', min: 0.6, max: 2.2, step: 0.05, default: 1.3 },
    { key: 'speed', type: 'range', label: 'Flow speed', min: 0.2, max: 3, step: 0.1, default: 1 },
    { key: 'metal', type: 'range', label: 'Metal', min: 0, max: 1, step: 0.05, default: 0.55 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.tint = new THREE.Color('#ffffff');
    this.energy = new Eased(BASE_ENERGY, { max: 3, decay: 0.6, rise: 2.0 });
    this.tintAmount = new Eased(0, { max: 0.85, decay: 0.35, rise: 2.5 });
    this.fx = new EffectField(FX_MAX);
    this.warp = 1.3;
    // Brand palette targets (eased toward on brand change). IQOS-ish defaults
    // until the Stage hands us the active brand.
    this._toDeep = new THREE.Color('#0a1a2f');
    this._toMid = new THREE.Color('#00d1d2');
    this._toHi = new THREE.Color('#ffffff');

    const aspect = this.size.width / this.size.height;
    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: BASE_ENERGY },
      uWarp: { value: 1.3 },
      uSpeed: { value: 1 },
      uMetal: { value: 0.55 },
      uCDeep: { value: this._toDeep.clone() },
      uCMid: { value: this._toMid.clone() },
      uCHi: { value: this._toHi.clone() },
      uTint: { value: this.tint.clone() },
      uTintAmount: { value: 0 },
      uFxPos: { value: Array.from({ length: FX_MAX }, () => new THREE.Vector4()) },
      uFxColor: { value: Array.from({ length: FX_MAX }, () => new THREE.Color()) },
      uFxCount: { value: 0 },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** The liquid takes its colours straight from the brand palette (eased). */
  setBrand(_brandId, brand) {
    const pal = brand?.palette;
    if (!pal) return;
    this._toDeep.set(pal.shadow ?? pal.background);
    this._toMid.set(pal.primary);
    this._toHi.set(pal.secondary || '#ffffff');
  }

  setParams(p) {
    if (p.warp != null) this.warp = p.warp;
    if (p.speed != null) this.uniforms.uSpeed.value = p.speed;
    if (p.metal != null) this.uniforms.uMetal.value = p.metal;
  }

  resize(size) {
    this.size = size;
    this.uniforms.uAspect.value = size.width / size.height;
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    const fx = this.fx.spawn(event);
    if (fx) this.energy.bump(KIND_ENERGY[fx.kind]);
    if (event.type === EventTypes.FLAVOUR_SOLD) {
      this.tint.set(event.data?.color || '#ffffff');
      this.tintAmount.set(0.85);
    }
  }

  update(dt) {
    this.time += dt;
    this.fx.update(dt);
    const e = this.energy.update(dt);

    // Ease the liquid toward the active brand's palette (smooth brand changes).
    const k = Math.min(1, dt * 2);
    this.uniforms.uCDeep.value.lerp(this._toDeep, k);
    this.uniforms.uCMid.value.lerp(this._toMid, k);
    this.uniforms.uCHi.value.lerp(this._toHi, k);

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = e;
    this.uniforms.uWarp.value = this.warp + e * 0.5;
    this.uniforms.uTint.value.copy(this.tint);
    this.uniforms.uTintAmount.value = this.tintAmount.update(dt);
    this.uniforms.uFxCount.value = this.fx.write(this.uniforms.uFxPos.value, this.uniforms.uFxColor.value);

    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this.renderTarget.texture; }

  destroy() {
    this.quad.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(DataPigments2);
