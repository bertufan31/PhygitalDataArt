// ---------------------------------------------------------------------------
// Art option: "Key Particles".
//
// A rotating 3D point-cloud in the emblem shape, evolved into a motion-forward,
// brand-aware piece. Three layered behaviours (all preserve the original spin):
//   • MOVEMENT  — a bounded curl/wind flow + gentle directional current gives a
//                 premium sense of drift (the `Drift` control).
//   • BRAND MORPH — when a brand with a silhouette is active (ZYN / VEEV), the
//                 particles flow from the emblem into that brand form; IQOS (no
//                 silhouette) holds the emblem. Palette/background follow via the
//                 Stage's brand theming. Morph eases in/out smoothly.
//   • TOUCH     — particles are pulled toward the pointer/finger (the `Pointer`
//                 reach control), so the piece reacts to people.
// Data reactions still tint particles toward the event colour and spawn on the
// active shape.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { NOISE_GLSL } from '../shaderLib.js';
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
  attribute vec3 aTarget;                 // brand-morph destination for this point
  uniform float uTime, uEnergy, uTwinkle, uPixel, uSizeScale, uMorph, uDrift;
  uniform vec4 uPointer;                  // xy = pos (art space), z = active, w = reach
  uniform vec4 uFxPos[FX_MAX];
  uniform vec3 uFxColor[FX_MAX];
  uniform int uFxCount;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vMix;
  ${NOISE_GLSL}
  void main(){
    vec3 pos = mix(position, aTarget, uMorph);       // emblem → brand form

    // MOVEMENT: bounded curl flow + a gentle forward current. Eased down as the
    // shape locks into a brand form so the logo stays legible.
    float drift = uDrift * mix(1.0, 0.32, uMorph);
    vec2 flow = curl(pos.xy * 1.3 + vec2(uTime * 0.18, uTime * 0.05));
    pos.xy += flow * drift * 0.12;
    pos.x  += sin(uTime * 0.4 + pos.y * 2.0) * drift * 0.03;

    // TOUCH: gravitational pull toward the pointer/finger.
    if (uPointer.z > 0.5) {
      vec2 d = uPointer.xy - pos.xy;
      float pull = exp(-dot(d, d) * 3.0);
      pos.xy += normalize(d + 1e-5) * pull * uPointer.w * 0.5;
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
  static params = [
    { key: 'count', type: 'range', label: 'Particles', min: 10000, max: 200000, step: 10000, default: 50000 },
    { key: 'size', type: 'range', label: 'Particle size', min: 0.3, max: 4, step: 0.1, default: 1 },
    { key: 'spin', type: 'range', label: 'Spin', min: 0, max: 1.0, step: 0.05, default: 0.3 },
    { key: 'depth', type: 'range', label: 'Depth', min: 0.0, max: 0.8, step: 0.05, default: 0.4 },
    { key: 'drift', type: 'range', label: 'Drift', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'pointer', type: 'range', label: 'Pointer pull', min: 0, max: 1.5, step: 0.05, default: 0.7 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.spin = 0.3;
    this.count = 50000;
    this.depth = 0.4;
    this.brandId = null; // active morph target (null/iqos = emblem)
    this.morph = 0; // current eased morph amount
    this.morphTarget = 0;
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
      uMorph: { value: 0 },
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
    geo.setAttribute('aTarget', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry = geo;
    this._writeTarget(); // fill aTarget for the current brand (or the emblem)
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  // Fill the morph-destination attribute: a brand silhouette if the active brand
  // has one, otherwise the emblem itself (so morph is a no-op for IQOS).
  _writeTarget() {
    const n = this.count;
    const tgt = this.geometry.attributes.aTarget.array;
    const brandPts = hasBrandSilhouette(this.brandId) ? sampleBrandPoints(this.brandId, n) : null;
    const pos = this.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      if (brandPts) {
        tgt[i * 3] = brandPts[i * 2] * SHAPE_SCALE;
        tgt[i * 3 + 1] = brandPts[i * 2 + 1] * SHAPE_SCALE;
        tgt[i * 3 + 2] = (Math.random() - 0.5) * 0.05; // logos read flat
      } else {
        tgt[i * 3] = pos[i * 3];
        tgt[i * 3 + 1] = pos[i * 3 + 1];
        tgt[i * 3 + 2] = pos[i * 3 + 2];
      }
    }
    this.geometry.attributes.aTarget.needsUpdate = true;
  }

  /** Brand morphing: switch the morph target + ease the amount in/out. */
  setBrand(brandId) {
    if (brandId === this.brandId) return;
    this.brandId = brandId;
    if (this.geometry) this._writeTarget();
    this.morphTarget = hasBrandSilhouette(brandId) ? 1 : 0;
  }

  /** Touch / pointer: position in normalized device coords (-1..1); active toggles it. */
  setPointer(x, y, active) {
    // Map NDC to the art's world plane at z=0 (camera at z=3.2, fov 45°).
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z;
    const halfW = halfH * this.camera.aspect;
    const p = this.uniforms.uPointer.value;
    p.x = x * halfW;
    p.y = y * halfH;
    p.z = active ? 1 : 0;
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
    // Spin while it's the emblem; freeze + settle facing front once it locks
    // into a brand form, so the logo reads cleanly.
    this.points.rotation.y += dt * this.spin * (1 - this.morph);
    this.points.rotation.y %= Math.PI * 2;
    if (this.morph > 0.01) {
      this.points.rotation.y = THREE.MathUtils.lerp(this.points.rotation.y, 0, Math.min(1, dt * 2.5 * this.morph));
    }
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
