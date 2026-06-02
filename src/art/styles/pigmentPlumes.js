// ---------------------------------------------------------------------------
// Art option: "Pigment Plumes".
//
// Minimal and elegant: big soft colour clouds over near-black, with a few slow
// AMBIENT plumes so it's never empty. Implements the three distinct reactions
// (art/effects.js) in its own soft language:
//   visitor  → RIPPLE     : an expanding ring-shaped plume
//   sale/flav→ BLAST      : a soft filled colour bloom
//   product  → DISRUPTION : a jagged, noise-broken plume
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { effectForEvent, EffectKinds } from '../effects.js';

const MAX_PLUMES = 12;
const AMBIENT = 3;
const AMBIENT_COLORS = ['#1d2f5c', '#1f5c57', '#3a1f5c'];
const KIND_MAX_R = [0.46, 0.5, 0.3]; // ripple, blast, disruption

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  #define MAX_PLUMES ${MAX_PLUMES}
  varying vec2 vUv;
  uniform float uTime, uAspect;
  uniform vec4  uPlumePos[MAX_PLUMES];   // xy = centre, z = alpha, w = radius
  uniform vec3  uPlumeColor[MAX_PLUMES];
  uniform float uPlumeKind[MAX_PLUMES];  // 0 ripple, 1 blast, 2 disruption
  uniform int   uPlumeCount;

  ${NOISE_GLSL}

  void main(){
    vec2 uv = vUv;
    vec2 w = vec2(fbm(uv * 2.0 + uTime * 0.03), fbm(uv * 2.0 + 7.0 - uTime * 0.03));
    vec2 puv = uv + 0.06 * w;

    vec3 col = vec3(0.008, 0.010, 0.018);
    for (int i = 0; i < MAX_PLUMES; i++) {
      if (i >= uPlumeCount) break;
      vec4 pl = uPlumePos[i];
      float kind = uPlumeKind[i];
      vec2 dd = (puv - pl.xy); dd.x *= uAspect;
      float d = length(dd);
      float g;
      if (kind < 0.5) {
        g = exp(-pow((d - pl.w) / 0.06, 2.0));            // ripple: ring
      } else if (kind < 1.5) {
        g = exp(-(d * d) / (pl.w * pl.w));                // blast: soft bloom
      } else {
        float base = exp(-(d * d) / (pl.w * pl.w));        // disruption: jagged
        float n = 0.5 + 0.5 * snoise(puv * 16.0 + uTime * 0.5);
        g = pow(base * n, 1.4);
      }
      col += uPlumeColor[i] * g * pl.z;
    }

    col = col / (col + vec3(0.7));
    col = pow(col, vec3(0.95));
    float vig = smoothstep(1.4, 0.35, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= 0.6 + 0.4 * vig;
    float gr = fract(sin(dot(uv * vec2(uTime + 1.0, uTime + 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    col += (gr - 0.5) * 0.015;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export class PigmentPlumes extends BaseArt {
  static id = 'pigment-plumes';
  static label = 'Pigment Plumes';

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.plumes = [];
    for (let i = 0; i < AMBIENT; i++) this._spawnAmbient();

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: this.size.width / this.size.height },
      uPlumePos: { value: Array.from({ length: MAX_PLUMES }, () => new THREE.Vector4()) },
      uPlumeColor: { value: Array.from({ length: MAX_PLUMES }, () => new THREE.Color()) },
      uPlumeKind: { value: new Float32Array(MAX_PLUMES) },
      uPlumeCount: { value: 0 },
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

  _spawnAmbient() {
    this.plumes.push({
      x: Math.random(),
      y: Math.random(),
      color: new THREE.Color(AMBIENT_COLORS[(Math.random() * AMBIENT_COLORS.length) | 0]),
      age: 0,
      life: 9 + Math.random() * 6,
      maxR: 0.35 + Math.random() * 0.2,
      kind: EffectKinds.BLAST,
      ambient: true,
    });
  }

  onEvent(event) {
    const e = effectForEvent(event);
    if (!e) return;
    this.plumes.push({
      x: Math.random(),
      y: Math.random(),
      color: new THREE.Color(e.color),
      age: 0,
      life: e.life * 2.2, // plumes linger longer than the shared default
      maxR: KIND_MAX_R[e.kind],
      kind: e.kind,
      ambient: false,
    });
    if (this.plumes.length > MAX_PLUMES) {
      const idx = this.plumes.findIndex((q) => !q.ambient);
      this.plumes.splice(idx >= 0 ? idx : 0, 1);
    }
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;

    for (const p of this.plumes) p.age += dt;
    const alive = [];
    let ambientAlive = 0;
    for (const p of this.plumes) {
      if (p.age < p.life) {
        alive.push(p);
        if (p.ambient) ambientAlive++;
      }
    }
    this.plumes = alive;
    while (ambientAlive < AMBIENT) {
      this._spawnAmbient();
      ambientAlive++;
    }

    const n = Math.min(this.plumes.length, MAX_PLUMES);
    for (let i = 0; i < n; i++) {
      const p = this.plumes[i];
      const k = p.age / p.life;
      const alpha = smoothstep(0, 0.2, k) * smoothstep(1, 0.6, k) * (p.ambient ? 0.7 : 1.0);
      let radius;
      if (p.kind === EffectKinds.RIPPLE) radius = p.maxR * smoothstep(0, 1, k); // expands outward
      else if (p.kind === EffectKinds.DISRUPTION) radius = p.maxR * (0.5 + 0.5 * k);
      else radius = 0.05 + (p.maxR - 0.05) * Math.min(1, k * 1.6); // blast / ambient
      this.uniforms.uPlumePos.value[i].set(p.x, p.y, alpha, radius);
      this.uniforms.uPlumeColor.value[i].copy(p.color);
      this.uniforms.uPlumeKind.value[i] = p.kind;
    }
    this.uniforms.uPlumeCount.value = n;

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

// Local smoothstep (JS) mirroring GLSL semantics for the alpha/radius ramps.
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

registerArt(PigmentPlumes);
