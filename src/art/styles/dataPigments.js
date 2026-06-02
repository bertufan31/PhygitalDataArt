// ---------------------------------------------------------------------------
// Art option: "Data Pigments".
//
// A flowing, Anadol-flavoured liquid-light field: domain-warped fractal noise
// rendered as luminous structure over deep black, with cinematic tone-mapping,
// vignette and grain.
//
// Implements the three distinct data reactions (see art/effects.js):
//   visitor → RIPPLE ring · sale/flavour → colour BLAST · product → DISRUPTION
// warp. A flavour additionally dyes the whole field its colour, and activity
// builds "energy" (more churn + glow) that relaxes to a calm baseline.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL, FX_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY } from '../effects.js';

const FX_MAX = 16;
const BASE_ENERGY = 0.55;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uAspect, uEnergy, uWarp, uPaletteShift, uTintAmount;
  uniform vec3  uTint;

  ${NOISE_GLSL}
  ${FX_GLSL}

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
    vec2 p = (cuv + fxDisplace(cuv)) * 2.2;   // product DISRUPTION warps the field
    float t = uTime * 0.06;

    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t)));
    vec2 r = vec2(fbm(p + uWarp * q + vec2(1.7, 9.2) + 0.4 * t),
                  fbm(p + uWarp * q + vec2(8.3, 2.8) - 0.4 * t));
    float v = fbm(p + uWarp * r);
    v = v * 0.5 + 0.5;

    float ridges = pow(smoothstep(0.22, 0.95, v), 1.6);
    float tt = v + 0.15 * length(r) + uPaletteShift;
    vec3 col = palette(tt) * (0.12 + 1.3 * ridges * (0.6 + 0.4 * uEnergy));

    col = mix(col, uTint * (0.5 + 1.2 * ridges), uTintAmount * ridges); // flavour dye
    col += fxColor(cuv);                                                // ripple + blast + shock edge

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
    this.energy = BASE_ENERGY;
    this.paletteShift = 0;
    this.tint = new THREE.Color('#ffffff');
    this.tintAmount = 0;
    this.fx = new EffectField(FX_MAX);

    const aspect = this.size.width / this.size.height;
    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: this.energy },
      uWarp: { value: 1.3 },
      uPaletteShift: { value: 0 },
      uTint: { value: this.tint.clone() },
      uTintAmount: { value: 0 },
      uFxPos: { value: Array.from({ length: FX_MAX }, () => new THREE.Vector4()) },
      uFxColor: { value: Array.from({ length: FX_MAX }, () => new THREE.Color()) },
      uFxCount: { value: 0 },
      uFxAspect: { value: aspect },
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
    const aspect = size.width / size.height;
    this.uniforms.uAspect.value = aspect;
    this.uniforms.uFxAspect.value = aspect;
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    const fx = this.fx.spawn(event);
    if (fx) this.energy += KIND_ENERGY[fx.kind];
    if (event.type === EventTypes.FLAVOUR_SOLD) {
      this.tint.set(event.data?.color || '#ffffff');
      this.tintAmount = Math.min(0.85, this.tintAmount + 0.5);
    }
  }

  update(dt) {
    this.time += dt;
    this.energy += (BASE_ENERGY - this.energy) * Math.min(1, dt * 0.6);
    this.tintAmount += (0 - this.tintAmount) * Math.min(1, dt * 0.35);
    this.paletteShift += dt * 0.01;
    this.fx.update(dt);

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = this.energy;
    this.uniforms.uWarp.value = 1.25 + this.energy * 0.55;
    this.uniforms.uPaletteShift.value = this.paletteShift;
    this.uniforms.uTint.value.copy(this.tint);
    this.uniforms.uTintAmount.value = this.tintAmount;
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
