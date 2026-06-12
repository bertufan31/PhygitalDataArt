// ---------------------------------------------------------------------------
// Art option: "Store Pulse" — the store's own floor plan as living data art.
//
// Built from the boutique's heatmap: the BLUEPRINT outline is sketched in
// shimmering particles, each retail ZONE breathes as a heat bloom (colour =
// dwell intensity, the classic blue→green→amber→red ramp), and TRAVELLER
// particles walk plausible visitor journeys between zones — entrance →
// welcome → curiosity table → POS → lounge — so you watch the store live.
//
// STORE_DATA below is the editable baseline (traced from the supplied heatmap
// PNG). It is deliberately plain data: when real positioning/footfall data
// arrives, regenerate zones/heat/paths from it and everything else follows.
//
// Data reactions: visitor → a surge of travellers enters + the welcome zone
// flares · sale/flavour → the POS zone blooms in the event colour · product →
// a disruption shiver runs through every zone.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { NOISE_GLSL } from '../shaderLib.js';
import { Eased } from '../effects.js';

// --- The baseline data (normalized 0..1, y up), traced from the heatmap ----
const STORE_DATA = {
  // Store walls (closed polygon) + the lounge enclosure (circle).
  outline: [
    [0.05, 0.50], [0.07, 0.90], [0.36, 0.97], [0.62, 0.97], [0.66, 0.88],
    [0.93, 0.84], [0.95, 0.55], [0.78, 0.44], [0.78, 0.18], [0.46, 0.08],
    [0.30, 0.12],
  ],
  lounge: { x: 0.81, y: 0.70, r: 0.13 },
  // Zones: heat = dwell intensity 0..1 (from the heatmap colours).
  zones: [
    { id: 'welcome', x: 0.17, y: 0.42, r: 0.105, heat: 1.0 },
    { id: 'wm-anim', x: 0.12, y: 0.66, r: 0.09, heat: 0.9 },
    { id: 'curiosity', x: 0.36, y: 0.68, r: 0.11, heat: 0.85 },
    { id: 'pos', x: 0.57, y: 0.70, r: 0.085, heat: 0.8 },
    { id: 'world', x: 0.60, y: 0.47, r: 0.085, heat: 0.65 },
    { id: 'sfp', x: 0.33, y: 0.27, r: 0.09, heat: 0.55 },
    { id: 'artwork', x: 0.16, y: 0.84, r: 0.08, heat: 0.5 },
    { id: 'coffee', x: 0.33, y: 0.90, r: 0.07, heat: 0.45 },
    { id: 'novelties', x: 0.50, y: 0.92, r: 0.07, heat: 0.4 },
    { id: 'lounge', x: 0.81, y: 0.70, r: 0.11, heat: 0.3 },
  ],
  // Visitor journeys (polylines between zones; entrance at the bottom door).
  paths: [
    [[0.40, 0.10], [0.27, 0.30], [0.17, 0.44], [0.13, 0.66], [0.16, 0.84], [0.33, 0.90]],
    [[0.40, 0.10], [0.26, 0.33], [0.30, 0.52], [0.36, 0.68], [0.48, 0.71], [0.57, 0.70]],
    [[0.36, 0.68], [0.44, 0.84], [0.50, 0.92], [0.56, 0.82], [0.57, 0.70]],
    [[0.57, 0.70], [0.60, 0.55], [0.68, 0.58], [0.76, 0.66], [0.81, 0.70]],
    [[0.40, 0.10], [0.37, 0.20], [0.33, 0.28], [0.46, 0.38], [0.60, 0.46]],
    [[0.17, 0.44], [0.27, 0.56], [0.36, 0.68]],
  ],
};
const ZONE_WELCOME = 0;
const ZONE_POS = 3;
const ZONE_FLOOR = 11; // pseudo-zone for the dim floor plate (never flares)
const MAX_ZONES = 12;
const PATH_SAMPLES = 32;

function insidePoly(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) hit = !hit;
  }
  return hit;
}

// Particle roles: outline sketch, heat bloom, traveller.
const vertexShader = /* glsl */ `
  precision highp float;
  attribute vec2 aP0;              // outline/heat: base pos · traveller: (pathV, perpAmp)
  attribute vec3 aP1;              // outline: (phase,·,·) heat: (heat, phase, zone) trav: (speed, phase0, jitter)
  attribute float aRole;           // 0 outline · 1 heat · 2 traveller
  uniform float uTime, uHeat, uActivity, uSize, uSurge, uShake;
  uniform vec3 uFlareColor;
  uniform vec2 uFit;
  uniform float uFlares[${MAX_ZONES}];
  uniform sampler2D uPaths;
  varying vec3 vColor;
  varying float vAlpha;

  ${NOISE_GLSL}

  // Heatmap ramp: cool blue → teal → amber → hot red.
  vec3 heatRamp(float t){
    vec3 c = mix(vec3(0.08, 0.25, 0.85), vec3(0.10, 0.75, 0.70), smoothstep(0.0, 0.35, t));
    c = mix(c, vec3(1.0, 0.72, 0.18), smoothstep(0.35, 0.7, t));
    c = mix(c, vec3(1.0, 0.16, 0.07), smoothstep(0.7, 1.0, t));
    return c;
  }

  void main(){
    vec2 pos;
    float size = 1.0;
    if (aRole < 0.5) {
      // BLUEPRINT OUTLINE: shimmering technical sketch of the walls.
      pos = aP0;
      pos += 0.0025 * vec2(snoise(pos * 30.0 + uTime * 0.6 + aP1.x),
                           snoise(pos * 30.0 - uTime * 0.5 + aP1.x + 7.0));
      float tw = 0.7 + 0.3 * sin(uTime * 1.4 + aP1.x * 6.2831);
      vColor = vec3(0.5, 0.8, 1.0) * (0.8 + 0.4 * tw);
      vAlpha = 0.85 * tw;
      size = 1.7;
    } else if (aRole < 1.5) {
      // HEAT BLOOM: dwell-time energy breathing in place.
      pos = aP0;
      float heat = aP1.x * uHeat;
      int zi = int(aP1.z + 0.5);
      float flare = uFlares[zi];
      // local swirl — hotter zones are busier; disruption (uShake) scatters
      vec2 swirl = curl(pos * 5.0 + uTime * (0.10 + 0.35 * heat));
      pos += swirl * (0.006 + 0.022 * heat + 0.05 * uShake);
      float breathe = 0.75 + 0.25 * sin(uTime * (0.8 + heat * 1.6) + aP1.y * 6.2831);
      float h = clamp(heat * breathe + flare * 0.7, 0.0, 1.4);
      vColor = heatRamp(min(h, 1.0)) * (0.65 + 0.9 * h + flare);
      // a flaring zone blooms in the EVENT colour (flavour identity at POS)
      vColor = mix(vColor, uFlareColor * (1.0 + flare), clamp(flare, 0.0, 1.0) * 0.65);
      vAlpha = 0.16 + 0.5 * h + 0.4 * flare;
      size = 1.4 + 2.4 * h + 2.5 * flare;
    } else {
      // TRAVELLER: a visitor walking a journey path.
      float u = fract(aP1.y + uTime * aP1.x * 0.03 * uActivity * (1.0 + uSurge * 0.6));
      vec2 p = texture2D(uPaths, vec2(u, aP0.x)).xy;
      vec2 ahead = texture2D(uPaths, vec2(min(u + 0.03, 1.0), aP0.x)).xy;
      vec2 tang = normalize(ahead - p + 1e-5);
      vec2 perp = vec2(-tang.y, tang.x);
      p += perp * aP0.y * (0.5 + 0.5 * snoise(vec2(u * 9.0, aP1.z * 20.0)));
      pos = (p - 0.5) * 2.0 * uFit;
      float head = smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.92, u); // fade at door
      vColor = vec3(1.0, 0.96, 0.86) * (0.8 + 0.9 * uSurge);
      vAlpha = (0.4 + 0.4 * sin(uTime * 3.0 + aP1.z * 6.2831)) * head;
      size = 1.7 + 1.2 * uSurge;
    }
    gl_Position = vec4(pos, 0.0, 1.0);
    gl_PointSize = size * uSize;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uFlareColor;
  uniform float uPosFlare;
  varying vec3 vColor;
  varying float vAlpha;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c)) * vAlpha;
    vec3 col = vColor;
    // sale/flavour: the flare colour washes warm over everything slightly
    col = mix(col, uFlareColor * (length(vColor) + 0.4), uPosFlare * 0.25);
    gl_FragColor = vec4(col * a, a);
  }
`;

export class StorePulse extends BaseArt {
  static id = 'store-pulse';
  static label = 'Store Pulse';
  static archived = true; // lower-priority — tucked under the Archive disclosure
  static params = [
    { key: 'count', type: 'range', label: 'Particles', min: 20000, max: 150000, step: 10000, default: 60000 },
    { key: 'size', type: 'range', label: 'Particle size', min: 0.3, max: 3, step: 0.1, default: 1 },
    { key: 'activity', type: 'range', label: 'Activity', min: 0.2, max: 3, step: 0.1, default: 1 },
    { key: 'heat', type: 'range', label: 'Heat', min: 0.2, max: 2, step: 0.05, default: 1 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.aspect = this.size.width / this.size.height;
    this.time = 0;
    this.count = 60000;

    this.surge = new Eased(0, { max: 1.5, decay: 0.8, rise: 5 });
    this.shake = new Eased(0, { max: 1, decay: 1.2, rise: 6 });
    this.posFlare = new Eased(0, { max: 1, decay: 0.9, rise: 6 });
    this.flares = STORE_DATA.zones.map(() => 0);

    this.uniforms = {
      uTime: { value: 0 },
      uHeat: { value: 1 },
      uActivity: { value: 1 },
      uSize: { value: 1 },
      uSurge: { value: 0 },
      uShake: { value: 0 },
      uPosFlare: { value: 0 },
      uFlareColor: { value: new THREE.Color('#ffd36b') },
      uFit: { value: new THREE.Vector2(1, 1) },
      uFlares: { value: new Float32Array(MAX_ZONES) },
      uPaths: { value: this._bakePaths() },
    };
    this._layoutFit();

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
  }

  // Fit the (square-ish) plan into the frame with margin; map 0..1 → clip.
  _layoutFit() {
    const planAspect = 1.4; // the floor plan's natural width/height
    const sy = 0.92;
    const sx = Math.min(0.96, (sy * planAspect) / this.aspect);
    this.uniforms.uFit.value.set(sx, sy);
  }

  // Resample each journey polyline to PATH_SAMPLES points → one texture row.
  _bakePaths() {
    const P = STORE_DATA.paths;
    const data = new Float32Array(PATH_SAMPLES * P.length * 4);
    P.forEach((poly, row) => {
      const segs = [];
      let total = 0;
      for (let i = 1; i < poly.length; i++) {
        const len = Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
        segs.push(len);
        total += len;
      }
      for (let s = 0; s < PATH_SAMPLES; s++) {
        let want = (s / (PATH_SAMPLES - 1)) * total;
        let i = 0;
        while (i < segs.length - 1 && want > segs[i]) { want -= segs[i]; i++; }
        const t = segs[i] > 0 ? want / segs[i] : 0;
        const x = poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t;
        const y = poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t;
        const k = (row * PATH_SAMPLES + s) * 4;
        data[k] = x; data[k + 1] = y;
      }
    });
    const tex = new THREE.DataTexture(data, PATH_SAMPLES, P.length, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  _buildGeometry() {
    if (this.points) { this.scene.remove(this.points); this.geometry.dispose(); }
    const n = this.count;
    const nOutline = Math.floor(n * 0.2);
    const nFloor = Math.floor(n * 0.22);
    const nTravel = Math.floor(n * 0.18);
    const nHeat = n - nOutline - nFloor - nTravel;
    const p0 = new Float32Array(n * 2);
    const p1 = new Float32Array(n * 3);
    const role = new Float32Array(n);
    const fit = this.uniforms.uFit.value;
    const toClip = (x, y) => [(x - 0.5) * 2 * fit.x, (y - 0.5) * 2 * fit.y];
    let i = 0;

    // 1) Blueprint outline (walls + lounge circle), spread by arc length.
    const ring = [...STORE_DATA.outline, STORE_DATA.outline[0]];
    const segLen = [];
    let perim = 0;
    for (let s = 1; s < ring.length; s++) {
      const L = Math.hypot(ring[s][0] - ring[s - 1][0], ring[s][1] - ring[s - 1][1]);
      segLen.push(L); perim += L;
    }
    const loungeShare = 0.22;
    for (let k = 0; k < nOutline; k++, i++) {
      let x, y;
      if (Math.random() < loungeShare) {
        const a = Math.random() * Math.PI * 2;
        const L = STORE_DATA.lounge;
        x = L.x + Math.cos(a) * L.r;
        y = L.y + Math.sin(a) * L.r * 1.05;
      } else {
        let want = Math.random() * perim;
        let s = 0;
        while (s < segLen.length - 1 && want > segLen[s]) { want -= segLen[s]; s++; }
        const t = segLen[s] > 0 ? want / segLen[s] : 0;
        x = ring[s][0] + (ring[s + 1][0] - ring[s][0]) * t;
        y = ring[s][1] + (ring[s + 1][1] - ring[s][1]) * t;
      }
      const c = toClip(x, y);
      p0[i * 2] = c[0]; p0[i * 2 + 1] = c[1];
      p1[i * 3] = Math.random();
      role[i] = 0;
    }

    // 2) Floor plate: a dim cool carpet inside the walls — makes the plan read.
    const ob = STORE_DATA.outline;
    const xs = ob.map((p) => p[0]), ys = ob.map((p) => p[1]);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs);
    const by0 = Math.min(...ys), by1 = Math.max(...ys);
    let placed = 0, guard = 0;
    while (placed < nFloor && guard < nFloor * 40) {
      guard++;
      const x = bx0 + Math.random() * (bx1 - bx0);
      const y = by0 + Math.random() * (by1 - by0);
      const L = STORE_DATA.lounge;
      const inLounge = Math.hypot(x - L.x, y - L.y) < L.r;
      if (!insidePoly(x, y, ob) && !inLounge) continue;
      const c = toClip(x, y);
      p0[i * 2] = c[0]; p0[i * 2 + 1] = c[1];
      p1[i * 3] = 0.13 + Math.random() * 0.07; // faint cool blue
      p1[i * 3 + 1] = Math.random();
      p1[i * 3 + 2] = ZONE_FLOOR;
      role[i] = 1;
      i++; placed++;
    }

    // 3) Heat blooms — particle count per zone scales with its heat.
    const zones = STORE_DATA.zones;
    const heatEnd = n - nTravel; // heat fills everything up to the travellers
    const weights = zones.map((z) => 0.25 + z.heat * z.heat);
    const wSum = weights.reduce((a, b) => a + b, 0);
    for (let z = 0; z < zones.length; z++) {
      const zn = zones[z];
      const cnt = Math.floor((weights[z] / wSum) * nHeat);
      for (let k = 0; k < cnt && i < heatEnd; k++, i++) {
        // gaussian-ish radial spread
        const a = Math.random() * Math.PI * 2;
        const r = zn.r * Math.sqrt(Math.random()) * (0.5 + 0.7 * Math.random());
        const c = toClip(zn.x + Math.cos(a) * r * 1.15, zn.y + Math.sin(a) * r);
        p0[i * 2] = c[0]; p0[i * 2 + 1] = c[1];
        p1[i * 3] = zn.heat * (0.75 + Math.random() * 0.4);
        p1[i * 3 + 1] = Math.random();
        p1[i * 3 + 2] = z;
        role[i] = 1;
      }
    }
    while (i < heatEnd) { // fill any rounding remainder into zone 0
      const zn = zones[0];
      const a = Math.random() * Math.PI * 2;
      const r = zn.r * Math.sqrt(Math.random());
      const c = toClip(zn.x + Math.cos(a) * r, zn.y + Math.sin(a) * r);
      p0[i * 2] = c[0]; p0[i * 2 + 1] = c[1];
      p1[i * 3] = zn.heat; p1[i * 3 + 1] = Math.random(); p1[i * 3 + 2] = 0;
      role[i] = 1; i++;
    }

    // 3) Travellers — busier paths (toward hot zones) get more walkers.
    const nPaths = STORE_DATA.paths.length;
    for (let k = 0; k < nTravel; k++, i++) {
      const row = (Math.random() * nPaths) | 0;
      p0[i * 2] = (row + 0.5) / nPaths;                 // path texture V
      p0[i * 2 + 1] = (Math.random() * 2 - 1) * 0.018;  // walking-lane offset
      p1[i * 3] = 0.6 + Math.random() * 0.9;            // pace
      p1[i * 3 + 1] = Math.random();                    // phase along journey
      p1[i * 3 + 2] = Math.random();                    // personal jitter
      role[i] = 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aP0', new THREE.BufferAttribute(p0, 2));
    geo.setAttribute('aP1', new THREE.BufferAttribute(p1, 3));
    geo.setAttribute('aRole', new THREE.BufferAttribute(role, 1));
    geo.setDrawRange(0, n); // no 'position' attr → explicit draw count
    this.geometry = geo;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  setParams(p) {
    if (p.size != null) this.uniforms.uSize.value = p.size;
    if (p.activity != null) this.uniforms.uActivity.value = p.activity;
    if (p.heat != null) this.uniforms.uHeat.value = p.heat;
    if (p.count != null && (p.count | 0) !== this.count) { this.count = p.count | 0; this._buildGeometry(); }
  }

  resize(size) {
    this.size = size;
    this.aspect = size.width / size.height;
    this._layoutFit();
    this._buildGeometry(); // re-fit base positions to the new frame
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    switch (event.type) {
      case EventTypes.VISITOR_ENTERED:
        this.surge.bump(1.4);                 // a wave of walkers comes in
        this.uniforms.uFlareColor.value.set('#eaf6ff'); // welcome flares cool white
        this.flares[ZONE_WELCOME] = Math.min(1.6, this.flares[ZONE_WELCOME] + 1.1);
        break;
      case EventTypes.SALE_MADE:
      case EventTypes.FLAVOUR_SOLD:
        this.uniforms.uFlareColor.value.set(event.data?.color || '#ffd36b');
        this.posFlare.bump(1);
        this.flares[ZONE_POS] = Math.min(1.8, this.flares[ZONE_POS] + 1.4); // POS blooms
        break;
      case EventTypes.PRODUCT_SOLD:
        this.shake.bump(1);                   // disruption shiver across the plan
        break;
    }
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uSurge.value = this.surge.update(dt);
    this.uniforms.uShake.value = this.shake.update(dt);
    this.uniforms.uPosFlare.value = this.posFlare.update(dt);
    const uf = this.uniforms.uFlares.value;
    for (let i = 0; i < this.flares.length; i++) {
      this.flares[i] = Math.max(0, this.flares[i] - dt * 1.1); // flare decay
      uf[i] = this.flares[i];
    }
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this.renderTarget.texture; }

  destroy() {
    this.geometry.dispose();
    this.material.dispose();
    this.uniforms.uPaths.value.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(StorePulse);
