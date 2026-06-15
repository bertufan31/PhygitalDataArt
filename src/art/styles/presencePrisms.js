// ---------------------------------------------------------------------------
// Art option: "Presence Prisms" — the camera drives the physical LED-prism wall.
//
// This piece is designed for the LED PRISMS target only (prismOnly): it outputs
// a grayscale HEIGHT FIELD that the prism wall turns into rise. A height→colour
// ramp on the prisms paints the wall in the active brand's spectrum — lowest
// rise = brand PRIMARY, highest rise = brand SECONDARY (prismRamp).
//
//   • IDLE (nothing in view): a slow noise field nudges scattered prisms up a
//     little and lets them settle back — the wall breathes.
//   • PRESENCE: a person/object the camera sees is separated from the
//     background and its SILHOUETTE rises the prisms in that shape.
//
// Privacy: the camera image is never shown — only the silhouette height drives
// the wall. Tap once to enable the camera, tap again to recalibrate the empty
// scene. After ~5s with no activity it returns to the idle breathing.
// ownLook keeps the grade neutral so the height field passes through cleanly.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { Eased } from '../effects.js';
import { drawBrandGlyph } from '../../core/brandGlyph.js';

const MASK_W = 128; // background-subtraction grid (small, ~9k px/frame)
const RIP_MAX = 5;  // concurrent visitor ripples

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uAspect, uMaskOn, uIdle, uPulse, uShimmer, uLogoAmt, uTrans, uFront;
  uniform sampler2D uMask, uLogo, uLogoPrev;
  uniform vec3 uRip[${RIP_MAX}];   // xy = centre (0..1), z = age (0..1)
  uniform int uRipCount;
  ${NOISE_GLSL}
  void main(){
    vec2 p = vUv * vec2(uAspect, 1.0);
    // BRAND TRANSITION: a ripple from the centre wipes the OLD logo → NEW logo.
    float dd = length((vUv - 0.5) * vec2(uAspect, 1.0));
    float frontMix = (uTrans > 0.5) ? smoothstep(uFront + 0.05, uFront - 0.05, dd) : 1.0;
    float logo = mix(texture2D(uLogoPrev, vUv).a, texture2D(uLogo, vUv).a, frontMix);
    float transRing = (uTrans > 0.5) ? exp(-pow((dd - uFront) / 0.07, 2.0)) : 0.0;

    // IDLE (no one in view) → the active brand's LOGO blooms in (uLogoAmt rises
    // after a few seconds of stillness), over a faint ambient shimmer.
    float breathe = 0.86 + 0.14 * sin(uTime * 1.1 + vUv.x * 3.0);
    float ambient = uIdle * 0.09 * smoothstep(0.55, 1.0, fbm(p * 3.2 + vec2(uTime * 0.18, uTime * 0.12)));
    float idleState = max(logo * uLogoAmt * breathe, ambient);

    // PRESENCE → the live silhouette replaces the logo (no presence = logo).
    float sil = clamp(texture2D(uMask, vUv).r * 1.25, 0.0, 1.0);
    float h = mix(idleState, max(sil, ambient), uMaskOn);
    h = max(h, transRing * 0.9); // the brand-change ripple lifts the wall as it passes

    // VISITOR → ripple: rings of rise travel out across the wall.
    for (int i = 0; i < ${RIP_MAX}; i++) {
      if (i >= uRipCount) break;
      vec2 c = uRip[i].xy * vec2(uAspect, 1.0);
      float age = uRip[i].z;
      float ring = exp(-pow((distance(p, c) - age * 1.2) * 6.0, 2.0)) * (1.0 - age);
      h = max(h, ring * 0.95);
    }
    // SALE / FLAVOUR → the whole wall surges up (toward the secondary colour).
    h = max(h, uPulse * (0.7 + 0.3 * fbm(p * 2.0 + uTime * 0.5)));
    // PRODUCT → a shimmer jolts scattered prisms.
    h += uShimmer * smoothstep(0.45, 1.0, snoise(p * 9.0 + uTime * 6.0)) * 0.7;

    gl_FragColor = vec4(vec3(clamp(h, 0.0, 1.0)), 1.0); // height → prism rise + ramp
  }
`;

export class PresencePrisms extends BaseArt {
  static id = 'presence-prisms';
  static label = 'Presence Prisms';
  static ownLook = true;   // grade stays neutral (height field passes through)
  static prismOnly = true; // runs on the LED-prism wall
  static prismRamp = true; // wall coloured by rise: primary (low) → secondary (high)
  static params = [
    { key: 'sensitivity', type: 'range', label: 'Sensitivity', min: 0.05, max: 0.5, step: 0.01, default: 0.16 },
    { key: 'idle', type: 'range', label: 'Idle motion', min: 0, max: 1, step: 0.05, default: 0.5 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.phase = 'idle'; // 'idle' | 'requesting' | 'live'
    this.threshold = 0.16;
    this._maskEase = 0;
    this._calibAt = 0;
    this._frameToggle = false;
    this._lastActive = -Infinity;
    this.brandId = 'iqos';
    this._logoCache = {};

    // Background-subtraction mask (small grid, linearly filtered on the GPU).
    const aspect = this.size.width / this.size.height;
    this.maskW = MASK_W;
    this.maskH = Math.max(8, Math.round(MASK_W / aspect));
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskW; this.maskCanvas.height = this.maskH;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.maskCtx.fillStyle = '#000';
    this.maskCtx.fillRect(0, 0, this.maskW, this.maskH);
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.magFilter = THREE.LinearFilter;
    this.workCanvas = document.createElement('canvas');
    this.workCanvas.width = this.maskW; this.workCanvas.height = this.maskH;
    this.workCtx = this.workCanvas.getContext('2d', { willReadFrequently: true });
    this._bgRef = null;
    this._prevCur = null; // previous frame, for MOVEMENT detection
    this._smooth = new Float32Array(this.maskW * this.maskH);
    this._blurTmp = new Float32Array(this.maskW * this.maskH);
    this._maskImage = this.maskCtx.createImageData(this.maskW, this.maskH);

    // Live-data reactions.
    this.pulse = new Eased(0, { max: 1, decay: 1.0, rise: 6 });   // sale/flavour surge
    this.shimmer = new Eased(0, { max: 1, decay: 1.4, rise: 8 }); // product jolt
    this.ripples = []; // visitor rings: { x, y, t }

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uMaskOn: { value: 0 },
      uIdle: { value: 0.5 },
      uPulse: { value: 0 },
      uShimmer: { value: 0 },
      uMask: { value: this.maskTex },
      uLogo: { value: null },
      uLogoPrev: { value: null },
      uLogoAmt: { value: 1 },
      uTrans: { value: 0 },
      uFront: { value: 0 },
      uRip: { value: Array.from({ length: RIP_MAX }, () => new THREE.Vector3()) },
      uRipCount: { value: 0 },
    };
    this._buildLogo(this.brandId);
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));

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
    } catch {
      this.phase = 'idle';
    }
  }

  _drawVideo() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return false;
    const ma = this.maskW / this.maskH, va = vw / vh;
    let sx, sy, sw, sh;
    if (va > ma) { sh = vh; sw = vh * ma; sx = (vw - sw) / 2; sy = 0; }
    else { sw = vw; sh = vw / ma; sx = 0; sy = (vh - sh) / 2; }
    const c = this.workCtx;
    c.save();
    c.scale(-1, 1); // mirror (selfie)
    c.drawImage(this.video, sx, sy, sw, sh, -this.maskW, 0, this.maskW, this.maskH);
    c.restore();
    return true;
  }

  _calibrate() {
    if (this.phase !== 'live' || !this._drawVideo()) return;
    this._bgRef = this.workCtx.getImageData(0, 0, this.maskW, this.maskH).data.slice();
    this._smooth.fill(0);
    this._prevCur = null;
    this._lastActive = -Infinity; // require fresh MOVEMENT to engage
  }

  _updateMask() {
    if (!this._bgRef || !this._drawVideo()) return;
    const cur = this.workCtx.getImageData(0, 0, this.maskW, this.maskH).data;
    const bg = this._bgRef, prev = this._prevCur, sm = this._smooth;
    const W = this.maskW, H = this.maskH, t = this.threshold;
    let motion = 0;
    for (let i = 0, p = 0; i < sm.length; i++, p += 4) {
      // Silhouette SHAPE: difference from the empty-scene reference.
      const diff = (Math.abs(cur[p] - bg[p]) + Math.abs(cur[p + 1] - bg[p + 1]) + Math.abs(cur[p + 2] - bg[p + 2])) / 765;
      let x = (diff - t) / 0.22; x = x < 0 ? 0 : x > 1 ? 1 : x;
      const v = x * x * (3 - 2 * x);
      sm[i] += (v - sm[i]) * 0.2; // temporal smoothing (organic, not jumpy)
      // ENGAGEMENT: frame-to-frame MOVEMENT (a still person fades to idle).
      if (prev) motion += (Math.abs(cur[p] - prev[p]) + Math.abs(cur[p + 1] - prev[p + 1]) + Math.abs(cur[p + 2] - prev[p + 2])) / 765;
    }
    this._prevCur = cur;
    const motionNorm = prev ? motion / sm.length : 0;
    if (prev && motionNorm > 0.004) this._lastActive = this.time; // someone moved
    // Adaptive background: when motion is low, slowly absorb the current frame
    // into the reference, so a stale ghost (or a person who stopped moving)
    // melts away — no stuck silhouette. Frozen during strong motion so an
    // active person still reads.
    if (motionNorm < 0.02) {
      const adapt = 0.03;
      for (let p = 0; p < bg.length; p++) bg[p] += (cur[p] - bg[p]) * adapt;
    }
    const blur = (src, dst) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let acc = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; acc += src[yy * W + xx]; cnt++; } }
        dst[y * W + x] = acc / cnt;
      }
    };
    blur(sm, this._blurTmp);
    const out = this._maskImage.data;
    for (let i = 0; i < this._blurTmp.length; i++) {
      const v = Math.min(255, Math.round(this._blurTmp[i] * 255));
      const o = i * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
    }
    this.maskCtx.putImageData(this._maskImage, 0, 0);
    this.maskTex.needsUpdate = true;
  }

  // The idle logo height-field for a brand (iqos → emblem). Cached per brand,
  // fitted to the frame aspect; read via the alpha channel in the shader.
  _buildLogo(brandId) {
    const id = brandId === 'zyn' || brandId === 'veev' ? brandId : null; // iqos → emblem
    const key = id || 'iqos';
    if (!this._logoCache[key]) {
      const aspect = this.size.width / this.size.height;
      const W = 256, H = Math.max(8, Math.round(256 / aspect));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      drawBrandGlyph(c.getContext('2d'), W, H, id);
      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this._logoCache[key] = tex;
    }
    if (this.uniforms) this.uniforms.uLogo.value = this._logoCache[key];
  }

  // No presence → show this brand's logo (Stage passes the active brand).
  setBrand(brandId) {
    this.brandId = brandId;
    this._buildLogo(brandId);
    if (this.uniforms) this.uniforms.uLogoPrev.value = this.uniforms.uLogo.value; // no cross-fade
  }

  // Smooth brand change: ripple from the centre that swaps colour + logo behind it.
  beginBrandTransition(brandId) {
    if (!this.uniforms) { this.setBrand(brandId); return; }
    this.uniforms.uLogoPrev.value = this.uniforms.uLogo.value; // current logo = "from"
    this.brandId = brandId;
    this._buildLogo(brandId); // uLogo = "to"
    this.uniforms.uTrans.value = 1;
    this.uniforms.uFront.value = 0;
    this._tBrand = 0;
  }

  setParams(p) {
    if (p.sensitivity != null) this.threshold = p.sensitivity;
    if (p.idle != null) this.uniforms.uIdle.value = p.idle;
  }

  // Live data reactions, chosen to read on a rising prism wall:
  //   visitor → a ripple ring rolls out · sale/flavour → the wall surges up
  //   (toward the secondary colour) · product → a shimmer jolts the prisms.
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

  resize(size) {
    this.size = size;
    this.uniforms.uAspect.value = size.width / size.height;
    this.renderTarget.setSize(size.width, size.height);
    // Rebuild the logo at the new frame aspect (cache is aspect-specific).
    Object.values(this._logoCache).forEach((t) => t.dispose());
    this._logoCache = {};
    this._buildLogo(this.brandId);
  }

  update(dt) {
    this.time += dt;
    if (this._calibAt && this.time >= this._calibAt) { this._calibrate(); this._calibAt = 0; }
    this._frameToggle = !this._frameToggle;
    if (this.phase === 'live' && this._frameToggle) this._updateMask();
    // Presence engages while someone is there; releases ~5s after the last action.
    // Engage the silhouette only while there's recent MOVEMENT; it fades ~1.5s
    // after motion stops. After 6s of stillness the LOGO blooms in to full
    // glory (and it's the default whenever the camera is off).
    const idleTime = this.time - this._lastActive;
    const engaged = this.phase === 'live' && this._bgRef && idleTime < 1.5;
    this._maskEase += ((engaged ? 1 : 0) - this._maskEase) * Math.min(1, dt * 2.2);
    this.uniforms.uMaskOn.value = this._maskEase;
    this.uniforms.uLogoAmt.value = THREE.MathUtils.smoothstep(idleTime, 6, 8.5);

    // Advance an in-flight brand-change ripple (centre → edges), then finalise.
    if (this._tBrand != null) {
      this._tBrand = Math.min(1, this._tBrand + dt / 1.6);
      const e = this._tBrand * this._tBrand * (3 - 2 * this._tBrand);
      const maxR = 0.5 * Math.hypot(this.uniforms.uAspect.value, 1) + 0.1;
      this.uniforms.uFront.value = e * maxR;
      if (this._tBrand >= 1) {
        this._tBrand = null;
        this.uniforms.uTrans.value = 0;
        this.uniforms.uLogoPrev.value = this.uniforms.uLogo.value;
      }
    }

    // Advance visitor ripples (≈1.6s life) and publish to the shader.
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].t += dt / 1.6;
      if (this.ripples[i].t >= 1) this.ripples.splice(i, 1);
    }
    for (let i = 0; i < RIP_MAX; i++) {
      const r = this.ripples[i];
      this.uniforms.uRip.value[i].set(r ? r.x : 0, r ? r.y : 0, r ? r.t : 1);
    }
    this.uniforms.uRipCount.value = this.ripples.length;
    this.uniforms.uPulse.value = this.pulse.update(dt);
    this.uniforms.uShimmer.value = this.shimmer.update(dt);
    this.uniforms.uTime.value = this.time;

    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this.renderTarget.texture; }

  destroy() {
    window.removeEventListener('pointerdown', this._onTap);
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    if (this.video) this.video.srcObject = null;
    this.maskTex.dispose();
    Object.values(this._logoCache).forEach((t) => t.dispose());
    this.material.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(PresencePrisms);
