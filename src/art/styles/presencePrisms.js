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
import { NOISE_GLSL } from '../shaderLib.js';

const MASK_W = 128; // background-subtraction grid (small, ~9k px/frame)

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uAspect, uMaskOn, uIdle;
  uniform sampler2D uMask;
  ${NOISE_GLSL}
  void main(){
    // Idle: a slow drifting noise field lifts a few prisms and lets them settle.
    vec2 p = vUv * vec2(uAspect, 1.0);
    float n = fbm(p * 3.2 + vec2(uTime * 0.18, uTime * 0.12));
    float idle = uIdle * (0.12 + 0.88 * smoothstep(0.5, 1.0, n));

    // Presence: the visitor's silhouette (mask) rises the wall in its shape.
    float sil = clamp(texture2D(uMask, vUv).r * 1.25, 0.0, 1.0);

    float h = max(idle, sil * uMaskOn);
    gl_FragColor = vec4(vec3(h), 1.0); // grayscale height → prism rise + ramp
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
    this._smooth = new Float32Array(this.maskW * this.maskH);
    this._blurTmp = new Float32Array(this.maskW * this.maskH);
    this._maskImage = this.maskCtx.createImageData(this.maskW, this.maskH);

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uMaskOn: { value: 0 },
      uIdle: { value: 0.5 },
      uMask: { value: this.maskTex },
    };
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
  }

  _updateMask() {
    if (!this._bgRef || !this._drawVideo()) return;
    const cur = this.workCtx.getImageData(0, 0, this.maskW, this.maskH).data;
    const bg = this._bgRef, sm = this._smooth;
    const W = this.maskW, H = this.maskH, t = this.threshold;
    let activity = 0;
    for (let i = 0, p = 0; i < sm.length; i++, p += 4) {
      const diff = (Math.abs(cur[p] - bg[p]) + Math.abs(cur[p + 1] - bg[p + 1]) + Math.abs(cur[p + 2] - bg[p + 2])) / 765;
      let x = (diff - t) / 0.22; x = x < 0 ? 0 : x > 1 ? 1 : x;
      const v = x * x * (3 - 2 * x);
      sm[i] += (v - sm[i]) * 0.2; // temporal smoothing (organic, not jumpy)
      activity += sm[i];
    }
    if (activity / sm.length > 0.015) this._lastActive = this.time;
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

  setParams(p) {
    if (p.sensitivity != null) this.threshold = p.sensitivity;
    if (p.idle != null) this.uniforms.uIdle.value = p.idle;
  }

  resize(size) {
    this.size = size;
    this.uniforms.uAspect.value = size.width / size.height;
    this.renderTarget.setSize(size.width, size.height);
  }

  update(dt) {
    this.time += dt;
    if (this._calibAt && this.time >= this._calibAt) { this._calibrate(); this._calibAt = 0; }
    this._frameToggle = !this._frameToggle;
    if (this.phase === 'live' && this._frameToggle) this._updateMask();
    // Presence engages while someone is there; releases ~5s after the last action.
    const engaged = this.phase === 'live' && this._bgRef && (this.time - this._lastActive) < 5;
    this._maskEase += ((engaged ? 1 : 0) - this._maskEase) * Math.min(1, dt * 1.5);
    this.uniforms.uMaskOn.value = this._maskEase;
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
    this.material.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(PresencePrisms);
