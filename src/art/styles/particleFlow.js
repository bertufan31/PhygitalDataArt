// ---------------------------------------------------------------------------
// Art option: "Particle Flow".
//
// ~120k particles streaming a curl-noise flow field — the Anadol point-cloud
// look. Motion is stateless on the GPU: each particle integrates a few curl
// steps from its seed; the looping phase makes them stream and respawn.
//
// The three distinct data reactions (art/effects.js) live in the vertex shader:
//   visitor  → RIPPLE     : an expanding bright ring travels through the cloud
//   sale/flav→ BLAST      : a central colour burst (brighter, larger points)
//   product  → DISRUPTION : a shock ring SCATTERS particles (a glitch in flow)
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';

const COUNT = 120000;
const FX_MAX = 8;
const BASE_ENERGY = 0.5;

const vertexShader = /* glsl */ `
  precision highp float;
  #define FX_MAX ${FX_MAX}
  attribute vec2 aMeta;            // x = speed, y = colour parameter
  uniform float uTime, uAspect, uEnergy, uPaletteShift, uTintAmount, uSizeScale;
  uniform vec3  uTint;
  uniform vec4  uFxPos[FX_MAX];    // xy(0..1), z = ageNorm, w = kind
  uniform vec3  uFxColor[FX_MAX];
  uniform int   uFxCount;
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

    vec2 pos = position.xy;
    float stride = 0.40 * phase;
    for (int i = 0; i < 6; i++) {
      vec2 fv = curl(vec2(pos.x * uAspect, pos.y) * 1.4 + 13.0);
      pos += normalize(fv + 1e-5) * (stride / 6.0);
    }

    vec3 baseCol = palette(aMeta.y + uPaletteShift);
    vec3 fxCol = vec3(0.0);
    float bright = 0.0;
    float sizeBoost = 0.0;

    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      vec4 fx = uFxPos[i];
      vec2 c = fx.xy * 2.0 - 1.0;
      float dist = distance(pos, c);
      float age = fx.z;
      float fade = 1.0 - age;
      if (fx.w < 0.5) {
        // RIPPLE: expanding bright ring.
        float ring = exp(-pow((dist - age * 1.3) * 4.0, 2.0));
        fxCol += uFxColor[i] * ring * fade;
        bright += ring * fade * 0.8;
        sizeBoost += ring * fade * 2.0;
      } else if (fx.w < 1.5) {
        // BLAST: central colour burst.
        float core = exp(-dist * dist * 7.0);
        fxCol += uFxColor[i] * core * fade * 1.6;
        bright += core * fade * 1.2;
        sizeBoost += core * fade * 5.0;
      } else {
        // DISRUPTION: shock ring scatters particles.
        float shell = exp(-pow((dist - age * 1.4) * 5.0, 2.0));
        vec2 jdir = normalize(vec2(sin(position.x * 54.0 + position.y * 13.0),
                                   cos(position.y * 51.0 - position.x * 7.0)) + 1e-5);
        pos += jdir * shell * fade * 0.07;
        fxCol += uFxColor[i] * shell * fade * 0.7;
        sizeBoost += shell * fade * 2.5;
      }
    }

    vColor = mix(baseCol, uTint, uTintAmount * 0.5);
    vColor *= (0.45 + 0.30 * uEnergy);   // gentle, eased global response
    vColor += fxCol;                      // local effect colour (the visible reaction)
    vColor *= (1.0 + bright);

    vAlpha = smoothstep(0.0, 0.1, phase) * smoothstep(1.0, 0.82, phase);
    gl_Position = vec4(pos, 0.0, 1.0);
    gl_PointSize = (1.3 + 1.8 * uEnergy + sizeBoost) * uSizeScale;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.25, 0.0, dot(c, c)) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class ParticleFlow extends BaseArt {
  static id = 'particle-flow';
  static label = 'Particle Flow';
  static params = [
    { key: 'count', type: 'range', label: 'Particles', min: 20000, max: 300000, step: 20000, default: 120000 },
    { key: 'size', type: 'range', label: 'Particle size', min: 0.3, max: 4, step: 0.1, default: 1 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.paletteShift = 0;
    this.tint = new THREE.Color('#ffffff');
    this.energy = new Eased(BASE_ENERGY, { max: 3, decay: 0.6, rise: 1.8 });
    this.tintAmount = new Eased(0, { max: 0.8, decay: 0.35, rise: 2.2 });
    this.fx = new EffectField(FX_MAX);

    this.count = COUNT;
    const aspect = this.size.width / this.size.height;
    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: BASE_ENERGY },
      uPaletteShift: { value: 0 },
      uTint: { value: this.tint.clone() },
      uTintAmount: { value: 0 },
      uSizeScale: { value: 1 },
      uFxPos: { value: Array.from({ length: FX_MAX }, () => new THREE.Vector4()) },
      uFxColor: { value: Array.from({ length: FX_MAX }, () => new THREE.Color()) },
      uFxCount: { value: 0 },
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

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');
    this.camera = new THREE.Camera();
    this._buildGeometry();

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  _buildGeometry() {
    if (this.points) {
      this.scene.remove(this.points);
      this.geometry.dispose();
    }
    const n = this.count;
    const positions = new Float32Array(n * 3);
    const meta = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const sx = (Math.random() * 2 - 1) * 1.1;
      const sy = (Math.random() * 2 - 1) * 1.1;
      positions[i * 3 + 0] = sx;
      positions[i * 3 + 1] = sy;
      positions[i * 3 + 2] = Math.random();
      meta[i * 2 + 0] = 0.5 + Math.random();
      meta[i * 2 + 1] = 0.5 + 0.25 * Math.sin(sx * 2.0) + 0.22 * Math.cos(sy * 1.7) + (Math.random() - 0.5) * 0.06;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aMeta', new THREE.BufferAttribute(meta, 2));
    this.geometry = geo;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  setParams(p) {
    if (p.size != null) this.uniforms.uSizeScale.value = p.size;
    if (p.count != null && (p.count | 0) !== this.count) {
      this.count = p.count | 0;
      this._buildGeometry();
    }
  }

  resize(size) {
    this.size = size;
    this.uniforms.uAspect.value = size.width / size.height;
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    const fx = this.fx.spawn(event);
    if (fx) this.energy.bump(KIND_ENERGY[fx.kind]);
    if (event.type === EventTypes.FLAVOUR_SOLD) {
      this.tint.set(event.data?.color || '#ffffff');
      this.tintAmount.set(0.8);
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
    this.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(ParticleFlow);
