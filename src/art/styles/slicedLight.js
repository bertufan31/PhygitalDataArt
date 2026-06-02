// ---------------------------------------------------------------------------
// Art option: "Sliced Light".
//
// A luminous form revealed through vertical light-slats — glowing bars over
// black, each a discrete vertical slice of a moving form, with a cylindrical
// highlight running down each slat. Pairs naturally with the LED-prism wall.
//
// Three distinct data reactions (art/effects.js):
//   visitor → RIPPLE ring · sale/flavour → colour BLAST · product → DISRUPTION
// which warps the sliced form (slices shear/tear). Flavour also dyes the light.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL, FX_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';

const FX_MAX = 16;
const BASE_ENERGY = 0.5;
const SLATS = 56;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  #define SLATS float(${SLATS})
  varying vec2 vUv;
  uniform float uTime, uAspect, uEnergy, uPaletteShift, uTintAmount;
  uniform vec3  uTint;

  ${NOISE_GLSL}
  ${FX_GLSL}

  // Cool blue → cyan → white.
  vec3 palette(float t){
    vec3 a = vec3(0.40, 0.50, 0.65);
    vec3 b = vec3(0.35, 0.40, 0.45);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.65, 0.55, 0.40);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main(){
    vec2 uv = vUv;
    float sx = uv.x * SLATS;
    float slat = floor(sx);
    float u = fract(sx);

    // Sample the form at the slat CENTRE → a discrete vertical slice.
    vec2 cuv = vec2((slat + 0.5) / SLATS, uv.y);
    vec2 wc = (cuv - 0.5); wc.x *= uAspect;
    wc += fxDisplace(wc);                              // product DISRUPTION shears the slices

    float t = uTime * 0.15;
    float r = length(wc * vec2(1.0, 1.25));
    float orb = smoothstep(0.85, 0.05, r);            // tighter, darker-edged form
    float streaks = fbm(vec2(cuv.x * 3.0, cuv.y * 6.0 - t));
    float form = clamp(orb * (0.5 + 0.65 * streaks) * (0.7 + 0.5 * uEnergy), 0.0, 1.0);
    form = pow(form, 1.3);                            // more contrast / definition

    // Slat shaping: dark gaps + a cylindrical highlight down each bar.
    float gap = smoothstep(0.0, 0.07, u) * smoothstep(1.0, 0.93, u);
    float spec = exp(-pow((u - 0.5) * 5.0, 2.0));

    vec3 col = palette(0.6 - 0.25 * form + uPaletteShift) * form * gap;
    col += vec3(0.9, 0.95, 1.0) * spec * form * 0.85; // brighter slat highlight
    col = mix(col, uTint * form, uTintAmount * 0.6);  // flavour dye

    vec2 fcuv = (uv - 0.5); fcuv.x *= uAspect;
    col += fxColor(fcuv) * gap;                        // ripple + blast (gated by slats)

    col = col / (col + vec3(0.7));
    col = pow(col, vec3(0.9));
    float vig = smoothstep(1.3, 0.3, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= 0.5 + 0.5 * vig;
    float g = fract(sin(dot(uv * vec2(uTime + 1.0, uTime + 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.02;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export class SlicedLight extends BaseArt {
  static id = 'sliced-light';
  static label = 'Sliced Light';

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
    this.paletteShift += dt * 0.01;
    this.fx.update(dt);

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = this.energy.update(dt);
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

registerArt(SlicedLight);
