// ---------------------------------------------------------------------------
// Art option: "Key Aura".
//
// The whole frame is a soft SKIN surface and the emblem is the BONES beneath it:
// the analytic emblem distance raises a smooth bulge that pushes the skin out
// with natural curves (no hard edge). Smooth low-frequency undulation + a
// painterly brush/layering texture, coloured by a 3-stop gradient from the
// per-art Background → Primary → Secondary (so it colours itself; grade off).
//
// Effects are felt on the skin: ripple = travelling wave, blast = warm swell +
// flush, disruption = rippled dents.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { NOISE_GLSL, FX_GLSL, EMBLEM_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';

const FX_MAX = 16;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uAspect, uEnergy, uKeySize;
  uniform vec3 uColorA, uColorB, uColorBg;
  ${NOISE_GLSL}
  ${FX_GLSL}
  ${EMBLEM_GLSL}

  float emblemBulge(vec2 c){
    float d = emblemDist(c / uKeySize);
    return smoothstep(0.06, -0.18, d);          // soft bulge that blends into the skin
  }
  float fxHeight(vec2 c){
    float s = 0.0;
    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      vec4 fx = uFxPos[i];
      vec2 ctr = (fx.xy - 0.5); ctr.x *= uFxAspect;
      float dist = distance(c, ctr);
      float age = fx.z, fade = 1.0 - age;
      if (fx.w < 0.5) {
        float env = exp(-pow((dist - age * 0.55) * 5.0, 2.0));
        s += sin((dist - age * 0.55) * 38.0) * env * 0.10 * fade;
      } else if (fx.w < 1.5) {
        s += exp(-dist * dist * 20.0) * fade * 0.26;
      } else {
        float shell = exp(-pow((dist - age * 0.8) * 9.0, 2.0));
        s += sin(dist * 60.0) * shell * fade * 0.10;
      }
    }
    return s;
  }
  // Smooth skin height: gentle 2-octave undulation + emblem bulge + events.
  float H(vec2 c){
    float skin = (snoise(c * 1.0 + vec2(0.0, uTime * 0.04)) * 0.62
                + snoise(c * 2.1 + vec2(3.0, -uTime * 0.03)) * 0.24) * 0.4;
    return skin + 1.1 * emblemBulge(c) + fxHeight(c);
  }
  // Layered, directional brush texture (painterly).
  float brush(vec2 c){
    float a = snoise(vec2(c.x * 3.0, c.y * 24.0) + uTime * 0.015);
    float b = snoise(vec2(c.x * 20.0 + 7.0, c.y * 4.0) - uTime * 0.01);
    return 0.5 * (a + b);
  }
  vec3 ramp(float t){
    return t < 0.5 ? mix(uColorBg, uColorA, t * 2.0) : mix(uColorA, uColorB, (t - 0.5) * 2.0);
  }
  void main(){
    vec2 cuv = (vUv - 0.5); cuv.x *= uAspect;
    cuv += fxDisplace(cuv) * 0.35;
    float e = 0.004;
    float hC = H(cuv), hX = H(cuv + vec2(e, 0.0)), hY = H(cuv + vec2(0.0, e));
    vec3 n = normalize(vec3((hC - hX) / e, (hC - hY) / e, 1.8));
    float diff = clamp(dot(n, normalize(vec3(0.3, 0.5, 0.9))), 0.0, 1.0);
    float bulge = emblemBulge(cuv);

    float t = clamp(0.32 + 0.6 * diff + 0.22 * bulge, 0.0, 1.0);
    vec3 col = ramp(t);
    col *= 0.92 + 0.13 * brush(cuv);                  // painterly layering
    col += fxColor(cuv) * (0.4 + 0.8 * bulge);         // event flush, stronger on bones

    col = pow(clamp(col, 0.0, 1.0), vec3(0.95));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class KeyAura extends BaseArt {
  static id = 'key-aura';
  static label = 'Key Aura';
  static params = [
    { key: 'keySize', type: 'range', label: 'Key size', min: 0.3, max: 0.95, step: 0.05, default: 0.55 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.energy = new Eased(0.5, { max: 3, decay: 0.5, rise: 1.6 });
    this.fx = new EffectField(FX_MAX);
    const aspect = this.size.width / this.size.height;

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: 0.5 },
      uKeySize: { value: 0.55 },
      uColorA: { value: new THREE.Color('#d98aa0') },
      uColorB: { value: new THREE.Color('#ffe6cf') },
      uColorBg: { value: new THREE.Color('#b88497') },
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
    if (p.keySize != null) this.uniforms.uKeySize.value = p.keySize;
    if (p.colorA != null) this.uniforms.uColorA.value.set(p.colorA);
    if (p.colorB != null) this.uniforms.uColorB.value.set(p.colorB);
    if (p.colorBg != null) this.uniforms.uColorBg.value.set(p.colorBg);
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

registerArt(KeyAura);
