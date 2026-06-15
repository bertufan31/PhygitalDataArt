// ---------------------------------------------------------------------------
// Display target: physical LED-prism wall (3D preview).
//
// A grid of rectangular prisms that rise/fall toward the viewer like a physical,
// spring-loaded moving screen. Realism details:
//   • Each prism's BACK face is anchored at the backing plane and it extrudes
//     FORWARD as it rises (it never detaches / floats), and a dark backing panel
//     sits behind the grid so gaps never reveal the void.
//   • Heights + colours are temporally EASED through a ping-pong buffer, so the
//     wall moves with spring-like inertia (smooth/soothing) instead of snapping
//     to every frame of the artwork.
//
// Editable via state.prism: cols, rows, widthFill, heightFill, depth (resting
// length), rise (max forward travel).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { FRAME_HEIGHT } from './FlatTarget.js';

// Fullscreen pass that eases the per-cell colour + height toward the artwork.
const computeVertex = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const computeFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSrc;
  uniform sampler2D uPrev;
  uniform float uMix;            // 0 = hold, 1 = snap to target
  void main(){
    vec3 src = texture2D(uSrc, vUv).rgb;
    float target = dot(src, vec3(0.299, 0.587, 0.114));
    vec4 prev = texture2D(uPrev, vUv);
    vec3 col = mix(prev.rgb, src, uMix);
    float height = mix(prev.a, target, uMix);
    gl_FragColor = vec4(col, height);
  }
`;

// Instanced prisms; sample the eased buffer for colour (rgb) + height (a).
const prismVertex = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec2 aCellUv;
  uniform sampler2D uHeightTex;
  uniform float uRise;
  uniform float uBaseDepth;
  uniform float uTrans, uFront, uTransAspect;  // ramp cross-fade ripple
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vH;
  varying float vFrontMix;   // 1 behind the ripple front (new ramp), 0 ahead (old)
  varying float vRing;
  void main(){
    vec4 cell = texture2D(uHeightTex, aCellUv);
    float h = cell.a;
    vColor = cell.rgb;
    vH = clamp(h, 0.0, 1.0);
    // Radial ripple front from the centre (in aspect-corrected cell space).
    float dd = length((aCellUv - 0.5) * vec2(uTransAspect, 1.0));
    vFrontMix = uTrans * smoothstep(uFront + 0.05, uFront - 0.05, dd);
    vRing = uTrans * exp(-pow((dd - uFront) / 0.07, 2.0));
    vNormal = normalMatrix * normal;
    // The ripple front lifts the prisms a little as it passes.
    float hh = h + vRing * 0.35;
    vec3 pos = position;
    pos.z *= 1.0 + (hh * uRise) / uBaseDepth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + aOffset, 1.0);
  }
`;
const prismFragment = /* glsl */ `
  precision highp float;
  uniform float uRamp;          // 0 = use sampled colour · 1 = height→colour ramp
  uniform vec3 uRampLo, uRampHi;     // current (old) ramp
  uniform vec3 uRampLo2, uRampHi2;   // incoming (new) ramp during a transition
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vH;
  varying float vFrontMix;
  varying float vRing;
  void main(){
    vec3 n = normalize(vNormal);
    float light = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.35, 0.5, 1.0))), 0.0);
    // Spectrum: low rise → lo, high rise → hi; cross-faded across the ripple front.
    vec3 lo = mix(uRampLo, uRampLo2, vFrontMix);
    vec3 hi = mix(uRampHi, uRampHi2, vFrontMix);
    vec3 base = mix(vColor, mix(lo, hi, vH), uRamp);
    base += vRing * 0.45; // bright crest at the travelling front
    gl_FragColor = vec4(base * light, 1.0);
  }
`;

export class PrismTarget {
  constructor({ aspect, prism }) {
    this.aspect = aspect;
    this._tRamp = null; // active ramp-transition clock
    this.smoothing = prism.smoothing ?? 0.32; // seconds for the wall to settle
    const cols = Math.max(1, prism.cols | 0);
    const rows = Math.max(1, prism.rows | 0);
    const widthFill = prism.widthFill ?? 0.85;
    const heightFill = prism.heightFill ?? 0.85;
    const baseDepth = Math.max(0.01, prism.depth ?? 0.12);

    const width = FRAME_HEIGHT * aspect;
    const cellW = width / cols;
    const cellH = FRAME_HEIGHT / rows;

    // Box with its back face at z=0 (front at z=baseDepth).
    const box = new THREE.BoxGeometry(cellW * widthFill, cellH * heightFill, baseDepth);
    box.translate(0, 0, baseDepth / 2);

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.attributes.position = box.attributes.position;
    geo.attributes.normal = box.attributes.normal;
    geo.attributes.uv = box.attributes.uv;
    box.dispose();

    const count = cols * rows;
    const offsets = new Float32Array(count * 3);
    const cellUvs = new Float32Array(count * 2);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        offsets[i * 3 + 0] = -width / 2 + (c + 0.5) * cellW;
        offsets[i * 3 + 1] = -FRAME_HEIGHT / 2 + (r + 0.5) * cellH;
        offsets[i * 3 + 2] = 0;
        cellUvs[i * 2 + 0] = (c + 0.5) / cols;
        cellUvs[i * 2 + 1] = (r + 0.5) / rows;
        i++;
      }
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aCellUv', new THREE.InstancedBufferAttribute(cellUvs, 2));
    geo.instanceCount = count;
    this.geometry = geo;

    // Ping-pong eased colour/height buffers at grid resolution.
    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: THREE.HalfFloatType };
    this.rtA = new THREE.WebGLRenderTarget(cols, rows, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(cols, rows, rtOpts);
    this._prev = this.rtA;
    this._next = this.rtB;
    this._primed = false;

    this.computeScene = new THREE.Scene();
    this.computeCamera = new THREE.Camera();
    this.computeMat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null }, uPrev: { value: null }, uMix: { value: 1 } },
      vertexShader: computeVertex,
      fragmentShader: computeFragment,
    });
    this.computeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.computeMat);
    this.computeScene.add(this.computeQuad);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uHeightTex: { value: this._prev.texture },
        uRise: { value: prism.rise ?? 0.32 },
        uBaseDepth: { value: baseDepth },
        uRamp: { value: 0 },
        uRampLo: { value: new THREE.Color('#000000') },
        uRampHi: { value: new THREE.Color('#ffffff') },
        uRampLo2: { value: new THREE.Color('#000000') },
        uRampHi2: { value: new THREE.Color('#ffffff') },
        uTrans: { value: 0 },
        uFront: { value: 0 },
        uTransAspect: { value: aspect },
      },
      vertexShader: prismVertex,
      fragmentShader: prismFragment,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    // Dark backing so gaps between prisms never reveal the void behind.
    this.backing = new THREE.Mesh(
      new THREE.PlaneGeometry(width, FRAME_HEIGHT),
      new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.9 }),
    );
    this.backing.position.z = -0.012;

    this._srcTex = null;
  }

  setTexture(texture) {
    this._srcTex = texture;
    this.computeMat.uniforms.uSrc.value = texture;
  }

  /** Colour the wall by RISE: low → lo, high → hi (e.g. brand background→primary). */
  setHeightRamp(lo, hi) {
    const u = this.material.uniforms;
    u.uRamp.value = 1;
    u.uRampLo.value.set(lo);
    u.uRampHi.value.set(hi);
    u.uTrans.value = 0;
    this._tRamp = null;
  }

  clearHeightRamp() {
    this.material.uniforms.uRamp.value = 0;
    this.material.uniforms.uTrans.value = 0;
    this._tRamp = null;
  }

  /** Cross-fade the rise ramp from (loA,hiA) → (loB,hiB) via a ripple from centre. */
  beginRampTransition(loA, hiA, loB, hiB, dur = 1.6) {
    const u = this.material.uniforms;
    u.uRamp.value = 1;
    u.uRampLo.value.set(loA); u.uRampHi.value.set(hiA);
    u.uRampLo2.value.set(loB); u.uRampHi2.value.set(hiB);
    u.uTrans.value = 1;
    u.uFront.value = 0;
    u.uTransAspect.value = this.aspect;
    this._rampB = [loB, hiB];
    this._tRamp = 0;
    this._tRampDur = dur;
  }

  addTo(scene) {
    scene.add(this.backing);
    scene.add(this.mesh);
  }

  // Called each frame by the Stage: ease the buffer toward the current artwork.
  update(renderer, dt) {
    // Advance an in-flight ramp ripple (centre → edges), then finalise.
    if (this._tRamp != null) {
      this._tRamp = Math.min(1, this._tRamp + dt / this._tRampDur);
      const e = this._tRamp * this._tRamp * (3 - 2 * this._tRamp); // smoothstep
      const maxR = 0.5 * Math.hypot(this.aspect, 1) + 0.1;
      const u = this.material.uniforms;
      u.uFront.value = e * maxR;
      if (this._tRamp >= 1) {
        u.uRampLo.value.copy(u.uRampLo2.value);
        u.uRampHi.value.copy(u.uRampHi2.value);
        u.uTrans.value = 0;
        this._tRamp = null;
      }
    }
    if (!this._srcTex) return;
    const tau = Math.max(0.02, this.smoothing);
    this.computeMat.uniforms.uMix.value = this._primed ? Math.min(1, dt / tau) : 1;
    this.computeMat.uniforms.uPrev.value = this._prev.texture;
    renderer.setRenderTarget(this._next);
    renderer.render(this.computeScene, this.computeCamera);
    renderer.setRenderTarget(null);
    const tmp = this._prev;
    this._prev = this._next;
    this._next = tmp;
    this.material.uniforms.uHeightTex.value = this._prev.texture;
    this._primed = true;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    scene.remove(this.backing);
    this.geometry.dispose();
    this.material.dispose();
    this.backing.geometry.dispose();
    this.backing.material.dispose();
    this.computeQuad.geometry.dispose();
    this.computeMat.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
  }
}
