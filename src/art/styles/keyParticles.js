// ---------------------------------------------------------------------------
// Art option: "Key Particles".
//
// A rotating 3D point-cloud in the emblem shape (the gif's particle-sphere
// treatment). Points are sampled inside the emblem and given depth from the SDF
// (a domed lens), so the slowly rotating form reads volumetric; they twinkle at
// idle. Data reactions: ripple = bright ring through the cloud, blast = central
// burst, disruption = particles scatter. Colour comes from the per-art grade.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';
import { getShape, samplePoints, sdfAt } from '../../core/shape.js';

const COUNT = 50000;
const FX_MAX = 8;

const vertexShader = /* glsl */ `
  precision highp float;
  #define FX_MAX ${FX_MAX}
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime, uEnergy, uTwinkle, uPixel;
  uniform vec4 uFxPos[FX_MAX];
  uniform vec3 uFxColor[FX_MAX];
  uniform int uFxCount;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vMix;
  void main(){
    vec3 pos = position;
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
      } else if (fx.w < 1.5) {                             // blast burst
        float w = exp(-dist * dist * 6.0) * fade;
        tintCol += uFxColor[i] * w * 1.4; tintAmt += w * 1.4; bright += w * 1.2; sizeB += w * 4.0;
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
    gl_PointSize = aSize * uPixel * (1.0 + 0.4 * uEnergy + sizeB) * (6.0 / -mv.z);
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
    // Replace toward the event colour (saturated) so it survives the grade.
    vec3 base = mix(vec3(0.82, 0.9, 1.0), vTint / max(vMix, 1e-3), clamp(vMix, 0.0, 1.0));
    gl_FragColor = vec4(base * m * vAlpha, m * vAlpha);
  }
`;

export class KeyParticles extends BaseArt {
  static id = 'key-particles';
  static label = 'Key Particles';
  static params = [
    { key: 'spin', type: 'range', label: 'Spin', min: 0, max: 1.0, step: 0.05, default: 0.3 },
    { key: 'depth', type: 'range', label: 'Depth', min: 0.0, max: 0.8, step: 0.05, default: 0.4 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.spin = 0.3;
    this.energy = new Eased(0.5, { max: 3, decay: 0.6, rise: 1.8 });
    getShape();
    // Spawn effects ON the emblem (it's a thin ring; random points would miss it).
    this._pool = samplePoints(400);
    this.fx = new EffectField(FX_MAX, () => {
      const i = ((Math.random() * 400) | 0) * 2;
      return { x: (this._pool[i] * 0.9 + 1) / 2, y: (this._pool[i + 1] * 0.9 + 1) / 2 };
    });

    this._build(0.4);

    const aspect = this.size.width / this.size.height;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.camera.position.set(0, 0, 3.2);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');
    this.scene.add(this.points);

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  _build(depth) {
    const pts = samplePoints(COUNT); // [x,y] in [-1,1]
    const positions = new Float32Array(COUNT * 3);
    const phase = new Float32Array(COUNT);
    const sizes = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const x = pts[i * 2] * 0.9;
      const y = pts[i * 2 + 1] * 0.9;
      const inside = Math.max(0, sdfAt(pts[i * 2], pts[i * 2 + 1]));
      const z = (Math.random() < 0.5 ? -1 : 1) * inside * depth + (Math.random() - 0.5) * 0.04;
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
    this.geometry = geo;

    this.uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0.5 },
      uTwinkle: { value: 1.6 },
      uPixel: { value: this.size.height / 600 },
      uFxPos: { value: Array.from({ length: FX_MAX }, () => new THREE.Vector4()) },
      uFxColor: { value: Array.from({ length: FX_MAX }, () => new THREE.Color()) },
      uFxCount: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  setParams(p) {
    if (p.spin != null) this.spin = p.spin;
    if (p.depth != null && this.points) {
      // Rebuild depth distribution.
      this.scene.remove(this.points);
      this.geometry.dispose();
      this.material.dispose();
      const fx = this.uniforms.uFxCount; // preserve nothing; rebuild fresh
      this._build(p.depth);
      this.scene.add(this.points);
      void fx;
    }
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
    this.points.rotation.y += dt * this.spin;
    this.uniforms.uTime.value = this.time;
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
