// ---------------------------------------------------------------------------
// Art option: "Key Aura".
//
// The emblem rendered as a soft, volumetric, skin-like form using its
// signed-distance field: the shape bulges toward its centreline, is shaded with
// SDF-derived normals + a subsurface glow, and breathes/flows gently at idle.
// Data reactions ripple the skin (ripple/disruption warp the SDF sampling) and
// bloom warm light into it (blast). Colour comes from the per-art grade.
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
  uniform float uTime, uAspect, uEnergy;
  uniform sampler2D uSdf;
  ${NOISE_GLSL}
  ${FX_GLSL}
  float sdfV(vec2 c){
    vec2 uvp = vec2(c.x + 0.5, 0.5 - c.y);
    if (uvp.x < 0.0 || uvp.x > 1.0 || uvp.y < 0.0 || uvp.y > 1.0) return -1.0; // outside the shape box
    return texture2D(uSdf, uvp).r * 2.0 - 1.0;
  }
  void main(){
    vec2 cuv = (vUv - 0.5); cuv.x *= uAspect;
    cuv *= 1.0 + 0.02 * sin(uTime * 0.6);          // gentle breathing (idle)
    cuv += fxDisplace(cuv);                          // disruption/ripple warp the skin

    float d = sdfV(cuv);
    float e = 0.005;
    vec2 grad = vec2(sdfV(cuv + vec2(e, 0.0)) - sdfV(cuv - vec2(e, 0.0)),
                     sdfV(cuv + vec2(0.0, e)) - sdfV(cuv - vec2(0.0, e)));
    float presence = smoothstep(-0.03, 0.05, d);
    float thickness = smoothstep(0.0, 0.55, d);
    vec3 n = normalize(vec3(-grad * 7.0, 0.55));
    float diff = 0.3 + 0.7 * max(dot(n, normalize(vec3(0.3, 0.45, 0.8))), 0.0);

    float flow = fbm(vUv * 3.0 + vec2(0.0, uTime * 0.08));
    float subsurface = thickness * (0.35 + 0.4 * flow);
    float lum = presence * (diff * (0.55 + 0.45 * thickness) + subsurface * 0.6);

    vec3 skin = vec3(lum);
    skin += fxColor(cuv) * presence;                 // blast/ripple glow inside the skin

    vec3 bg = vec3(0.02 + 0.05 * vUv.y);             // faint dreamy ground
    vec3 col = mix(bg, skin, presence);
    col = col / (col + vec3(0.7));
    col = pow(col, vec3(0.92));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class KeyAura extends BaseArt {
  static id = 'key-aura';
  static label = 'Key Aura';

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
