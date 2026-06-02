// ---------------------------------------------------------------------------
// Art option: "Particle Flow".
//
// A point-cloud of ~120k particles streaming along a curl-noise flow field —
// the other signature Anadol look ("machine hallucination" point clouds). The
// motion is computed entirely on the GPU and is STATELESS: each particle has a
// fixed seed + phase, and the vertex shader integrates a few curl steps to find
// its current position. The phase loops, so particles continuously stream and
// respawn, fading in/out so the loop is invisible. No ping-pong buffers needed.
//
// Events spawn "bursts" that locally brighten, enlarge and recolour nearby
// particles; a flavour additionally tints the whole cloud. Energy raises the
// flow speed, brightness and point size.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';

const COUNT = 120000;
const BURSTS = 8;
const BASE_ENERGY = 0.5;

const vertexShader = /* glsl */ `
  precision highp float;
  #define BURSTS ${BURSTS}
  attribute vec2 aMeta;            // x = speed, y = colour parameter
  uniform float uTime, uAspect, uEnergy, uPaletteShift, uTintAmount;
  uniform vec3  uTint;
  uniform vec3  uBurstPos[BURSTS]; // xy in 0..1, z = strength
  uniform vec3  uBurstColor[BURSTS];
  uniform int   uBurstCount;
  varying vec3  vColor;
  varying float vAlpha;

  ${NOISE_GLSL}

  vec3 palette(float t){
    vec3 a = vec3(0.5, 0.5, 0.55);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.50, 0.32, 0.12);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main(){
    float speed = aMeta.x;
    float phase = fract(position.z + uTime * speed * (0.3 + 0.6 * uEnergy) * 0.05);

    // Integrate a few curl steps from the seed; distance scales with phase.
    vec2 pos = position.xy;
    float stride = 0.40 * phase;
    for (int i = 0; i < 6; i++) {
      vec2 fv = curl(vec2(pos.x * uAspect, pos.y) * 1.4 + 13.0);
      pos += normalize(fv + 1e-5) * (stride / 6.0);
    }

    vColor = palette(aMeta.y + uPaletteShift);

    float boost = 0.0;
    for (int i = 0; i < BURSTS; i++) {
      if (i >= uBurstCount) break;
      vec3 b = uBurstPos[i];
      vec2 bp = b.xy * 2.0 - 1.0;
      float d = distance(pos, bp);
      float infl = exp(-d * d * 8.0) * b.z;
      vColor = mix(vColor, uBurstColor[i], clamp(infl, 0.0, 1.0) * 0.85);
      boost += infl;
    }
    vColor = mix(vColor, uTint, uTintAmount * 0.5);
    // Lower per-particle brightness so dense flow ridges saturate to colour
    // rather than blowing out to white under additive blending.
    vColor *= (0.30 + 0.5 * uEnergy) * (1.0 + boost * 1.6);

    // Fade in/out across the loop so respawns are invisible.
    vAlpha = smoothstep(0.0, 0.1, phase) * smoothstep(1.0, 0.82, phase);

    gl_Position = vec4(pos, 0.0, 1.0);
    gl_PointSize = 1.3 + 1.8 * uEnergy + boost * 5.0;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.25, 0.0, dot(c, c)) * vAlpha;
    gl_FragColor = vec4(vColor * a, a); // additive-friendly premultiply
  }
`;

export class ParticleFlow extends BaseArt {
  static id = 'particle-flow';
  static label = 'Particle Flow';

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.energy = BASE_ENERGY;
    this.paletteShift = 0;
    this.tint = new THREE.Color('#ffffff');
    this.tintAmount = 0;
    this.bursts = [];

    const positions = new Float32Array(COUNT * 3);
    const meta = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const sx = (Math.random() * 2 - 1) * 1.1;
      const sy = (Math.random() * 2 - 1) * 1.1;
      positions[i * 3 + 0] = sx;
      positions[i * 3 + 1] = sy;
      positions[i * 3 + 2] = Math.random(); // phase offset
      meta[i * 2 + 0] = 0.5 + Math.random(); // speed
      // Colour varies smoothly with seed POSITION so neighbours share a hue →
      // coherent flowing colour regions instead of random per-particle speckle.
      meta[i * 2 + 1] = 0.5 + 0.25 * Math.sin(sx * 2.0) + 0.22 * Math.cos(sy * 1.7) + (Math.random() - 0.5) * 0.06;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aMeta', new THREE.BufferAttribute(meta, 2));
    this.geometry = geo;

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: this.size.width / this.size.height },
      uEnergy: { value: this.energy },
      uPaletteShift: { value: 0 },
      uTint: { value: this.tint.clone() },
      uTintAmount: { value: 0 },
      uBurstPos: { value: Array.from({ length: BURSTS }, () => new THREE.Vector3()) },
      uBurstColor: { value: Array.from({ length: BURSTS }, () => new THREE.Color()) },
      uBurstCount: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000'); // RT clears to opaque black
    this.camera = new THREE.Camera();
    this.scene.add(this.points);

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

  _burst(p) {
    p.age = 0;
    this.bursts.push(p);
    if (this.bursts.length > BURSTS) this.bursts.shift();
  }

  onEvent(event) {
    const x = Math.random();
    const y = Math.random();
    switch (event.type) {
      case EventTypes.VISITOR_ENTERED:
        this._burst({ x, y, life: 2.4, strength: 0.7, color: new THREE.Color('#7fe0ff') });
        this.energy += 0.12;
        break;
      case EventTypes.SALE_MADE:
        this._burst({ x, y, life: 3.6, strength: 1.0, color: new THREE.Color('#fff0bf') });
        this.energy += 0.5;
        break;
      case EventTypes.PRODUCT_SOLD:
        this._burst({ x, y, life: 3.0, strength: 0.85, color: new THREE.Color('#c79bff') });
        this.energy += 0.25;
        this.paletteShift += 0.06;
        break;
      case EventTypes.FLAVOUR_SOLD: {
        const c = new THREE.Color(event.data?.color || '#ffffff');
        this._burst({ x, y, life: 3.2, strength: 0.95, color: c });
        this.tint.copy(c);
        this.tintAmount = Math.min(0.8, this.tintAmount + 0.5);
        this.energy += 0.35;
        break;
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.energy += (BASE_ENERGY - this.energy) * Math.min(1, dt * 0.6);
    this.tintAmount += (0 - this.tintAmount) * Math.min(1, dt * 0.35);
    this.paletteShift += dt * 0.01;

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = this.energy;
    this.uniforms.uPaletteShift.value = this.paletteShift;
    this.uniforms.uTint.value.copy(this.tint);
    this.uniforms.uTintAmount.value = this.tintAmount;

    for (const b of this.bursts) b.age += dt;
    this.bursts = this.bursts.filter((b) => b.age < b.life);
    const n = Math.min(this.bursts.length, BURSTS);
    for (let i = 0; i < n; i++) {
      const b = this.bursts[i];
      const strength = (1 - b.age / b.life) * b.strength;
      this.uniforms.uBurstPos.value[i].set(b.x, b.y, strength);
      this.uniforms.uBurstColor.value[i].copy(b.color);
    }
    this.uniforms.uBurstCount.value = n;

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

registerArt(ParticleFlow);
