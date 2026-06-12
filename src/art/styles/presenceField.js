// ---------------------------------------------------------------------------
// Art option: "Presence" (camera-reactive particle flow).
//
// Particle Flow is the starting point: the same curl-noise streaming cloud.
// The room camera adds an invisible layer: people in front of the piece are
// separated from the background and their silhouette becomes an ATTRACTOR —
// particles drift toward it and glow slightly brighter inside it, so the cloud
// subtly condenses into the visitor's outline. The camera image itself is
// NEVER shown; only its influence on the particles is visible.
//
// Human/background separation (in-browser background subtraction):
//   tap → camera starts → after a beat the empty scene is captured as the
//   reference → each live frame is diffed against it on a small grid (128×72),
//   softly thresholded, temporally smoothed and blurred into an attraction
//   MASK texture. The particle shader climbs the mask's gradient (toward the
//   silhouette) and brightens with its value. Tap again to recalibrate.
// Private by design: video stays on-device; nothing is uploaded or rendered.
// Upgrade path: swap the diff for MediaPipe Selfie Segmentation for crisp
// person edges in busy scenes — mask consumers are unchanged.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';

const FX_MAX = 8;
const BASE_ENERGY = 0.5;
const MASK_W = 128; // small CPU grid — ~9k px per frame, trivial

const vertexShader = /* glsl */ `
  precision highp float;
  #define FX_MAX ${FX_MAX}
  attribute vec2 aMeta;            // x = speed, y = colour parameter
  uniform float uTime, uAspect, uEnergy, uPaletteShift, uTintAmount, uSizeScale;
  uniform float uMaskOn, uPull;
  uniform sampler2D uMask;
  uniform vec3  uTint;
  uniform vec4  uFxPos[FX_MAX];
  uniform vec3  uFxColor[FX_MAX];
  uniform int   uFxCount;
  varying vec3  vColor;
  varying float vAlpha;

  ${NOISE_GLSL}

  vec3 palette(float t){
    vec3 a = vec3(0.5, 0.5, 0.55);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.50, 0.32, 0.12);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main(){
    float speed = aMeta.x;
    float phase = fract(position.z + uTime * speed * (0.3 + 0.6 * uEnergy) * 0.05);

    vec2 pos = position.xy;
    float stride = 0.40 * phase;
    for (int i = 0; i < 6; i++) {
      vec2 fv = curl(vec2(pos.x * uAspect, pos.y) * 1.4 + 13.0);
      pos += normalize(fv + 1e-5) * (stride / 6.0);
    }

    // PRESENCE: climb the mask gradient → particles are drawn toward the
    // visitor's silhouette; pick up a soft glow inside it.
    float presence = 0.0;
    if (uMaskOn > 0.001) {
      vec2 muv = pos * 0.5 + 0.5;
      float e = 0.022;
      float m  = texture2D(uMask, muv).r;
      vec2 g = vec2(
        texture2D(uMask, muv + vec2(e, 0.0)).r - texture2D(uMask, muv - vec2(e, 0.0)).r,
        texture2D(uMask, muv + vec2(0.0, e)).r - texture2D(uMask, muv - vec2(0.0, e)).r
      );
      pos += g * uPull * uMaskOn * 0.9;
      presence = m * uMaskOn;
    }

    vec3 baseCol = palette(aMeta.y + uPaletteShift);
    vec3 fxCol = vec3(0.0);
    float bright = 0.0;
    float sizeBoost = 0.0;

    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      vec4 fx = uFxPos[i];
      vec2 c = fx.xy * 2.0 - 1.0;
      float dist = distance(pos, c);
      float age = fx.z;
      float fade = 1.0 - age;
      if (fx.w < 0.5) {
        float ring = exp(-pow((dist - age * 1.3) * 4.0, 2.0));
        fxCol += uFxColor[i] * ring * fade;
        bright += ring * fade * 0.8;
        sizeBoost += ring * fade * 2.0;
      } else if (fx.w < 1.5) {
        float core = exp(-dist * dist * 7.0);
        fxCol += uFxColor[i] * core * fade * 1.6;
        bright += core * fade * 1.2;
        sizeBoost += core * fade * 5.0;
      } else {
        float shell = exp(-pow((dist - age * 1.4) * 5.0, 2.0));
        vec2 jdir = normalize(vec2(sin(position.x * 54.0 + position.y * 13.0),
                                   cos(position.y * 51.0 - position.x * 7.0)) + 1e-5);
        pos += jdir * shell * fade * 0.07;
        fxCol += uFxColor[i] * shell * fade * 0.7;
        sizeBoost += shell * fade * 2.5;
      }
    }

    vColor = mix(baseCol, uTint, uTintAmount * 0.5);
    vColor *= (0.45 + 0.30 * uEnergy);
    vColor += fxCol;
    vColor *= (1.0 + bright + presence * 0.6);

    vAlpha = smoothstep(0.0, 0.1, phase) * smoothstep(1.0, 0.82, phase);
    vAlpha *= (1.0 + presence * 0.35);
    gl_Position = vec4(pos, 0.0, 1.0);
    gl_PointSize = (1.3 + 1.8 * uEnergy + sizeBoost + presence * 0.8) * uSizeScale;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.25, 0.0, dot(c, c)) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class PresenceField extends BaseArt {
  static id = 'presence-field';
  static label = 'Presence';
  static params = [
    { key: 'count', type: 'range', label: 'Particles', min: 20000, max: 300000, step: 20000, default: 120000 },
    { key: 'size', type: 'range', label: 'Particle size', min: 0.3, max: 4, step: 0.1, default: 1 },
    { key: 'sensitivity', type: 'range', label: 'Sensitivity', min: 0.05, max: 0.5, step: 0.01, default: 0.16 },
    { key: 'pull', type: 'range', label: 'Presence pull', min: 0, max: 1, step: 0.05, default: 0.45 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.paletteShift = 0;
    this.tint = new THREE.Color('#ffffff');
    this.energy = new Eased(BASE_ENERGY, { max: 3, decay: 0.6, rise: 1.8 });
    this.tintAmount = new Eased(0, { max: 0.8, decay: 0.35, rise: 2.2 });
    this.fx = new EffectField(FX_MAX);
    this.count = 120000;
    this.phase = 'idle'; // 'idle' | 'requesting' | 'live'
    this.threshold = 0.16;
    this._maskEase = 0;
    this._calibAt = 0;
    this._frameToggle = false;

    // Attraction mask (small, CPU-built, linearly filtered on the GPU).
    const aspect = this.size.width / this.size.height;
    this.maskW = MASK_W;
    this.maskH = Math.max(8, Math.round(MASK_W / aspect));
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskW;
    this.maskCanvas.height = this.maskH;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.maskCtx.fillStyle = '#000';
    this.maskCtx.fillRect(0, 0, this.maskW, this.maskH);
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.magFilter = THREE.LinearFilter;
    this.workCanvas = document.createElement('canvas'); // video → small grid
    this.workCanvas.width = this.maskW;
    this.workCanvas.height = this.maskH;
    this.workCtx = this.workCanvas.getContext('2d', { willReadFrequently: true });
    this._bgRef = null; // empty-scene reference pixels
    this._smooth = new Float32Array(this.maskW * this.maskH); // temporal smoothing
    this._maskImage = this.maskCtx.createImageData(this.maskW, this.maskH);

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: aspect },
      uEnergy: { value: BASE_ENERGY },
      uPaletteShift: { value: 0 },
      uTint: { value: this.tint.clone() },
      uTintAmount: { value: 0 },
      uSizeScale: { value: 1 },
      uMask: { value: this.maskTex },
      uMaskOn: { value: 0 },
      uPull: { value: 0.45 },
      uFxPos: { value: Array.from({ length: FX_MAX }, () => new THREE.Vector4()) },
      uFxColor: { value: Array.from({ length: FX_MAX }, () => new THREE.Color()) },
      uFxCount: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');
    this.camera = new THREE.Camera();
    this._buildGeometry();

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

    // First tap enables the camera; later taps recapture the empty background.
    this._onTap = () => {
      if (this.phase === 'idle') this._startCamera();
      else if (this.phase === 'live') this._calibrate();
    };
    window.addEventListener('pointerdown', this._onTap);
  }

  _buildGeometry() {
    if (this.points) {
      this.scene.remove(this.points);
      this.geometry.dispose();
    }
    const n = this.count;
    const positions = new Float32Array(n * 3);
    const meta = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const sx = (Math.random() * 2 - 1) * 1.1;
      const sy = (Math.random() * 2 - 1) * 1.1;
      positions[i * 3 + 0] = sx;
      positions[i * 3 + 1] = sy;
      positions[i * 3 + 2] = Math.random();
      meta[i * 2 + 0] = 0.5 + Math.random();
      meta[i * 2 + 1] = 0.5 + 0.25 * Math.sin(sx * 2.0) + 0.22 * Math.cos(sy * 1.7) + (Math.random() - 0.5) * 0.06;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aMeta', new THREE.BufferAttribute(meta, 2));
    this.geometry = geo;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  async _startCamera() {
    this.phase = 'requesting';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      this.stream = stream;
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.autoplay = true;
      this.video.srcObject = stream;
      await this.video.play();
      this.phase = 'live';
      this._calibAt = this.time + 1.2; // auto-capture the empty scene shortly after
    } catch {
      this.phase = 'idle'; // stay a pure particle flow; tap to retry
    }
  }

  // Draw the camera into the small work grid: mirrored (selfie) + cover-crop so
  // mask space aligns 1:1 with the artwork frame.
  _drawVideo() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return false;
    const ma = this.maskW / this.maskH;
    const va = vw / vh;
    let sx, sy, sw, sh;
    if (va > ma) { sh = vh; sw = vh * ma; sx = (vw - sw) / 2; sy = 0; }
    else { sw = vw; sh = vw / ma; sx = 0; sy = (vh - sh) / 2; }
    const c = this.workCtx;
    c.save();
    c.scale(-1, 1);
    c.drawImage(this.video, sx, sy, sw, sh, -this.maskW, 0, this.maskW, this.maskH);
    c.restore();
    return true;
  }

  /** Capture the current (empty-scene) frame as the background reference. */
  _calibrate() {
    if (this.phase !== 'live' || !this._drawVideo()) return;
    this._bgRef = this.workCtx.getImageData(0, 0, this.maskW, this.maskH).data.slice();
    this._smooth.fill(0);
  }

  // Live frame → presence mask: soft-thresholded background diff, temporally
  // smoothed, lightly blurred — then uploaded as the attraction texture.
  _updateMask() {
    if (!this._bgRef || !this._drawVideo()) return;
    const cur = this.workCtx.getImageData(0, 0, this.maskW, this.maskH).data;
    const bg = this._bgRef;
    const sm = this._smooth;
    const W = this.maskW, H = this.maskH;
    const t = this.threshold;
    for (let i = 0, p = 0; i < sm.length; i++, p += 4) {
      const diff = (Math.abs(cur[p] - bg[p]) + Math.abs(cur[p + 1] - bg[p + 1]) + Math.abs(cur[p + 2] - bg[p + 2])) / 765;
      let x = (diff - t) / 0.22;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const v = x * x * (3 - 2 * x); // soft knee
      sm[i] += (v - sm[i]) * 0.35; // temporal smoothing (kills flicker)
    }
    // light 3×3 box blur → smooth gradients for the shader to climb
    const out = this._maskImage.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let acc = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            acc += sm[yy * W + xx];
            cnt++;
          }
        }
        const v = Math.min(255, Math.round((acc / cnt) * 255));
        const o = (y * W + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      }
    }
    this.maskCtx.putImageData(this._maskImage, 0, 0);
    this.maskTex.needsUpdate = true;
  }

  setParams(p) {
    if (p.size != null) this.uniforms.uSizeScale.value = p.size;
    if (p.sensitivity != null) this.threshold = p.sensitivity;
    if (p.pull != null) this.uniforms.uPull.value = p.pull;
    if (p.count != null && (p.count | 0) !== this.count) {
      this.count = p.count | 0;
      this._buildGeometry();
    }
  }

  resize(size) {
    this.size = size;
    this.uniforms.uAspect.value = size.width / size.height;
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    const fx = this.fx.spawn(event);
    if (fx) this.energy.bump(KIND_ENERGY[fx.kind]);
    if (event.type === EventTypes.FLAVOUR_SOLD) {
      this.tint.set(event.data?.color || '#ffffff');
      this.tintAmount.set(0.8);
    }
  }

  update(dt) {
    this.time += dt;
    this.paletteShift += dt * 0.01;
    this.fx.update(dt);

    if (this._calibAt && this.time >= this._calibAt) { this._calibrate(); this._calibAt = 0; }
    this._frameToggle = !this._frameToggle;
    if (this.phase === 'live' && this._frameToggle) this._updateMask(); // every 2nd frame
    const maskOn = this.phase === 'live' && this._bgRef ? 1 : 0;
    this._maskEase += (maskOn - this._maskEase) * Math.min(1, dt * 2);
    this.uniforms.uMaskOn.value = this._maskEase;

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = this.energy.update(dt);
    this.uniforms.uPaletteShift.value = this.paletteShift;
    this.uniforms.uTint.value.copy(this.tint);
    this.uniforms.uTintAmount.value = this.tintAmount.update(dt);
    this.uniforms.uFxCount.value = this.fx.write(this.uniforms.uFxPos.value, this.uniforms.uFxColor.value);

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
    this.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(PresenceField);
