// ---------------------------------------------------------------------------
// Art option: "Liquid Light".
//
// The classic Anadol nebula: large, smooth, luminous plumes drifting slowly
// over deep black with lots of negative space. Implements the three distinct
// data reactions (art/effects.js): visitor RIPPLE ring, sale/flavour colour
// BLAST, product DISRUPTION warp — plus a flavour dye and the energy model.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL, FX_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';

const FX_MAX = 16;
const BASE_ENERGY = 0.5;

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
    vec3 a = vec3(0.5, 0.5, 0.55);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.55, 0.35, 0.10);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main(){
    vec2 uv = vUv;
    vec2 cuv = (uv - 0.5); cuv.x *= uAspect;
    vec2 p = (cuv + fxDisplace(cuv)) * 1.4;
    float t = uTime * 0.035;

    vec2 q = vec2(fbm(p * 0.8 + vec2(0.0, t)), fbm(p * 0.8 + vec2(4.0, -t)));
    float v = fbm(p + uWarp * q + 0.2 * t);
    v = v * 0.5 + 0.5;

    float lum  = pow(smoothstep(0.55, 0.95, v), 1.4);
    float glow = pow(smoothstep(0.45, 1.0, v), 2.0);
    float tt = v * 0.8 + 0.2 * q.x + uPaletteShift;
    vec3 col = palette(tt) * (lum * 1.7 + glow * 0.5) * (0.7 + 0.5 * uEnergy);

    col = mix(col, uTint * (0.6 + 1.0 * lum), uTintAmount * lum); // flavour dye
    col += fxColor(cuv);                                          // ripple + blast + shock edge

    col = col / (col + vec3(0.75));
    col = pow(col, vec3(0.9));
    float vig = smoothstep(1.35, 0.3, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= 0.5 + 0.5 * vig;
    float g = fract(sin(dot(uv * vec2(uTime + 1.0, uTime + 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.018;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export class LiquidLight extends BaseArt {
  static id = 'liquid-light';
  static label = 'Liquid Light';
  static archived = true; // lower-priority — tucked under the Archive disclosure

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.paletteShift = 0;
    this.tint = new THREE.Color('#ffffff');
    this.energy = new Eased(BASE_ENERGY, { max: 3, decay: 0.5, rise: 1.8 });
    this.tintAmount = new Eased(0, { max: 0.85, decay: 0.3, rise: 2.2 });
    this.fx = new EffectField(FX_MAX);

    const aspect = this.size.width / this.size.height;
    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: BASE_ENERGY },
      uWarp: { value: 1.2 },
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
    if (fx) this.energy.bump(KIND_ENERGY[fx.kind]);
    if (event.type === EventTypes.FLAVOUR_SOLD) {
      this.tint.set(event.data?.color || '#ffffff');
      this.tintAmount.set(0.85);
    }
  }

  update(dt) {
    this.time += dt;
    this.paletteShift += dt * 0.008;
    this.fx.update(dt);
    const e = this.energy.update(dt);

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = e;
    this.uniforms.uWarp.value = 1.1 + e * 0.5;
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

registerArt(LiquidLight);
