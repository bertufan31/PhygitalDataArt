// ---------------------------------------------------------------------------
// Per-art duotone colour grade.
//
// A fullscreen pass between the art and the display target. It maps the
// artwork's luminance onto a gradient between two chosen colours (primary →
// secondary) and blends that over the original by `amount`, so each art can be
// re-themed to any palette without touching its shader. Both the flat plane and
// the prism wall sample the graded result.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSrc;
  uniform sampler2D uBg;
  uniform float uHasBg;
  uniform vec2 uBgFit;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorBg;
  uniform float uAmount;
  void main(){
    vec3 src = texture2D(uSrc, vUv).rgb;
    float l = dot(src, vec3(0.299, 0.587, 0.114));
    float mx = max(src.r, max(src.g, src.b));
    float mn = min(src.r, min(src.g, src.b));
    float sat = (mx - mn) / (mx + 1e-5);
    // Duotone the artwork's luminance into primary → secondary, but KEEP the
    // artwork's own saturated colours (the event ripple/blast/flavour hues).
    vec3 duo = mix(uColorA, uColorB, smoothstep(0.0, 1.0, l)) * (0.35 + 0.95 * l);
    vec3 themed = mix(duo, src, clamp(sat * 1.7, 0.0, 1.0));
    vec3 art = mix(src, themed, clamp(uAmount, 0.0, 1.0));
    // Composite over the editable background (shows through dark areas):
    // the flat colour, or the brand's CMS background image (cover-fitted)
    // which deliberately BYPASSES the duotone so it keeps its true colours.
    vec3 bg = uColorBg;
    if (uHasBg > 0.5) bg = texture2D(uBg, (vUv - 0.5) * uBgFit + 0.5).rgb;
    float coverage = smoothstep(0.02, 0.35, l);
    gl_FragColor = vec4(mix(bg, art, coverage), 1.0);
  }
`;

export class ColorGrade {
  constructor(size) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.uniforms = {
      uSrc: { value: null },
      uBg: { value: null },
      uHasBg: { value: 0 },
      uBgFit: { value: new THREE.Vector2(1, 1) },
      uColorA: { value: new THREE.Color('#0a0f1e') },
      uColorB: { value: new THREE.Color('#7fbfff') },
      uColorBg: { value: new THREE.Color('#05060a') },
      uAmount: { value: 0.35 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
    this.renderTarget = new THREE.WebGLRenderTarget(size.width, size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  get texture() {
    return this.renderTarget.texture;
  }

  setSource(texture) {
    this.uniforms.uSrc.value = texture;
  }

  setColors({ colorA, colorB, colorBg, colorAmount }) {
    if (colorA != null) this.uniforms.uColorA.value.set(colorA);
    if (colorB != null) this.uniforms.uColorB.value.set(colorB);
    if (colorBg != null) this.uniforms.uColorBg.value.set(colorBg);
    if (colorAmount != null) this.uniforms.uAmount.value = colorAmount;
  }

  // Brand background image behind the artwork (null clears back to the flat
  // colour). Cover-fitted to the render aspect; the caller owns the texture.
  setBackgroundImage(texture, aspect = 1) {
    this.uniforms.uBg.value = texture;
    this.uniforms.uHasBg.value = texture ? 1 : 0;
    this._bgAspect = aspect;
    this._updateBgFit();
  }

  _updateBgFit() {
    const ca = this.renderTarget.width / Math.max(1, this.renderTarget.height);
    const ia = this._bgAspect || 1;
    this.uniforms.uBgFit.value.set(Math.min(1, ca / ia), Math.min(1, ia / ca));
  }

  setSize(size) {
    this.renderTarget.setSize(size.width, size.height);
    this._updateBgFit();
  }

  render(renderer) {
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
  }

  dispose() {
    this.quad.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}
