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
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uAmount;
  void main(){
    vec3 src = texture2D(uSrc, vUv).rgb;
    float l = dot(src, vec3(0.299, 0.587, 0.114));
    // Duotone keeps the artwork's luminance structure, takes its hue from the
    // two chosen colours, then blends over the original by amount.
    vec3 duo = mix(uColorA, uColorB, smoothstep(0.0, 1.0, l)) * (0.35 + 0.95 * l);
    gl_FragColor = vec4(mix(src, duo, clamp(uAmount, 0.0, 1.0)), 1.0);
  }
`;

export class ColorGrade {
  constructor(size) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.uniforms = {
      uSrc: { value: null },
      uColorA: { value: new THREE.Color('#0a0f1e') },
      uColorB: { value: new THREE.Color('#7fbfff') },
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

  setColors({ colorA, colorB, colorAmount }) {
    if (colorA != null) this.uniforms.uColorA.value.set(colorA);
    if (colorB != null) this.uniforms.uColorB.value.set(colorB);
    if (colorAmount != null) this.uniforms.uAmount.value = colorAmount;
  }

  setSize(size) {
    this.renderTarget.setSize(size.width, size.height);
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
