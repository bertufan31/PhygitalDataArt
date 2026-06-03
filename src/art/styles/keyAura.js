// ---------------------------------------------------------------------------
// Art option: "Key Aura".
//
// The whole frame is a soft SKIN surface (gently undulating), and the emblem is
// the BONES beneath it: its signed-distance field raises a smooth bulge that
// pushes the skin outward with natural curves — no hard silhouette, it blends
// into the surrounding skin. Lit via the height-field normals + subsurface.
//
// Effects deform the skin so the data is felt as touch: ripple = a travelling
// surface wave, blast = a warm swell/flush, disruption = rippled dents. Colour
// comes from the per-art grade (skin tones by default).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { NOISE_GLSL, FX_GLSL } from '../shaderLib.js';
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
  uniform float uTime, uAspect, uEnergy, uKeySize;
  uniform sampler2D uSdf;
  ${NOISE_GLSL}
  ${FX_GLSL}
  float sdfV(vec2 c){
    vec2 uvp = vec2(c.x + 0.5, 0.5 - c.y);
    if (uvp.x < 0.0 || uvp.x > 1.0 || uvp.y < 0.0 || uvp.y > 1.0) return -1.0;
    return texture2D(uSdf, uvp).r * 2.0 - 1.0;
  }
  float emblemBulge(vec2 c){
    float d = sdfV(c / uKeySize);
    return smoothstep(-0.18, 0.5, d);   // soft bulge that blends into the skin
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
        s += sin((dist - age * 0.55) * 42.0) * env * 0.12 * fade;     // ripple wave
      } else if (fx.w < 1.5) {
        s += exp(-dist * dist * 22.0) * fade * 0.28;                  // blast swell
      } else {
        float shell = exp(-pow((dist - age * 0.8) * 9.0, 2.0));
        s += sin(dist * 70.0) * shell * fade * 0.12;                  // disruption dents
      }
    }
    return s;
  }
  // Combined skin height: gentle undulation + emblem bulge + event deformation.
  float H(vec2 c){
    float skin = fbm(c * 1.4 + vec2(0.0, uTime * 0.05)) * 0.45;
    return skin + 1.15 * emblemBulge(c) + fxHeight(c);
  }
  void main(){
    vec2 cuv = (vUv - 0.5); cuv.x *= uAspect;
    float e = 0.004;
    float hC = H(cuv), hX = H(cuv + vec2(e, 0.0)), hY = H(cuv + vec2(0.0, e));
    vec3 n = normalize(vec3((hC - hX) / e, (hC - hY) / e, 1.7));
    float diff = clamp(dot(n, normalize(vec3(0.35, 0.45, 0.9))), 0.0, 1.0);
    float bulge = emblemBulge(cuv);

    float lum = 0.34 + 0.72 * diff + 0.14 * bulge;     // full-frame lit skin
    vec3 col = vec3(lum);
    col += fxColor(cuv) * (0.4 + 0.8 * bulge);          // blast flush, stronger over bones

    col = col / (col + vec3(0.85));
    col = pow(col, vec3(0.95));
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
    const shape = getShape();
    const aspect = this.size.width / this.size.height;

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: 0.5 },
      uKeySize: { value: 0.55 },
      uSdf: { value: shape ? shape.sdfTexture : null },
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
