// ---------------------------------------------------------------------------
// Art option: "Slipstream" — a brand wind-tunnel.
//
// A completely different language from the other pieces: instead of a cloud or
// a rotating point-logo, this is DIRECTIONAL FLOW. Luminous particle streamlines
// stream left → right (a constant sense of forward motion) and the active
// brand's mark sits in the airflow as an AERODYNAMIC BODY. The wind parts around
// it, accelerates into a bright rim along its edges, and sheds an unsteady wake
// downstream — so the logo is never "drawn", it is REVEALED by how the wind
// wraps it (negative space + edge-light + wake). Long motion-blur trails (a
// feedback buffer) give the windy streak look.
//
// Inspirations: wind-tunnel smoke/streamline visualisation, Viégas & Wattenberg's
// Wind Map, Anadol's wind/weather "living paintings", Universal Everything's
// forward-moving figures. Researched June 2026.
//
// Technique: the brand silhouette (IQOS emblem SDF, or the ZYN/VEEV polygon
// silhouettes) is baked CPU-side into a small VELOCITY FIELD texture — base
// wind + flow that goes around / is ejected from the body, plus a rim term.
// The vertex shader advects each particle L→R and integrates a few steps of the
// field (+ time-varying turbulence and a downstream wake), so the cloud routes
// around the mark in real time. Brand changes cross-fade two field textures, so
// the wind visibly re-routes from one mark to the next. Colour is carried by the
// duotone grade, so the active brand palette themes the whole tunnel.
//
// Data reactions: visitor → a bright vertical GUST sweeps through; sale/flavour
// → a pressure FLASH; product → a TURBULENCE burst (vortex shedding spikes).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { Eased } from '../effects.js';
import { emblemDist } from '../../core/shape.js';
import { hasBrandSilhouette, brandSignedDistance } from '../../core/brandShapes.js';

const FIELD_W = 200;      // baked velocity-field grid (kept small; rebaked on brand change)
const FIELD_H = 116;
const OBS = 1.2;          // body fills ~60% of frame height
const OBS_OFF = 0.16;     // body sits slightly upwind so the wake streams off-frame
const BAND = 0.22;        // how far the body's influence reaches into the flow

// Selectable wind directions (logos always stay upright; only the wind turns).
const DIRS = { right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1] };

// Per-glyph readability scale: wide wordmarks need to occupy more of the frame.
const GLYPH_SCALE = { zyn: 1.75, veev: 1.15 };

// Particles advect quickly left→right; the feedback trail buffer smears their
// motion into flowing wind streaks. The baked field routes them around the body.
const vertexShader = /* glsl */ `
  precision highp float;
  attribute vec2 aSeed;            // x = phase along the tunnel, y = entry lane
  attribute vec3 aRand;            // speed, size, sparkle
  uniform float uTime, uAspect, uWind, uMix, uTurb, uWake, uFlash, uStreak;
  uniform vec2  uDir;              // wind direction (unit, cardinal)
  uniform vec3  uGust;             // x = sweep position, y = intensity, z = width
  uniform sampler2D uFieldA, uFieldB;
  varying float vBright;
  varying float vAlpha;

  ${NOISE_GLSL}

  vec4 field(vec2 p){
    vec2 uv = p * 0.5 + 0.5;
    return mix(texture2D(uFieldA, uv), texture2D(uFieldB, uv), uMix);
  }

  void main(){
    float speed = aRand.x;
    float ph = fract(aSeed.x + uTime * speed * uWind * 0.28);  // travel across → motion smear
    vec2 perp = vec2(-uDir.y, uDir.x);
    vec2 pos = uDir * (-1.25 + ph * 2.5) + perp * aSeed.y;     // advect along the wind, looping

    // Integrate a few steps of the baked flow so the stream routes around the
    // body (cheap — texture taps only).
    float rim = 0.0, spd = 1.0;
    for (int s = 0; s < 6; s++) {
      vec4 f = field(pos);
      spd = length(f.xy);
      rim = max(rim, f.w);
      pos += f.xy * 0.026;
    }
    // Turbulence frays the stream, and the wake only kicks in well PAST the
    // body (so it never fuzzes the glyph itself).
    float along = dot(pos, uDir);
    float behind = smoothstep(0.42, 1.05, along + ${OBS_OFF.toFixed(2)});
    pos += (curl(pos * 2.6 + uTime * 0.35) * uTurb
          + curl(pos * 5.0 - uTime * 0.7) * uWake * behind) * 0.13;

    // Particles still inside the body vanish → the glyph stays a clean void.
    float keep = smoothstep(-0.02, 0.015, field(pos).z);

    // GUST: a bright band sweeping along the wind (visitor events).
    float gust = exp(-pow((along - uGust.x) / max(uGust.z, 1e-3), 2.0)) * uGust.y;
    float edge = clamp(rim, 0.0, 1.0);
    // Low per-point alpha + a long trail buffer = luminous streamlines over dark
    // gaps. Calm flow is faint; speed, edge-rim and gusts glow.
    vBright = (0.5 + 0.75 * spd + edge * 1.7 + gust * 1.8 + uFlash * 0.5) * (0.7 + 0.6 * aRand.z);
    vAlpha = clamp(0.035 + 0.10 * spd + edge * 0.6 + gust * 0.6, 0.0, 1.0) * keep;
    gl_Position = vec4(pos, 0.0, 1.0);
    gl_PointSize = (0.8 + 1.3 * spd + edge * 1.3 + gust * 2.0) * uStreak * aRand.y;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uFlash;
  uniform vec3 uFlashColor;
  varying float vBright;
  varying float vAlpha;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c)) * vAlpha;
    // Cool-white streak; the duotone grade tints it to the active brand.
    vec3 col = vec3(0.62, 0.8, 1.0) * vBright;
    // Sale / flavour: the whole wind ignites in the event colour. Multiplicative
    // tint so even the bloomed-white areas turn the colour (additive mixing
    // alone would wash it out), and saturation survives the duotone grade.
    col *= mix(vec3(1.0), uFlashColor * 1.7, clamp(uFlash, 0.0, 1.0));
    gl_FragColor = vec4(col * a, a);
  }
`;

// Fullscreen fade pass for the motion-blur trail (prev frame × fade). During a
// sale/flavour flash it also tints the HISTORY toward the event colour each
// frame (compounds quickly), so the whole accumulated wind ignites visibly.
const fadeFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uFade, uTintAmt;
  uniform vec3 uTint;
  void main(){
    vec3 c = texture2D(uTex, vUv).rgb * uFade;
    c *= mix(vec3(1.0), uTint * 1.25, uTintAmt);
    gl_FragColor = vec4(c, 1.0);
  }
`;
const fadeVertex = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class Slipstream extends BaseArt {
  static id = 'slipstream';
  static label = 'Slipstream';
  static brandTheme = true; // palette/background follow the active brand
  static params = [
    { key: 'count', type: 'range', label: 'Streaks', min: 20000, max: 200000, step: 10000, default: 70000 },
    { key: 'streak', type: 'range', label: 'Streak size', min: 0.3, max: 3, step: 0.1, default: 1 },
    { key: 'wind', type: 'range', label: 'Wind speed', min: 0.2, max: 2.5, step: 0.1, default: 1 },
    {
      key: 'direction', type: 'select', label: 'Wind direction', default: 'right',
      options: [
        { value: 'right', label: '→ Right' },
        { value: 'left', label: '← Left' },
        { value: 'up', label: '↑ Up' },
        { value: 'down', label: '↓ Down' },
      ],
    },
    { key: 'trails', type: 'range', label: 'Trails', min: 0.6, max: 0.97, step: 0.01, default: 0.94 },
    { key: 'turbulence', type: 'range', label: 'Turbulence', min: 0, max: 0.5, step: 0.02, default: 0.08 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.aspect = this.size.width / this.size.height;
    this.time = 0;
    this.count = 70000;
    this.brandId = null;
    this.dirName = 'right';
    this._dirV = DIRS.right;

    this.flash = new Eased(0, { max: 1.2, decay: 0.7, rise: 6 });
    this.turbBoost = new Eased(0, { max: 0.5, decay: 0.7, rise: 4 });
    this.gust = { x: -2, v: 0 }; // gust front sweeping along the wind (visitor)

    this.uniforms = {
      uTime: { value: 0 },
      uAspect: { value: this.aspect },
      uWind: { value: 1 },
      uMix: { value: 0 },
      uTurb: { value: 0.08 },
      uWake: { value: 0.12 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color('#ffd36b') },
      uStreak: { value: 1 },
      uDir: { value: new THREE.Vector2(1, 0) },
      uGust: { value: new THREE.Vector3(-2, 0, 0.12) },
      uFieldA: { value: null },
      uFieldB: { value: null },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this._buildGeometry();

    // Baked velocity-field textures (ping-pong for smooth brand cross-fade).
    this.fieldTex = [this._makeFieldTexture(), this._makeFieldTexture()];
    this._showB = false; // which slot is the live target of uMix
    this._bake(this.brandId, this.fieldTex[0]);
    this._bake(this.brandId, this.fieldTex[1]);
    this.uniforms.uFieldA.value = this.fieldTex[0];
    this.uniforms.uFieldB.value = this.fieldTex[1];

    // Motion-blur trail buffers (feedback) — smear motion into wind streaks.
    this.fade = 0.94;
    this._trail = [this._makeRT(), this._makeRT()];
    this._cur = 0;
    this.fadeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: null }, uFade: { value: this.fade },
        uTint: { value: this.uniforms.uFlashColor.value }, uTintAmt: { value: 0 },
      },
      vertexShader: fadeVertex, fragmentShader: fadeFragment, depthTest: false, depthWrite: false,
    });
    this.fadeScene = new THREE.Scene();
    this.fadeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMat));
  }

  _makeRT() {
    const rt = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: THREE.HalfFloatType,
    });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }

  _makeFieldTexture() {
    const tex = new THREE.DataTexture(new Float32Array(FIELD_W * FIELD_H * 4), FIELD_W, FIELD_H, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // Signed distance to the active brand body in obstacle space (~[-0.5,0.5]).
  // Glyphs get a per-brand readability scale (wide wordmarks render larger).
  _obstacle(brandId, ox, oy) {
    if (hasBrandSilhouette(brandId)) {
      const s = GLYPH_SCALE[brandId] || 1;
      const d = brandSignedDistance(brandId, ox / s, oy / s);
      return d == null ? 1 : d * s;
    }
    return emblemDist(ox, oy); // IQOS emblem (analytic)
  }

  // Bake the wind field for `brandId` into `tex`: base wind (current direction)
  // + go-around / ejection flow + a rim term, from the body's signed distance.
  _bake(brandId, tex) {
    const W = FIELD_W, H = FIELD_H, A = this.aspect;
    const [dx, dy] = this._dirV;
    const ocx = -OBS_OFF * dx, ocy = -OBS_OFF * dy;  // body sits slightly upwind
    const sdf = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const cy = ((j + 0.5) / H) * 2 - 1;          // clip y (up), matches texture v
      for (let i = 0; i < W; i++) {
        const cx = ((i + 0.5) / W) * 2 - 1;
        const ox = ((cx - ocx) * A) / OBS;          // undistorted (logo stays upright)
        const oy = (cy - ocy) / OBS;
        sdf[j * W + i] = this._obstacle(brandId, ox, oy);
      }
    }
    const data = tex.image.data;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const d = sdf[k];
        const il = sdf[j * W + Math.max(0, i - 1)], ir = sdf[j * W + Math.min(W - 1, i + 1)];
        const jd = sdf[Math.max(0, j - 1) * W + i], ju = sdf[Math.min(H - 1, j + 1) * W + i];
        let nx = ir - il, ny = ju - jd;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;   // outward normal
        let vx = dx, vy = dy;                                      // base wind
        const influence = d < 0 ? 1 : Math.max(0, 1 - d / BAND);
        if (d < 0) {
          const push = 1 + -d * 7;                                // eject from inside the body
          vx = nx * push; vy = ny * push;
        } else if (influence > 0) {
          const vn = vx * nx + vy * ny;
          if (vn < 0) { vx -= nx * vn * influence; vy -= ny * vn * influence; } // no penetration
          vx += nx * influence * 0.45; vy += ny * influence * 0.45;             // splay around
          let tx = -ny, ty = nx;
          if (tx * dx + ty * dy < 0) { tx = -tx; ty = -ty; }                    // tangent downwind
          vx += tx * influence * 0.5; vy += ty * influence * 0.5;               // edge speed-up
        }
        const edge = Math.exp(-Math.abs(d) * 14);                 // crisp rim along the body
        data[k * 4] = vx; data[k * 4 + 1] = vy; data[k * 4 + 2] = d; data[k * 4 + 3] = edge;
      }
    }
    tex.needsUpdate = true;
  }

  _buildGeometry() {
    if (this.points) { this.scene.remove(this.points); this.geometry.dispose(); }
    const n = this.count;
    const seed = new Float32Array(n * 2);
    const rand = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      seed[i * 2] = Math.random();                      // phase along the tunnel
      seed[i * 2 + 1] = (Math.random() * 2 - 1) * 1.05; // entry lane
      rand[i * 3] = 0.6 + Math.random() * 0.9;          // speed
      rand[i * 3 + 1] = 0.7 + Math.random() * 1.1;      // size
      rand[i * 3 + 2] = Math.random();                  // sparkle
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 3));
    geo.setDrawRange(0, n); // no 'position' attr → tell THREE how many points to draw
    this.geometry = geo;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /** Brand morphing: rebake the body into the hidden field slot and cross-fade. */
  setBrand(brandId) {
    if (brandId === this.brandId) return;
    this.brandId = brandId;
    if (!this.fieldTex) return;
    const slot = this._showB ? 0 : 1;          // bake into whichever slot we're fading toward
    this._bake(brandId, this.fieldTex[slot]);
    this._showB = !this._showB;
    this._mixTarget = this._showB ? 1 : 0;     // ease uMix toward the new slot
  }

  setParams(p) {
    if (p.streak != null) this.uniforms.uStreak.value = p.streak;
    if (p.wind != null) this.uniforms.uWind.value = p.wind;
    if (p.turbulence != null) this._turb = p.turbulence;
    if (p.trails != null) { this.fade = p.trails; if (this.fadeMat) this.fadeMat.uniforms.uFade.value = p.trails; }
    if (p.direction != null && p.direction !== this.dirName && DIRS[p.direction]) {
      this.dirName = p.direction;
      this._dirV = DIRS[p.direction];
      this.uniforms.uDir.value.set(this._dirV[0], this._dirV[1]);
      if (this.fieldTex) { // rebake both slots for the new wind direction
        this._bake(this.brandId, this.fieldTex[0]);
        this._bake(this.brandId, this.fieldTex[1]);
      }
    }
    if (p.count != null && (p.count | 0) !== this.count) { this.count = p.count | 0; this._buildGeometry(); }
  }

  resize(size) {
    this.size = size;
    this.aspect = size.width / size.height;
    this.uniforms.uAspect.value = this.aspect;
    this._trail.forEach((rt) => rt.setSize(size.width, size.height));
    this._bake(this.brandId, this.fieldTex[0]);
    this._bake(this.brandId, this.fieldTex[1]);
  }

  onEvent(event) {
    switch (event.type) {
      case EventTypes.VISITOR_ENTERED:
        this.gust.x = -1.2; this.gust.v = 1;       // launch a gust that sweeps across
        break;
      case EventTypes.SALE_MADE:
      case EventTypes.FLAVOUR_SOLD:
        // The wind ignites in the event colour (flavour colour, or warm gold).
        this.uniforms.uFlashColor.value.set(event.data?.color || '#ffd36b');
        this.flash.bump(1.2);
        break;
      case EventTypes.PRODUCT_SOLD:
        this.turbBoost.bump(0.5);                   // vortex-shedding burst
        break;
    }
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;

    // Smooth brand cross-fade.
    if (this._mixTarget != null) {
      const m = this.uniforms.uMix.value;
      const nm = m + (this._mixTarget - m) * Math.min(1, dt * 1.4);
      this.uniforms.uMix.value = nm;
      if (Math.abs(nm - this._mixTarget) < 0.001) { this.uniforms.uMix.value = this._mixTarget; this._mixTarget = null; }
    }

    // Eased data reactions.
    this.uniforms.uFlash.value = this.flash.update(dt);
    this.uniforms.uTurb.value = (this._turb ?? 0.14) + this.turbBoost.update(dt);
    if (this.gust.v > 0) {
      this.gust.x += dt * 1.6;                      // sweep left → right
      const g = this.uniforms.uGust.value;
      g.x = this.gust.x;
      g.y = this.gust.v * Math.max(0, 1 - (this.gust.x - -1.2) / 2.6);
      if (this.gust.x > 1.4) this.gust.v = 0;
    } else {
      this.uniforms.uGust.value.y *= Math.max(0, 1 - dt * 4);
    }

    // Trail feedback: fade previous frame, add this frame's particles on top.
    // During a flash the fade pass also tints the history toward the event colour.
    this.fadeMat.uniforms.uTintAmt.value = Math.min(1, this.uniforms.uFlash.value) * 0.16;
    const prev = this._trail[this._cur];
    const next = this._trail[1 - this._cur];
    this.fadeMat.uniforms.uTex.value = prev.texture;
    this.renderer.setRenderTarget(next);
    this.renderer.autoClear = true;
    this.renderer.render(this.fadeScene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(null);
    this._cur = 1 - this._cur;
  }

  get texture() { return this._trail[this._cur].texture; }

  destroy() {
    this.geometry.dispose();
    this.material.dispose();
    this.fadeMat.dispose();
    this._trail.forEach((rt) => rt.dispose());
    this.fieldTex.forEach((t) => t.dispose());
  }
}

registerArt(Slipstream);
