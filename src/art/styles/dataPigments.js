// ---------------------------------------------------------------------------
// Art option: "Data Pigments".
//
// A flowing, Anadol-flavoured liquid-light field: domain-warped fractal noise
// rendered as luminous structure over deep black, with cinematic tone-mapping,
// vignette and grain. This is the first "real" style — the reference for how
// rich a piece can be on top of the BaseArt pipeline.
//
// Store signals drive it:
//   • visitor entered → a cool filament/seed of turbulence is injected
//   • sale made       → a bright luminous bloom ripples out + energy spikes
//   • product sold    → the palette phase shifts
//   • flavour sold     → a splat in the flavour's colour AND the whole field is
//                        dyed toward that colour (e.g. "TEREA Yellow")
// "Energy" accumulates with activity (more churn + glow) and decays to a calm
// baseline, so the piece visibly breathes with the store.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';

const SPLATS = 16;
const BASE_ENERGY = 0.55;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  #define SPLATS ${SPLATS}

  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform float uEnergy;       // global activity (≈0.5 calm … 3 busy)
  uniform float uWarp;         // domain-warp amount
  uniform float uPaletteShift; // slow palette drift
  uniform vec3  uTint;         // flavour dye colour
  uniform float uTintAmount;   // how strongly the field is dyed (0..~0.85)
  uniform vec3  uSplatPos[SPLATS];   // xy in 0..1, z = strength 0..1
  uniform vec3  uSplatColor[SPLATS];
  uniform int   uSplatCount;

  // --- Ashima 2D simplex noise -------------------------------------------
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
  // -----------------------------------------------------------------------

  float fbm(vec2 p){
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * snoise(p);
      p = p * 2.02 + vec2(7.13, 3.71);
      a *= 0.5;
    }
    return s;
  }

  // Inigo Quilez cosine palette — deep blue → magenta → warm gold.
  vec3 palette(float t){
    vec3 a = vec3(0.5, 0.45, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.45);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00, 0.12, 0.24);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main(){
    vec2 uv = vUv;
    vec2 p = (uv - 0.5);
    p.x *= uAspect;
    p *= 2.2;

    float t = uTime * 0.06;

    // Domain warp: fold the field through itself twice for that liquid flow.
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t)));
    vec2 r = vec2(fbm(p + uWarp * q + vec2(1.7, 9.2) + 0.4 * t),
                  fbm(p + uWarp * q + vec2(8.3, 2.8) - 0.4 * t));
    float v = fbm(p + uWarp * r);
    v = v * 0.5 + 0.5;

    // Deep shadows, luminous ridges.
    float structure = smoothstep(0.22, 0.95, v);
    float ridges = pow(structure, 1.6);

    float tt = v + 0.15 * length(r) + uPaletteShift;
    vec3 col = palette(tt) * (0.12 + 1.3 * ridges * (0.6 + 0.4 * uEnergy));

    // Flavour dye on the luminous regions.
    col = mix(col, uTint * (0.5 + 1.2 * ridges), uTintAmount * ridges);

    // Event splats: soft core + expanding ring.
    vec2 pp = (uv - 0.5); pp.x *= uAspect;
    for (int i = 0; i < SPLATS; i++) {
      if (i >= uSplatCount) break;
      vec3 s = uSplatPos[i];
      float strength = s.z;
      vec2 cc = (s.xy - 0.5); cc.x *= uAspect;
      float d = distance(pp, cc);
      float core = exp(-d * d * 60.0) * strength;
      float ring = exp(-pow((d - (1.0 - strength) * 0.5) * 9.0, 2.0)) * strength * 0.5;
      col += uSplatColor[i] * (core * 1.4 + ring);
    }

    // Filmic-ish tone map + gentle gamma.
    col = col / (col + vec3(0.8));
    col = pow(col, vec3(0.85));

    // Vignette.
    float vig = smoothstep(1.3, 0.35, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= 0.55 + 0.45 * vig;

    // Fine grain.
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
    this.splats = []; // { x, y, age, life, strength, color }

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: this.size.width / this.size.height },
      uEnergy: { value: this.energy },
      uWarp: { value: 1.3 },
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
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
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
        this._splat({ x, y, life: 2.6, strength: 0.7, color: new THREE.Color('#7fe0ff') });
        this.energy += 0.12;
        break;
      case EventTypes.SALE_MADE:
        this._splat({ x, y, life: 4.2, strength: 1.0, color: new THREE.Color('#fff2c0') });
        this.energy += 0.5;
        break;
      case EventTypes.PRODUCT_SOLD:
        this._splat({ x, y, life: 3.0, strength: 0.85, color: new THREE.Color('#b08bff') });
        this.energy += 0.25;
        this.paletteShift += 0.07;
        break;
      case EventTypes.FLAVOUR_SOLD: {
        const c = new THREE.Color(event.data?.color || '#ffffff');
        this._splat({ x, y, life: 3.6, strength: 0.95, color: c });
        this.tint.copy(c);
        this.tintAmount = Math.min(0.85, this.tintAmount + 0.5);
        this.energy += 0.35;
        break;
      }
    }
  }

  update(dt) {
    this.time += dt;

    // Energy + tint relax toward calm.
    this.energy += (BASE_ENERGY - this.energy) * Math.min(1, dt * 0.6);
    this.tintAmount += (0 - this.tintAmount) * Math.min(1, dt * 0.35);
    this.paletteShift += dt * 0.01;

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = this.energy;
    this.uniforms.uWarp.value = 1.25 + this.energy * 0.55;
    this.uniforms.uPaletteShift.value = this.paletteShift;
    this.uniforms.uTint.value.copy(this.tint);
    this.uniforms.uTintAmount.value = this.tintAmount;

    // Age splats, write uniforms.
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

  get texture() {
    return this.renderTarget.texture;
  }

  destroy() {
    this.quad.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(DataPigments);
