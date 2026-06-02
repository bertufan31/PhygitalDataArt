// ---------------------------------------------------------------------------
// Art option: "Liquid Light".
//
// The classic Anadol nebula: large, smooth, luminous plumes drifting slowly
// over deep black with lots of negative space. Lower-frequency and calmer than
// Data Pigments — fewer, bigger forms that glow. Same data reactions and the
// same "energy" breathing model.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';

const SPLATS = 16;
const BASE_ENERGY = 0.5;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  #define SPLATS ${SPLATS}
  varying vec2 vUv;
  uniform float uTime, uAspect, uEnergy, uWarp, uPaletteShift, uTintAmount;
  uniform vec3  uTint;
  uniform vec3  uSplatPos[SPLATS];
  uniform vec3  uSplatColor[SPLATS];
  uniform int   uSplatCount;

  ${NOISE_GLSL}

  // Deep blue → teal → magenta → gold.
  vec3 palette(float t){
    vec3 a = vec3(0.5, 0.5, 0.55);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.55, 0.35, 0.10);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main(){
    vec2 uv = vUv;
    vec2 p = (uv - 0.5); p.x *= uAspect; p *= 1.4;
    float t = uTime * 0.035;

    // A single gentle domain warp → large, smooth forms.
    vec2 q = vec2(fbm(p * 0.8 + vec2(0.0, t)), fbm(p * 0.8 + vec2(4.0, -t)));
    float v = fbm(p + uWarp * q + 0.2 * t);
    v = v * 0.5 + 0.5;

    // Lots of black: only the upper range lights up; a softer wider glow blooms.
    float lum  = pow(smoothstep(0.55, 0.95, v), 1.4);
    float glow = pow(smoothstep(0.45, 1.0, v), 2.0);

    float tt = v * 0.8 + 0.2 * q.x + uPaletteShift;
    vec3 col = palette(tt) * (lum * 1.7 + glow * 0.5) * (0.7 + 0.5 * uEnergy);

    col = mix(col, uTint * (0.6 + 1.0 * lum), uTintAmount * lum);

    // Large soft luminous splats.
    vec2 pp = (uv - 0.5); pp.x *= uAspect;
    for (int i = 0; i < SPLATS; i++) {
      if (i >= uSplatCount) break;
      vec3 s = uSplatPos[i];
      float strength = s.z;
      vec2 cc = (s.xy - 0.5); cc.x *= uAspect;
      float d = distance(pp, cc);
      float core = exp(-d * d * 28.0) * strength;
      float ring = exp(-pow((d - (1.0 - strength) * 0.6) * 6.0, 2.0)) * strength * 0.4;
      col += uSplatColor[i] * (core * 1.3 + ring);
    }

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

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.energy = BASE_ENERGY;
    this.paletteShift = 0;
    this.tint = new THREE.Color('#ffffff');
    this.tintAmount = 0;
    this.splats = [];

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: this.size.width / this.size.height },
      uEnergy: { value: this.energy },
      uWarp: { value: 1.2 },
      uPaletteShift: { value: 0 },
      uTint: { value: this.tint.clone() },
      uTintAmount: { value: 0 },
      uSplatPos: { value: Array.from({ length: SPLATS }, () => new THREE.Vector3()) },
      uSplatColor: { value: Array.from({ length: SPLATS }, () => new THREE.Color()) },
      uSplatCount: { value: 0 },
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

  _splat(p) {
    p.age = 0;
    this.splats.push(p);
    if (this.splats.length > SPLATS) this.splats.shift();
  }

  onEvent(event) {
    const x = Math.random();
    const y = Math.random();
    switch (event.type) {
      case EventTypes.VISITOR_ENTERED:
        this._splat({ x, y, life: 3.0, strength: 0.6, color: new THREE.Color('#7fe0ff') });
        this.energy += 0.1;
        break;
      case EventTypes.SALE_MADE:
        this._splat({ x, y, life: 5.0, strength: 1.0, color: new THREE.Color('#fff0bf') });
        this.energy += 0.45;
        break;
      case EventTypes.PRODUCT_SOLD:
        this._splat({ x, y, life: 3.6, strength: 0.8, color: new THREE.Color('#c79bff') });
        this.energy += 0.22;
        this.paletteShift += 0.06;
        break;
      case EventTypes.FLAVOUR_SOLD: {
        const c = new THREE.Color(event.data?.color || '#ffffff');
        this._splat({ x, y, life: 4.4, strength: 0.95, color: c });
        this.tint.copy(c);
        this.tintAmount = Math.min(0.85, this.tintAmount + 0.5);
        this.energy += 0.32;
        break;
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.energy += (BASE_ENERGY - this.energy) * Math.min(1, dt * 0.5);
    this.tintAmount += (0 - this.tintAmount) * Math.min(1, dt * 0.3);
    this.paletteShift += dt * 0.008;

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = this.energy;
    this.uniforms.uWarp.value = 1.1 + this.energy * 0.5;
    this.uniforms.uPaletteShift.value = this.paletteShift;
    this.uniforms.uTint.value.copy(this.tint);
    this.uniforms.uTintAmount.value = this.tintAmount;

    for (const s of this.splats) s.age += dt;
    this.splats = this.splats.filter((s) => s.age < s.life);
    const n = Math.min(this.splats.length, SPLATS);
    for (let i = 0; i < n; i++) {
      const s = this.splats[i];
      const strength = (1 - s.age / s.life) * s.strength;
      this.uniforms.uSplatPos.value[i].set(s.x, s.y, strength);
      this.uniforms.uSplatColor.value[i].copy(s.color);
    }
    this.uniforms.uSplatCount.value = n;

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
