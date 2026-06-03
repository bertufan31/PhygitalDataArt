// ---------------------------------------------------------------------------
// Art option: "Data Pigments".
//
// A flowing, Anadol-flavoured liquid-light field: domain-warped fractal noise
// rendered as luminous structure over deep black, with cinematic tone-mapping.
//
// Data reactions MODULATE THE FIELD ITSELF (not coloured discs on top):
//   visitor  → RIPPLE     a travelling wave actually ripples the pigment outward
//   sale/flav→ BLAST      blooms + recolours the EXISTING structure (hue pulled
//                         into the ridges), with a gentle swell
//   product  → DISRUPTION a shockwave warps and tears the field
// A flavour also dyes the whole field; activity builds eased "energy".
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
  uniform float uTime, uAspect, uEnergy, uWarp, uPaletteShift, uTintAmount;
  uniform vec3  uTint;
  uniform vec4  uFxPos[FX_MAX];   // xy=pos(0..1), z=ageNorm, w=kind
  uniform vec3  uFxColor[FX_MAX];
  uniform int   uFxCount;

  ${NOISE_GLSL}

  vec3 palette(float t){
    vec3 a = vec3(0.5, 0.45, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.45);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00, 0.12, 0.24);
    return a + b * cos(6.28318 * (c * t + d));
  }

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

    vec2 p = (cuv + disp) * 2.2;
    float t = uTime * 0.06;
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t)));
    vec2 r = vec2(fbm(p + uWarp * q + vec2(1.7, 9.2) + 0.4 * t),
                  fbm(p + uWarp * q + vec2(8.3, 2.8) - 0.4 * t));
    float v = fbm(p + uWarp * r);
    v = v * 0.5 + 0.5;
    float ridges = pow(smoothstep(0.22, 0.95, v), 1.6);

    float tt = v + 0.15 * length(r) + uPaletteShift;
    vec3 col = palette(tt) * (0.12 + 1.3 * ridges * (0.6 + 0.4 * uEnergy));
    col *= (1.0 + heat);                                       // effects intensify the real pigment
    col = mix(col, fxTint * (0.5 + 1.5 * ridges), fxTintAmt);  // hue pulled INTO the structure
    col = mix(col, uTint * (0.5 + 1.2 * ridges), uTintAmount * ridges); // flavour dye

    col = col / (col + vec3(0.8));
    col = pow(col, vec3(0.85));
    float vig = smoothstep(1.3, 0.35, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= 0.55 + 0.45 * vig;
    float g = fract(sin(dot(uv * vec2(uTime + 1.0, uTime + 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.022;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export class DataPigments extends BaseArt {
  static id = 'data-pigments';
  static label = 'Data Pigments';

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.paletteShift = 0;
    this.tint = new THREE.Color('#ffffff');
    this.energy = new Eased(BASE_ENERGY, { max: 3, decay: 0.6, rise: 2.0 });
    this.tintAmount = new Eased(0, { max: 0.85, decay: 0.35, rise: 2.5 });
    this.fx = new EffectField(FX_MAX);

    const aspect = this.size.width / this.size.height;
    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: BASE_ENERGY },
      uWarp: { value: 1.3 },
      uPaletteShift: { value: 0 },
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
    this.paletteShift += dt * 0.01;
    this.fx.update(dt);
    const e = this.energy.update(dt);

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = e;
    this.uniforms.uWarp.value = 1.25 + e * 0.55;
    this.uniforms.uPaletteShift.value = this.paletteShift;
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

registerArt(DataPigments);
