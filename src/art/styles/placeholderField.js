// ---------------------------------------------------------------------------
// Art option: "Placeholder Field".
//
// A flowing, Anadol-lite colour field rendered by a fullscreen fragment shader,
// purely to PROVE THE PIPELINE end to end (data ▸ art ▸ target ▸ view). It is
// intentionally simple — polished pieces come later (see TODO.md).
//
// How it reacts to the four store signals:
//   • visitor entered → a small cool ripple seeds somewhere in the field
//   • sale made       → a big bright warm bloom + the palette warms briefly
//   • product sold    → a medium violet pulse
//   • flavour sold     → a pulse in the flavour's own colour + that colour bleeds
//                        into the base palette (so e.g. "TEREA Yellow" tints it)
//
// Each reaction spawns a "pulse" passed to the shader as uniform arrays. The
// base field is layered simplex noise scrolling over time between two palette
// colours that slowly relax back to rest.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';

const MAX_PULSES = 24;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // fullscreen clip-space quad
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  #define MAX_PULSES ${MAX_PULSES}

  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform vec3  uPulsePos[MAX_PULSES];   // xy = position (0..1), z = strength (0..1)
  uniform vec3  uPulseColor[MAX_PULSES]; // pre-multiplied by intensity
  uniform int   uPulseCount;

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

  void main() {
    vec2 uv = vUv;
    vec2 p = uv; p.x *= uAspect; // aspect-correct for round pulses

    // Flowing base field: layered noise drifting over time.
    vec2 q = uv * 3.0;
    float n = 0.0;
    n += 0.60 * snoise(q + vec2(uTime * 0.05, uTime * 0.03));
    n += 0.30 * snoise(q * 2.0 - vec2(uTime * 0.04, 0.0));
    n += 0.10 * snoise(q * 4.0 + vec2(0.0, uTime * 0.06));
    n = n * 0.5 + 0.5;

    vec3 col = mix(uColorB, uColorA, smoothstep(0.2, 0.8, n));
    col += 0.04 * vec3(sin(uv.y * 3.14159 + uTime * 0.2)); // subtle vertical sheen

    // Additive event pulses: a soft core + an expanding ring (ripple).
    for (int i = 0; i < MAX_PULSES; i++) {
      if (i >= uPulseCount) break;
      vec3 pulse = uPulsePos[i];
      float strength = pulse.z;
      vec2 pp = pulse.xy; pp.x *= uAspect;
      float d = distance(p, pp);
      float core = exp(-d * d * 40.0) * strength;
      float ring = exp(-pow((d - (1.0 - strength) * 0.4) * 12.0, 2.0)) * strength * 0.6;
      col += uPulseColor[i] * (core + ring);
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export class PlaceholderField extends BaseArt {
  static id = 'placeholder-field';
  static label = 'Placeholder Field';

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.pulses = []; // { x, y, age, life, intensity, color: THREE.Color }

    // Resting palette; live uniforms drift back toward these each frame.
    this.baseA = new THREE.Color('#2a3a63');
    this.baseB = new THREE.Color('#070710');

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: this.size.width / this.size.height },
      uColorA: { value: this.baseA.clone() },
      uColorB: { value: this.baseB.clone() },
      uPulsePos: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector3()) },
      uPulseColor: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Color()) },
      uPulseCount: { value: 0 },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera(); // clip-space quad needs no real projection
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, // linear, no mipmaps → safe vertex-texture-fetch for the prism target
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

  _spawn(pulse) {
    pulse.age = 0;
    this.pulses.push(pulse);
    if (this.pulses.length > MAX_PULSES) this.pulses.shift();
  }

  onEvent(event) {
    const x = Math.random();
    const y = Math.random();
    switch (event.type) {
      case EventTypes.VISITOR_ENTERED:
        this._spawn({ x, y, life: 2.5, intensity: 0.8, color: new THREE.Color('#5fd0ff') });
        break;
      case EventTypes.SALE_MADE:
        this._spawn({ x, y, life: 4.0, intensity: 1.6, color: new THREE.Color('#ffd86b') });
        this.uniforms.uColorA.value.lerp(new THREE.Color('#4a5d8f'), 0.5); // palette warms
        break;
      case EventTypes.PRODUCT_SOLD:
        this._spawn({ x, y, life: 3.0, intensity: 1.0, color: new THREE.Color('#9b7bff') });
        break;
      case EventTypes.FLAVOUR_SOLD: {
        const c = new THREE.Color(event.data?.color || '#ffffff');
        this._spawn({ x, y, life: 3.5, intensity: 1.3, color: c });
        this.uniforms.uColorB.value.lerp(c, 0.25); // flavour colour bleeds into the field
        break;
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;

    // Age pulses and drop dead ones.
    for (const p of this.pulses) p.age += dt;
    this.pulses = this.pulses.filter((p) => p.age < p.life);

    // Palette relaxes back to rest.
    this.uniforms.uColorA.value.lerp(this.baseA, dt * 0.2);
    this.uniforms.uColorB.value.lerp(this.baseB, dt * 0.2);

    // Push active pulses into the uniform arrays.
    const n = Math.min(this.pulses.length, MAX_PULSES);
    for (let i = 0; i < n; i++) {
      const p = this.pulses[i];
      const strength = 1 - p.age / p.life;
      this.uniforms.uPulsePos.value[i].set(p.x, p.y, strength);
      this.uniforms.uPulseColor.value[i].copy(p.color).multiplyScalar(p.intensity);
    }
    this.uniforms.uPulseCount.value = n;

    // Render the field into our own target.
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

registerArt(PlaceholderField);
