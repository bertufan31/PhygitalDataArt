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
import { FX_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';
import { getShape } from '../../core/shape.js';

const FX_MAX = 16;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uAspect, uEnergy, uSize, uRotation, uPadding, uDistance;
  uniform sampler2D uMask;
  ${FX_GLSL}
  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  void main(){
    vec2 cuv = (vUv - 0.5); cuv.x *= uAspect;
    vec2 p = cuv / uDistance;
    vec2 cell = floor(p);
    vec2 local = fract(p) - 0.5;
    float ca = cos(uRotation), sa = sin(uRotation);
    vec2 rl = mat2(ca, -sa, sa, ca) * local;
    float scale = max(0.05, uSize * (1.0 - uPadding));
    vec2 s = rl / scale;
    float inside = 0.0;
    if (abs(s.x) < 0.5 && abs(s.y) < 0.5) {
      inside = texture2D(uMask, vec2(0.5 + s.x, 0.5 - s.y)).a;
    }
    float shimmer = 0.6 + 0.4 * sin(uTime * 0.8 + hash(cell) * 6.2831);
    vec3 col = vec3(1.0) * inside * shimmer * (0.7 + 0.4 * uEnergy);
    col += fxColor(cuv) * inside;
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
    const shape = getShape();
    const aspect = this.size.width / this.size.height;

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: 0.5 },
      uSize: { value: 0.7 },
      uRotation: { value: 0 },
      uPadding: { value: 0.1 },
      uDistance: { value: 0.3 },
      uMask: { value: shape ? shape.maskTexture : null },
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
