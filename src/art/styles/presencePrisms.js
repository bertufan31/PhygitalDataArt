// ---------------------------------------------------------------------------
// Art option: "Presence Prisms" — camera-reactive LED-prism wall.
//
// The BASE is the Key-Particles language rendered as a height field: a rotating
// 3D point-cloud of the active brand mark (emblem / ZYN / VEEV) that slowly
// turns and morphs when the brand changes. The prism wall reads its density as
// rise, coloured by the brand spectrum (low rise = background, high = primary).
//
// PRESENCE: when the camera sees movement, the visitor's SILHOUETTE rises on
// top of the logo, highlighting them; it releases ~1.5s after movement stops,
// leaving the rotating logo. The silhouette is background-subtracted then
// morphologically CLOSED so the body fills solid (no holes in low-contrast
// areas like a face). Private — the camera image is never shown.
//
// Data reactions: visitor → a ripple ring · sale/flavour → a wall-wide surge ·
// product → a shimmer. prismOnly + prismRamp + ownLook (see Stage).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { Eased } from '../effects.js';
import { samplePoints, sdfAt } from '../../core/shape.js';
import { hasBrandSilhouette, sampleBrandPoints } from '../../core/brandShapes.js';

const MASK_W = 128;       // background-subtraction grid
const RIP_MAX = 5;        // concurrent visitor ripples
const SHAPE_SCALE = 1.5;  // logo fills the wall (samples are ~[-0.5,0.5])

// --- the rotating brand point-cloud (renders a grayscale density field) ----
const logoVertex = /* glsl */ `
  precision highp float;
  attribute float aPhase;
  attribute float aSize;
  attribute vec3 aTarget;
  uniform float uTime, uPixel, uSizeScale, uMorph;
  varying float vA;
  void main(){
    vec3 pos = mix(position, aTarget, uMorph);
    pos.z += sin(uTime * 0.5 + aPhase * 6.2831) * 0.05; // subtle depth life
    vA = 0.85;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixel * uSizeScale * (6.0 / -mv.z);
  }
`;
const logoFragment = /* glsl */ `
  precision highp float;
  varying float vA;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float m = smoothstep(0.5, 0.0, length(c));
    gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * m * vA, m * vA);
  }
`;

// --- compositor: logo density + silhouette + reactions → prism height ------
const compVertex = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const compFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uLogoTex, uMask;
  uniform float uTime, uAspect, uMaskOn, uPulse, uShimmer;
  uniform vec3 uRip[${RIP_MAX}];
  uniform int uRipCount;
  ${NOISE_GLSL}
  void main(){
    vec2 p = vUv * vec2(uAspect, 1.0);
    // Base: the rotating brand logo (always present), as a height field.
    float logoH = clamp(texture2D(uLogoTex, vUv).g * 2.6, 0.0, 1.0);
    // Presence: the visitor's filled silhouette rises ON TOP when they move.
    float sil = clamp(texture2D(uMask, vUv).r * 1.3, 0.0, 1.0);
    float h = max(logoH, sil * uMaskOn);

    // VISITOR → ripple rings travel out across the wall.
    for (int i = 0; i < ${RIP_MAX}; i++) {
      if (i >= uRipCount) break;
      vec2 c = uRip[i].xy * vec2(uAspect, 1.0);
      float age = uRip[i].z;
      float ring = exp(-pow((distance(p, c) - age * 1.2) * 6.0, 2.0)) * (1.0 - age);
      h = max(h, ring * 0.9);
    }
    // SALE → the whole wall surges up; PRODUCT → a shimmer jolts the prisms.
    h = max(h, uPulse * (0.7 + 0.3 * fbm(p * 2.0 + uTime * 0.5)));
    h += uShimmer * smoothstep(0.45, 1.0, snoise(p * 9.0 + uTime * 6.0)) * 0.7;

    gl_FragColor = vec4(vec3(clamp(h, 0.0, 1.0)), 1.0);
  }
`;

export class PresencePrisms extends BaseArt {
  static id = 'presence-prisms';
  static label = 'Presence Prisms';
  static ownLook = true;   // grade stays neutral (height field passes through)
  static prismOnly = true; // runs on the LED-prism wall
  static prismRamp = true; // wall coloured by rise: background (low) → primary (high)
  static params = [
    { key: 'count', type: 'range', label: 'Particles', min: 20000, max: 150000, step: 10000, default: 60000 },
    { key: 'size', type: 'range', label: 'Particle size', min: 0.5, max: 4, step: 0.1, default: 1.6 },
    { key: 'spin', type: 'range', label: 'Spin', min: 0, max: 1, step: 0.05, default: 0.18 },
    { key: 'sensitivity', type: 'range', label: 'Sensitivity', min: 0.05, max: 0.5, step: 0.01, default: 0.16 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.aspect = this.size.width / this.size.height;
    this.time = 0;
    this.count = 60000;
    this.spin = 0.18;
    this.brandId = null;
    this.branded = false;
    this.morph = 1;
    this.morphTarget = 1;
    this.threshold = 0.16;
    this.phase = 'idle';
    this._maskEase = 0;
    this._calibAt = 0;
    this._frameToggle = false;
    this._lastActive = -Infinity;

    // --- rotating logo point-cloud → logoRT (grayscale density) ---
    this.logoUniforms = {
      uTime: { value: 0 },
      uPixel: { value: this.size.height / 600 },
      uSizeScale: { value: 1.6 },
      uMorph: { value: 1 },
    };
    this.logoMat = new THREE.ShaderMaterial({
      uniforms: this.logoUniforms, vertexShader: logoVertex, fragmentShader: logoFragment,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.logoCam = new THREE.PerspectiveCamera(45, this.aspect, 0.1, 100);
    this.logoCam.position.set(0, 0, 3.2);
    this.logoScene = new THREE.Scene();
    this.logoScene.background = new THREE.Color('#000000');
    this._buildCloud();
    this.logoRT = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });

    // --- camera silhouette mask ---
    this.maskW = MASK_W;
    this.maskH = Math.max(8, Math.round(MASK_W / this.aspect));
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskW; this.maskCanvas.height = this.maskH;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.maskCtx.fillStyle = '#000'; this.maskCtx.fillRect(0, 0, this.maskW, this.maskH);
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTex.minFilter = THREE.LinearFilter; this.maskTex.magFilter = THREE.LinearFilter;
    this.workCanvas = document.createElement('canvas');
    this.workCanvas.width = this.maskW; this.workCanvas.height = this.maskH;
    this.workCtx = this.workCanvas.getContext('2d', { willReadFrequently: true });
    this._bgRef = null;
    this._prevCur = null;
    const N = this.maskW * this.maskH;
    this._smooth = new Float32Array(N);
    this._mA = new Float32Array(N);
    this._mB = new Float32Array(N);
    this._maskImage = this.maskCtx.createImageData(this.maskW, this.maskH);

    // --- data reactions ---
    this.pulse = new Eased(0, { max: 1, decay: 1.0, rise: 6 });
    this.shimmer = new Eased(0, { max: 1, decay: 1.4, rise: 8 });
    this.ripples = [];

    // --- compositor → renderTarget (the prism source) ---
    this.compUniforms = {
      uLogoTex: { value: this.logoRT.texture },
      uMask: { value: this.maskTex },
      uTime: { value: 0 },
      uAspect: { value: this.aspect },
      uMaskOn: { value: 0 },
      uPulse: { value: 0 },
      uShimmer: { value: 0 },
      uRip: { value: Array.from({ length: RIP_MAX }, () => new THREE.Vector3()) },
      uRipCount: { value: 0 },
    };
    this.compMat = new THREE.ShaderMaterial({ uniforms: this.compUniforms, vertexShader: compVertex, fragmentShader: compFragment });
    this.compScene = new THREE.Scene();
    this.compCam = new THREE.Camera();
    this.compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat));

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

    this._onTap = () => {
      if (this.phase === 'idle') this._startCamera();
      else if (this.phase === 'live') this._calibrate();
    };
    window.addEventListener('pointerdown', this._onTap);
  }

  _buildCloud() {
    if (this.points) { this.logoScene.remove(this.points); this.geometry.dispose(); }
    const n = this.count;
    const pts = samplePoints(n);
    const positions = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = pts[i * 2] * SHAPE_SCALE;
      positions[i * 3 + 1] = pts[i * 2 + 1] * SHAPE_SCALE;
      const inside = sdfAt(pts[i * 2], pts[i * 2 + 1]);
      positions[i * 3 + 2] = (Math.random() < 0.5 ? -1 : 1) * inside * 2.0 + (Math.random() - 0.5) * 0.04;
      phase[i] = Math.random();
      sizes[i] = 0.8 + Math.random() * 1.0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aTarget', new THREE.BufferAttribute(positions.slice(), 3));
    this.geometry = geo;
    this._emblem = positions.slice();
    this.points = new THREE.Points(geo, this.logoMat);
    this.points.frustumCulled = false;
    this.logoScene.add(this.points);
    if (this.branded) { this._writeTarget(); this.morph = this.morphTarget = 1; this.logoUniforms.uMorph.value = 1; }
  }

  _writeTarget() {
    const n = this.count;
    const tgt = this.geometry.attributes.aTarget.array;
    const brandPts = hasBrandSilhouette(this.brandId) ? sampleBrandPoints(this.brandId, n) : null;
    if (brandPts) {
      for (let i = 0; i < n; i++) {
        tgt[i * 3] = brandPts[i * 2] * SHAPE_SCALE;
        tgt[i * 3 + 1] = brandPts[i * 2 + 1] * SHAPE_SCALE;
        tgt[i * 3 + 2] = (Math.random() - 0.5) * 0.22;
      }
    } else {
      tgt.set(this._emblem);
    }
    this.geometry.attributes.aTarget.needsUpdate = true;
  }

  // Brand change = a rotating cross-morph (Key Particles style).
  setBrand(brandId) {
    if (brandId === this.brandId) return;
    this.brandId = brandId;
    this.branded = hasBrandSilhouette(brandId);
    if (!this.geometry) return;
    const pos = this.geometry.attributes.position, tgt = this.geometry.attributes.aTarget;
    if (this.morph > 0) {
      const a = pos.array, t = tgt.array, m = this.morph;
      for (let i = 0; i < a.length; i++) a[i] += (t[i] - a[i]) * m; // bake current blend
      pos.needsUpdate = true;
    }
    this._writeTarget();
    this.morph = 0;
    this.morphTarget = 1;
  }

  async _startCamera() {
    this.phase = 'requesting';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      this.stream = stream;
      this.video = document.createElement('video');
      this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true;
      this.video.srcObject = stream;
      await this.video.play();
      this.phase = 'live';
      this._calibAt = this.time + 1.2;
    } catch { this.phase = 'idle'; }
  }

  _drawVideo() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return false;
    const ma = this.maskW / this.maskH, va = vw / vh;
    let sx, sy, sw, sh;
    if (va > ma) { sh = vh; sw = vh * ma; sx = (vw - sw) / 2; sy = 0; }
    else { sw = vw; sh = vw / ma; sx = 0; sy = (vh - sh) / 2; }
    const c = this.workCtx;
    c.save(); c.scale(-1, 1);
    c.drawImage(this.video, sx, sy, sw, sh, -this.maskW, 0, this.maskW, this.maskH);
    c.restore();
    return true;
  }

  _calibrate() {
    if (this.phase !== 'live' || !this._drawVideo()) return;
    this._bgRef = this.workCtx.getImageData(0, 0, this.maskW, this.maskH).data.slice();
    this._smooth.fill(0);
    this._prevCur = null;
    this._lastActive = -Infinity;
  }

  _updateMask() {
    if (!this._bgRef || !this._drawVideo()) return;
    const cur = this.workCtx.getImageData(0, 0, this.maskW, this.maskH).data;
    const bg = this._bgRef, prev = this._prevCur, sm = this._smooth;
    const W = this.maskW, H = this.maskH, t = this.threshold;
    let motion = 0;
    for (let i = 0, p = 0; i < sm.length; i++, p += 4) {
      const diff = (Math.abs(cur[p] - bg[p]) + Math.abs(cur[p + 1] - bg[p + 1]) + Math.abs(cur[p + 2] - bg[p + 2])) / 765;
      let x = (diff - t) / 0.22; x = x < 0 ? 0 : x > 1 ? 1 : x;
      sm[i] += (x * x * (3 - 2 * x) - sm[i]) * 0.25;
      if (prev) motion += (Math.abs(cur[p] - prev[p]) + Math.abs(cur[p + 1] - prev[p + 1]) + Math.abs(cur[p + 2] - prev[p + 2])) / 765;
    }
    this._prevCur = cur;
    const motionNorm = prev ? motion / sm.length : 0;
    if (prev && motionNorm > 0.004) this._lastActive = this.time;
    if (motionNorm < 0.02) { const a = 0.03; for (let p = 0; p < bg.length; p++) bg[p] += (cur[p] - bg[p]) * a; }

    // Morphological CLOSE (dilate then erode) fills interior holes so the body
    // reads solid — no gaps in low-contrast regions like a face.
    const max3 = (s, d) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const v = s[yy * W + xx]; if (v > m) m = v; } }
        d[y * W + x] = m;
      }
    };
    const min3 = (s, d) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let m = 1;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const v = s[yy * W + xx]; if (v < m) m = v; } }
        d[y * W + x] = m;
      }
    };
    let a = this._mA, b = this._mB;
    a.set(sm);
    for (let k = 0; k < 5; k++) { max3(a, b); const tmp = a; a = b; b = tmp; } // dilate
    for (let k = 0; k < 5; k++) { min3(a, b); const tmp = a; a = b; b = tmp; }  // erode
    // light blur for soft gradients
    const out = this._maskImage.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let acc = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; acc += a[yy * W + xx]; cnt++; } }
      const v = Math.min(255, Math.round((acc / cnt) * 255));
      const o = (y * W + x) * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
    }
    this.maskCtx.putImageData(this._maskImage, 0, 0);
    this.maskTex.needsUpdate = true;
  }

  setParams(p) {
    if (p.sensitivity != null) this.threshold = p.sensitivity;
    if (p.spin != null) this.spin = p.spin;
    if (p.size != null) this.logoUniforms.uSizeScale.value = p.size;
    if (p.count != null && (p.count | 0) !== this.count) { this.count = p.count | 0; this._buildCloud(); }
  }

  resize(size) {
    this.size = size;
    this.aspect = size.width / size.height;
    this.logoCam.aspect = this.aspect;
    this.logoCam.updateProjectionMatrix();
    this.logoUniforms.uPixel.value = size.height / 600;
    this.compUniforms.uAspect.value = this.aspect;
    this.logoRT.setSize(size.width, size.height);
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    switch (event.type) {
      case EventTypes.VISITOR_ENTERED:
        this.ripples.push({ x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7, t: 0 });
        if (this.ripples.length > RIP_MAX) this.ripples.shift();
        break;
      case EventTypes.SALE_MADE:
      case EventTypes.FLAVOUR_SOLD:
        this.pulse.bump(1);
        break;
      case EventTypes.PRODUCT_SOLD:
        this.shimmer.bump(1);
        break;
    }
  }

  update(dt) {
    this.time += dt;

    // Rotate + morph the logo cloud, render to logoRT.
    this.morph += (this.morphTarget - this.morph) * Math.min(1, dt * 2.2);
    this.points.rotation.y += dt * this.spin;
    this.points.rotation.y %= Math.PI * 2;
    this.logoUniforms.uTime.value = this.time;
    this.logoUniforms.uMorph.value = this.morph;
    this.renderer.setRenderTarget(this.logoRT);
    this.renderer.render(this.logoScene, this.logoCam);

    // Camera mask + movement-gated engagement.
    if (this._calibAt && this.time >= this._calibAt) { this._calibrate(); this._calibAt = 0; }
    this._frameToggle = !this._frameToggle;
    if (this.phase === 'live' && this._frameToggle) this._updateMask();
    const engaged = this.phase === 'live' && this._bgRef && (this.time - this._lastActive) < 1.5;
    this._maskEase += ((engaged ? 1 : 0) - this._maskEase) * Math.min(1, dt * 2.2);

    // Advance ripples + reactions.
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].t += dt / 1.6;
      if (this.ripples[i].t >= 1) this.ripples.splice(i, 1);
    }
    for (let i = 0; i < RIP_MAX; i++) {
      const r = this.ripples[i];
      this.compUniforms.uRip.value[i].set(r ? r.x : 0, r ? r.y : 0, r ? r.t : 1);
    }
    this.compUniforms.uRipCount.value = this.ripples.length;
    this.compUniforms.uMaskOn.value = this._maskEase;
    this.compUniforms.uPulse.value = this.pulse.update(dt);
    this.compUniforms.uShimmer.value = this.shimmer.update(dt);
    this.compUniforms.uTime.value = this.time;

    // Composite → the prism height field.
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.compScene, this.compCam);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this.renderTarget.texture; }

  destroy() {
    window.removeEventListener('pointerdown', this._onTap);
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    if (this.video) this.video.srcObject = null;
    this.maskTex.dispose();
    this.geometry.dispose();
    this.logoMat.dispose();
    this.compMat.dispose();
    this.logoRT.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(PresencePrisms);
