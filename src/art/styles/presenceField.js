// ---------------------------------------------------------------------------
// Art option: "Presence" (camera + human silhouette).
//
// Uses the room camera to reflect the people in front of the piece INTO the
// artwork: their silhouette becomes a luminous, brand-coloured field that
// shimmers and glows at the edges. A visitor sees themselves abstracted into
// the data art — a literal "phygital" mirror.
//
// HUMAN / BACKGROUND SEPARATION — chosen approach: in-browser BACKGROUND
// SUBTRACTION. On start we grab a reference frame of the empty scene; each live
// frame is diffed against it and thresholded into a presence mask. Why this and
// not a segmentation model:
//   • fully offline (no model download) — works on GitHub Pages and in-store;
//   • private — the video never leaves the device (nothing is uploaded);
//   • fast + dependency-free.
// Upgrade path (documented, not wired): swap the diff for MediaPipe Selfie
// Segmentation to get crisp person edges in a busy/!static scene — the rest of
// the pipeline (mask → shimmer → grade) stays the same.
//
// Privacy + activation: getUserMedia needs a user gesture + secure context, so
// the piece shows a "tap to enable camera" prompt and starts on the first tap.
// Tapping again re-captures the background (recalibrate). All self-contained.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { Eased, KIND_ENERGY } from '../effects.js';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uLive;
  uniform sampler2D uBg;
  uniform float uTime, uEnergy, uThresh, uVideoAspect, uFrameAspect, uHasBg;
  ${NOISE_GLSL}
  // "contain" fit + horizontal mirror (selfie view), so the whole person reads.
  vec2 fitUv(vec2 uv){
    vec2 s = uv - 0.5;
    float ratio = uVideoAspect / max(uFrameAspect, 1e-4);
    if (ratio > 1.0) s.x /= ratio; else s.y *= ratio;
    s.x = -s.x;                       // mirror
    return s + 0.5;
  }
  void main(){
    vec2 uv = fitUv(vUv);
    vec3 live = texture2D(uLive, uv).rgb;
    vec3 bg   = texture2D(uBg, uv).rgb;
    // Presence = how much this pixel differs from the empty-scene reference.
    float diff = length(live - bg);
    float mask = uHasBg * smoothstep(uThresh, uThresh + 0.14, diff);

    // Flowing shimmer inside the silhouette (premium, alive).
    float flow = fbm(uv * 4.0 + vec2(uTime * 0.25, -uTime * 0.18));
    float body = mask * (0.55 + 0.45 * flow);
    // Edge glow: bright rim where the mask falls off.
    float edge = smoothstep(0.0, 0.25, mask) * (1.0 - smoothstep(0.25, 0.75, mask));
    float lum = body + edge * 0.9;
    lum *= (0.85 + 0.5 * uEnergy);     // data events brighten the presence
    vec3 col = vec3(0.82, 0.9, 1.0) * lum;  // near-white; the grade applies brand colour
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PresenceField extends BaseArt {
  static id = 'presence-field';
  static label = 'Presence';
  static params = [
    { key: 'threshold', type: 'range', label: 'Sensitivity', min: 0.05, max: 0.6, step: 0.01, default: 0.18 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.phase = 'idle'; // 'idle' | 'requesting' | 'live' | 'error'
    this.energy = new Eased(0.0, { max: 2, decay: 0.7, rise: 2.0 });
    this._calibAt = 0;

    // Live shimmer pass.
    this.uniforms = {
      uLive: { value: null },
      uBg: { value: null },
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uThresh: { value: 0.18 },
      uVideoAspect: { value: 1 },
      uFrameAspect: { value: this.size.width / this.size.height },
      uHasBg: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    // Idle/error prompt is drawn with the 2D canvas API (easy text) and shown
    // as a texture, so the output texture stays stable for the grade.
    this.promptCanvas = document.createElement('canvas');
    this.promptCanvas.width = 1024;
    this.promptCanvas.height = Math.round(1024 * this.size.height / this.size.width);
    this.promptTex = new THREE.CanvasTexture(this.promptCanvas);
    this.promptTex.colorSpace = THREE.SRGBColorSpace;
    this.promptMat = new THREE.MeshBasicMaterial({ map: this.promptTex });
    this.promptQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.promptMat);
    this._drawPrompt('Tap anywhere to enable the camera', 'Your video never leaves this device.');

    // Background reference (captured empty-scene frame).
    this.bgCanvas = document.createElement('canvas');
    this.bgTex = new THREE.CanvasTexture(this.bgCanvas);
    this.bgTex.colorSpace = THREE.SRGBColorSpace;
    this.uniforms.uBg.value = this.bgTex;

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

    // First tap starts the camera; later taps recalibrate the background.
    this._onTap = () => {
      if (this.phase === 'idle' || this.phase === 'error') this._startCamera();
      else if (this.phase === 'live') this._calibrate();
    };
    window.addEventListener('pointerdown', this._onTap);
  }

  _drawPrompt(title, sub) {
    const c = this.promptCanvas, x = c.getContext('2d');
    x.fillStyle = '#05060a'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#cfe6ff'; x.textAlign = 'center';
    x.font = `${Math.round(c.width * 0.045)}px ui-sans-serif, system-ui, sans-serif`;
    x.fillText(title, c.width / 2, c.height / 2);
    x.fillStyle = '#7790ad';
    x.font = `${Math.round(c.width * 0.026)}px ui-sans-serif, system-ui, sans-serif`;
    x.fillText(sub, c.width / 2, c.height / 2 + c.width * 0.06);
    if (this.promptTex) this.promptTex.needsUpdate = true;
  }

  async _startCamera() {
    if (this.phase === 'requesting' || this.phase === 'live') return;
    this.phase = 'requesting';
    this._drawPrompt('Starting camera…', 'Allow camera access when prompted.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      this.stream = stream;
      this.video = document.createElement('video');
      this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true;
      this.video.srcObject = stream;
      await this.video.play();
      this.liveTex = new THREE.VideoTexture(this.video);
      this.liveTex.colorSpace = THREE.SRGBColorSpace;
      this.uniforms.uLive.value = this.liveTex;
      this.uniforms.uVideoAspect.value = (this.video.videoWidth || 16) / (this.video.videoHeight || 9);
      this.phase = 'live';
      this._calibAt = this.time + 1.2; // auto-capture the empty-scene background shortly after start
    } catch (err) {
      this.phase = 'error';
      this._drawPrompt('Camera unavailable', 'Tap to retry — check permissions / device.');
    }
  }

  // Capture the current frame as the empty-scene reference.
  _calibrate() {
    if (!this.video || !this.video.videoWidth) return;
    this.bgCanvas.width = this.video.videoWidth;
    this.bgCanvas.height = this.video.videoHeight;
    this.bgCanvas.getContext('2d').drawImage(this.video, 0, 0);
    this.bgTex.needsUpdate = true;
    this.uniforms.uHasBg.value = 1;
  }

  setParams(p) {
    if (p.threshold != null) this.uniforms.uThresh.value = p.threshold;
  }

  resize(size) {
    this.size = size;
    this.uniforms.uFrameAspect.value = size.width / size.height;
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    const kind = { visitor_entered: 0, sale_made: 1, product_sold: 2, flavour_sold: 1 }[event.type] ?? 0;
    this.energy.bump(KIND_ENERGY[kind] ?? 1);
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = this.energy.update(dt);
    if (this._calibAt && this.time >= this._calibAt) { this._calibrate(); this._calibAt = 0; }

    this.renderer.setRenderTarget(this.renderTarget);
    if (this.phase === 'live') this.renderer.render(this.scene, this.camera);
    else this.renderer.render(this._promptScene(), this.camera);
    this.renderer.setRenderTarget(null);
  }

  _promptScene() {
    if (!this._ps) { this._ps = new THREE.Scene(); this._ps.add(this.promptQuad); }
    return this._ps;
  }

  get texture() { return this.renderTarget.texture; }

  destroy() {
    window.removeEventListener('pointerdown', this._onTap);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) { this.video.srcObject = null; }
    if (this.liveTex) this.liveTex.dispose();
    this.promptTex.dispose();
    this.promptMat.dispose();
    this.promptQuad.geometry.dispose();
    this.bgTex.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(PresenceField);
