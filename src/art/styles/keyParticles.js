// ---------------------------------------------------------------------------
// Art option: "Key Particles".
//
// A rotating 3D point-cloud in the emblem shape, evolved into a brand-aware
// piece. Shapes are always CRISP — the silhouette is never deformed at rest;
// depth (3D) comes from the emblem's distance field or, for brand forms, a
// clean extruded slab. Behaviours:
//   • BRAND MORPH — particles flow between forms (emblem ↔ ZYN ↔ VEEV) with a
//                 smooth cross-morph from wherever they currently are; every
//                 form keeps the same rotation. Brands can auto-cycle
//                 (display-driven, pausable like the data feed).
//   • MOVEMENT  — a subtle per-particle depth breathing (Drift) gives life
//                 without touching the 2D outline.
//   • TOUCH    — a gentle anti-gravity push: particles ease away from the
//                 pointer/finger and ease back (Pointer control).
// Data reactions still tint particles toward the event colour.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';
import { samplePoints, sdfAt } from '../../core/shape.js';
import { hasBrandSilhouette, sampleBrandPoints } from '../../core/brandShapes.js';

const FX_MAX = 8;
const SHAPE_SCALE = 1.8; // emblem/brand fills the frame (samples are ~[-0.5,0.5])

const vertexShader = /* glsl */ `
  precision highp float;
  #define FX_MAX ${FX_MAX}
  attribute float aPhase;
  attribute float aSize;
  attribute vec3 aTarget;                 // morph destination (next form) for this point
  uniform float uTime, uEnergy, uTwinkle, uPixel, uSizeScale, uMorph, uDrift;
  uniform vec4 uPointer;                  // xy = pos (art space), z = eased presence, w = reach
  uniform vec4 uFxPos[FX_MAX];
  uniform vec3 uFxColor[FX_MAX];
  uniform int uFxCount;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vMix;
  void main(){
    vec3 pos = mix(position, aTarget, uMorph);       // previous form → next form

    // MOVEMENT: per-particle depth breathing only — the 2D silhouette is never
    // deformed, so the emblem/logos stay crisp.
    pos.z += sin(uTime * 0.5 + aPhase * 6.2831) * uDrift * 0.07;

    // TOUCH: gentle anti-gravity — particles ease away from the pointer and
    // ease back (uPointer.z is temporally smoothed on the CPU).
    if (uPointer.z > 0.001) {
      vec2 d = pos.xy - uPointer.xy;
      float push = exp(-dot(d, d) * 2.0);
      pos.xy += normalize(d + 1e-4) * push * uPointer.z * uPointer.w * 0.22;
    }

    vec3 tintCol = vec3(0.0);
    float tintAmt = 0.0, bright = 0.0, sizeB = 0.0;
    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      vec4 fx = uFxPos[i];
      vec2 c = fx.xy * 2.0 - 1.0;
      float dist = distance(pos.xy, c);
      float age = fx.z, fade = 1.0 - age;
      if (fx.w < 0.5) {                                    // ripple ring
        float w = exp(-pow((dist - age * 1.5) * 4.0, 2.0)) * fade;
        tintCol += uFxColor[i] * w; tintAmt += w; bright += w * 0.7; sizeB += w * 2.0;
      } else if (fx.w < 1.5) {                             // blast: wide central bloom
        float w = exp(-dist * dist * 4.0) * fade;
        tintCol += uFxColor[i] * w * 2.0; tintAmt += w * 2.0; bright += w * 1.3; sizeB += w * 4.5;
      } else {                                             // disruption scatter
        float w = exp(-pow((dist - age * 1.6) * 5.0, 2.0)) * fade;
        vec2 jd = normalize(vec2(sin(aPhase * 50.0), cos(aPhase * 33.0)) + 1e-5);
        pos.xy += jd * w * 0.08;
        tintCol += uFxColor[i] * w; tintAmt += w * 0.8; bright += w * 0.4; sizeB += w * 2.0;
      }
    }
    vTint = tintCol; vMix = tintAmt;
    float tw = 0.45 + 0.55 * abs(sin(uTime * uTwinkle + aPhase * 6.2831));
    vAlpha = tw * (0.7 + 0.35 * uEnergy) + bright;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixel * uSizeScale * (1.0 + 0.4 * uEnergy + sizeB) * (6.0 / -mv.z);
  }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vMix;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float m = smoothstep(0.5, 0.0, length(c));
    vec3 base = mix(vec3(0.82, 0.9, 1.0), vTint / max(vMix, 1e-3), clamp(vMix, 0.0, 1.0));
    gl_FragColor = vec4(base * m * vAlpha, m * vAlpha);
  }
`;

export class KeyParticles extends BaseArt {
  static id = 'key-particles';
  static label = 'Key Particles';
  static brandTheme = true; // palette/background follow the active brand
  static brandBgImage = true; // the brand's CMS background image shows behind the particles
  static params = [
    { key: 'count', type: 'range', label: 'Particles', min: 10000, max: 200000, step: 10000, default: 50000 },
    { key: 'size', type: 'range', label: 'Particle size', min: 0.3, max: 4, step: 0.1, default: 1 },
    { key: 'spin', type: 'range', label: 'Spin', min: 0, max: 1.0, step: 0.05, default: 0.3 },
    { key: 'depth', type: 'range', label: 'Depth', min: 0.0, max: 0.8, step: 0.05, default: 0.4 },
    { key: 'drift', type: 'range', label: 'Drift', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'pointer', type: 'range', label: 'Pointer push', min: 0, max: 1.5, step: 0.05, default: 0.7 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.spin = 0.3;
    this.count = 50000;
    this.depth = 0.4;
    this.brandId = null; // active brand (null/iqos = emblem)
    this.branded = false; // current form is a brand silhouette
    this.morph = 1; // eased cross-morph: position(prev form) → aTarget(next form)
    this.morphTarget = 1;
    this._pX = 0; this._pY = 0; this._pActive = false; this._pEase = 0; // pointer smoothing
    this.energy = new Eased(0.5, { max: 3, decay: 0.6, rise: 1.8 });
    // Spawn effects ON the active shape (it's thin; random points would miss it).
    this._pool = samplePoints(400);
    this.fx = new EffectField(FX_MAX, () => {
      const i = ((Math.random() * 400) | 0) * 2;
      return { x: (this._pool[i] * SHAPE_SCALE + 1) / 2, y: (this._pool[i + 1] * SHAPE_SCALE + 1) / 2 };
    });

    const aspect = this.size.width / this.size.height;
    this.uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0.5 },
      uTwinkle: { value: 1.6 },
      uPixel: { value: this.size.height / 600 },
      uSizeScale: { value: 1 },
      uMorph: { value: 1 },
      uDrift: { value: 0.35 },
      uPointer: { value: new THREE.Vector4(0, 0, 0, 0.7) },
      uFxPos: { value: Array.from({ length: FX_MAX }, () => new THREE.Vector4()) },
      uFxColor: { value: Array.from({ length: FX_MAX }, () => new THREE.Color()) },
      uFxCount: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });

    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.camera.position.set(0, 0, 3.2);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');
    this._build();

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  _build() {
    if (this.points) {
      this.scene.remove(this.points);
      this.geometry.dispose();
    }
    const n = this.count;
    const pts = samplePoints(n);
    const positions = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2] * SHAPE_SCALE;
      const y = pts[i * 2 + 1] * SHAPE_SCALE;
      const inside = sdfAt(pts[i * 2], pts[i * 2 + 1]);
      const z = (Math.random() < 0.5 ? -1 : 1) * inside * (this.depth / 0.18) + (Math.random() - 0.5) * 0.04;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      phase[i] = Math.random();
      sizes[i] = 0.7 + Math.random() * 1.1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aTarget', new THREE.BufferAttribute(positions.slice(), 3));
    this.geometry = geo;
    this._emblem = positions.slice(); // emblem base kept for re-targeting back
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    // If a brand is active when (re)building, jump straight to its form.
    if (this.branded) {
      this._writeTarget();
      this.morph = this.morphTarget = 1;
      this.uniforms.uMorph.value = 1;
    }
  }

  // Fill the morph-destination attribute with the NEXT form: the brand
  // silhouette (as a clean extruded slab — 3D, never wavy) or the emblem.
  _writeTarget() {
    const n = this.count;
    const tgt = this.geometry.attributes.aTarget.array;
    const brandPts = hasBrandSilhouette(this.brandId) ? sampleBrandPoints(this.brandId, n) : null;
    if (brandPts) {
      const slab = Math.max(this.depth, 0.05) * 0.45; // crisp extrusion depth
      for (let i = 0; i < n; i++) {
        tgt[i * 3] = brandPts[i * 2] * SHAPE_SCALE;
        tgt[i * 3 + 1] = brandPts[i * 2 + 1] * SHAPE_SCALE;
        tgt[i * 3 + 2] = (Math.random() - 0.5) * slab;
      }
    } else {
      tgt.set(this._emblem);
    }
    this.geometry.attributes.aTarget.needsUpdate = true;
  }

  /**
   * Brand morphing with smooth brand→brand transitions: the CURRENT blend is
   * baked into `position` as the new origin, the next form goes into `aTarget`,
   * and the morph eases 0 → 1 from wherever the particles are now.
   */
  setBrand(brandId) {
    if (brandId === this.brandId) return;
    this.brandId = brandId;
    this.branded = hasBrandSilhouette(brandId);
    if (!this.geometry) return;
    const pos = this.geometry.attributes.position;
    const tgt = this.geometry.attributes.aTarget;
    if (this.morph > 0) {
      const p = pos.array, t = tgt.array, m = this.morph;
      for (let i = 0; i < p.length; i++) p[i] += (t[i] - p[i]) * m; // bake current blend
      pos.needsUpdate = true;
    }
    this._writeTarget();
    this.morph = 0;
    this.morphTarget = 1;
  }

  /** Touch / pointer: position in NDC (-1..1); eased on update for smoothness. */
  setPointer(x, y, active) {
    // Map NDC to the art's world plane at z=0 (camera at z=3.2, fov 45°).
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z;
    const halfW = halfH * this.camera.aspect;
    this._pX = x * halfW;
    this._pY = y * halfH;
    this._pActive = active;
  }

  setParams(p) {
    if (p.spin != null) this.spin = p.spin;
    if (p.size != null) this.uniforms.uSizeScale.value = p.size;
    if (p.drift != null) this.uniforms.uDrift.value = p.drift;
    if (p.pointer != null) this.uniforms.uPointer.value.w = p.pointer;
    let rebuild = false;
    if (p.count != null && p.count !== this.count) { this.count = p.count | 0; rebuild = true; }
    if (p.depth != null && p.depth !== this.depth) { this.depth = p.depth; rebuild = true; }
    if (rebuild) this._build();
  }

  resize(size) {
    this.size = size;
    this.camera.aspect = size.width / size.height;
    this.camera.updateProjectionMatrix();
    this.uniforms.uPixel.value = size.height / 600;
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    const fx = this.fx.spawn(event);
    if (fx) this.energy.bump(KIND_ENERGY[fx.kind]);
  }

  update(dt) {
    this.time += dt;
    this.fx.update(dt);
    this.morph += (this.morphTarget - this.morph) * Math.min(1, dt * 2.2); // smooth ease
    // Every form — emblem or brand logo — rotates at the same pace.
    this.points.rotation.y += dt * this.spin;
    this.points.rotation.y %= Math.PI * 2;
    // Pointer smoothing: eased presence + eased position (no popping).
    const p = this.uniforms.uPointer.value;
    this._pEase += ((this._pActive ? 1 : 0) - this._pEase) * Math.min(1, dt * 5);
    p.x += (this._pX - p.x) * Math.min(1, dt * 10);
    p.y += (this._pY - p.y) * Math.min(1, dt * 10);
    p.z = this._pEase;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uMorph.value = this.morph;
    this.uniforms.uEnergy.value = this.energy.update(dt);
    this.uniforms.uFxCount.value = this.fx.write(this.uniforms.uFxPos.value, this.uniforms.uFxColor.value);
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this.renderTarget.texture; }
  destroy() {
    this.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(KeyParticles);
