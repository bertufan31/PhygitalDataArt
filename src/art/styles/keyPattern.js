// ---------------------------------------------------------------------------
// Art option: "Key Pattern".
//
// The emblem tiled across the frame, with live controls for Size, Rotation,
// Padding and Distance (style settings). Idle = a gentle per-tile shimmer. Data
// reactions add the ripple/blast/disruption colour over the tiles.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { FX_GLSL, EMBLEM_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';

const FX_MAX = 16;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uAspect, uEnergy, uSize, uRotation, uPadding, uDistance;
  ${FX_GLSL}
  ${EMBLEM_GLSL}
  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  void main(){
    vec2 cuv = (vUv - 0.5); cuv.x *= uAspect;
    vec2 p = cuv / uDistance;
    vec2 cell = floor(p);
    vec2 local = fract(p) - 0.5;
    vec2 cellCenter = (cell + 0.5) * uDistance;

    // Per-TILE reactions: tiles near an event grow, brighten, recolour, spin.
    float extraScale = 0.0, bright = 0.0, extraRot = 0.0, tAmt = 0.0;
    vec3 tcol = vec3(0.0);
    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      vec4 fx = uFxPos[i];
      vec2 ctr = (fx.xy - 0.5); ctr.x *= uFxAspect;
      float dist = distance(cellCenter, ctr);
      float age = fx.z, fade = 1.0 - age;
      if (fx.w < 0.5) {                                   // ripple: a ring of growth sweeps out
        float ring = exp(-pow((dist - age * 0.7) * 5.0, 2.0));
        extraScale += ring * fade * 0.4; bright += ring * fade * 0.9;
        tcol += uFxColor[i] * ring * fade; tAmt += ring * fade;
      } else if (fx.w < 1.5) {                            // blast: tiles bloom big in its colour
        float core = exp(-dist * dist * 10.0);
        extraScale += core * fade * 0.7; bright += core * fade * 1.5;
        tcol += uFxColor[i] * core * fade; tAmt += core * fade;
      } else {                                            // disruption: tiles spin + flicker
        float shell = exp(-pow((dist - age * 0.8) * 6.0, 2.0));
        extraRot += shell * fade * 2.2; bright += shell * fade * 0.6;
        tcol += uFxColor[i] * shell * fade; tAmt += shell * fade;
      }
    }
    tAmt = clamp(tAmt, 0.0, 1.0);

    float ca = cos(uRotation + extraRot), sa = sin(uRotation + extraRot);
    vec2 rl = mat2(ca, -sa, sa, ca) * local;
    float scale = max(0.05, uSize * (1.0 - uPadding) * (1.0 + extraScale));
    vec2 s = rl / scale;
    float inside = emblemMask(s); // analytic emblem (crisp at any resolution)

    float shimmer = 0.6 + 0.4 * sin(uTime * 0.8 + hash(cell) * 6.2831);
    vec3 base = vec3(shimmer * (0.7 + 0.4 * uEnergy) + bright);
    base = mix(base, tcol * 2.2, tAmt * 0.85);          // tile takes on the event colour
    vec3 col = base * inside;
    col = col / (col + vec3(0.6));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class KeyPattern extends BaseArt {
  static id = 'key-pattern';
  static label = 'Key Pattern';
  static params = [
    { key: 'size', type: 'range', label: 'Size', min: 0.2, max: 1.0, step: 0.05, default: 0.7 },
    { key: 'rotation', type: 'range', label: 'Rotation', min: 0, max: 360, step: 5, default: 0 },
    { key: 'padding', type: 'range', label: 'Padding', min: 0, max: 0.6, step: 0.05, default: 0.1 },
    { key: 'distance', type: 'range', label: 'Distance', min: 0.14, max: 0.8, step: 0.02, default: 0.3 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.energy = new Eased(0.5, { max: 3, decay: 0.6, rise: 1.8 });
    this.fx = new EffectField(FX_MAX);
    const aspect = this.size.width / this.size.height;

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: 0.5 },
      uSize: { value: 0.7 },
      uRotation: { value: 0 },
      uPadding: { value: 0.1 },
      uDistance: { value: 0.3 },
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

  setParams(p) {
    if (p.size != null) this.uniforms.uSize.value = p.size;
    if (p.rotation != null) this.uniforms.uRotation.value = (p.rotation * Math.PI) / 180;
    if (p.padding != null) this.uniforms.uPadding.value = p.padding;
    if (p.distance != null) this.uniforms.uDistance.value = p.distance;
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
  }

  update(dt) {
    this.time += dt;
    this.fx.update(dt);
    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = this.energy.update(dt);
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

registerArt(KeyPattern);
