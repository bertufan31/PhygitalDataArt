// ---------------------------------------------------------------------------
// Art option: "Data Threads".
//
// A data-visualisation piece: category anchors along the top fan thousands of
// thin threads down to scattered dots, crossing in the middle. Reads explicitly
// as "this is your store data" — strong for the pitch.
//
// Three distinct data reactions (art/effects.js):
//   visitor → RIPPLE (a bright ring sweeps the threads) · sale/flavour → BLAST
//   (threads near the burst light up/recolour) · product → DISRUPTION (threads
//   are yanked/scattered at a shock front). Flavour also dyes the weave.
// Global energy/tint are eased so new data never flashes the whole field.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { EffectField, KIND_ENERGY, Eased } from '../effects.js';

const THREADS = 1400;
const NCAT = 7;
const FX_MAX = 8;

// Shared GLSL: palette + per-vertex position (drift + disruption) + colour
// (category hue, brighter at top, plus ripple/blast/disruption + flavour tint).
const CORE = /* glsl */ `
  #define FX_MAX ${FX_MAX}
  uniform float uTime, uEnergy, uPaletteShift, uTintAmount;
  uniform vec3  uTint;
  uniform vec4  uFxPos[FX_MAX];
  uniform vec3  uFxColor[FX_MAX];
  uniform int   uFxCount;

  vec3 palette(float t){
    vec3 a = vec3(0.5, 0.4, 0.45);
    vec3 b = vec3(0.5, 0.45, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0, 0.15, 0.30);
    return a + b * cos(6.28318 * (c * t + d));
  }

  vec3 threadPos(vec3 base, float end, float phase){
    vec3 p = base;
    p.x += end * (0.05 + 0.05 * uEnergy) * sin(uTime * 0.5 + phase * 6.2831);
    p.y += end * 0.03 * sin(uTime * 0.37 + phase * 4.0);
    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      if (uFxPos[i].w < 1.5) continue;            // disruption only
      vec2 c = uFxPos[i].xy * 2.0 - 1.0;
      float dist = distance(p.xy, c);
      float age = uFxPos[i].z;
      float shell = exp(-pow((dist - age * 1.4) * 5.0, 2.0));
      vec2 jd = normalize(vec2(sin(phase * 51.0), cos(phase * 37.0)) + 1e-5);
      p.xy += jd * shell * (1.0 - age) * 0.06;
    }
    return p;
  }

  vec3 threadColor(vec3 wp, float idc, float end){
    vec3 col = palette(idc + uPaletteShift) * (0.45 + 0.7 * (1.0 - end));
    col *= (0.6 + 0.4 * uEnergy);
    for (int i = 0; i < FX_MAX; i++) {
      if (i >= uFxCount) break;
      vec4 fx = uFxPos[i];
      vec2 c = fx.xy * 2.0 - 1.0;
      float dist = distance(wp.xy, c);
      float age = fx.z;
      float fade = 1.0 - age;
      if (fx.w < 0.5) {
        col += uFxColor[i] * exp(-pow((dist - age * 1.3) * 4.0, 2.0)) * fade * 1.3;
      } else if (fx.w < 1.5) {
        float core = exp(-dist * dist * 7.0);
        col = mix(col, uFxColor[i], clamp(core * fade, 0.0, 1.0));
        col += uFxColor[i] * core * fade * 0.6;
      } else {
        col += uFxColor[i] * exp(-pow((dist - age * 1.4) * 5.0, 2.0)) * fade * 0.9;
      }
    }
    return mix(col, uTint, uTintAmount * 0.4);
  }
`;

const lineVertex = /* glsl */ `
  precision highp float;
  attribute float aId; attribute float aEnd; attribute float aPhase;
  varying vec3 vColor; varying float vEnd;
  ${CORE}
  void main(){
    vec3 p = threadPos(position, aEnd, aPhase);
    vColor = threadColor(p, aId, aEnd);
    vEnd = aEnd;
    gl_Position = vec4(p.xy, 0.0, 1.0);
  }
`;
const lineFragment = /* glsl */ `
  precision highp float;
  varying vec3 vColor; varying float vEnd;
  void main(){
    float a = mix(0.45, 0.10, vEnd);   // bright at the top anchors, faint at the dots
    gl_FragColor = vec4(vColor * a, a);
  }
`;
const dotVertex = /* glsl */ `
  precision highp float;
  attribute float aId; attribute float aPhase;
  varying vec3 vColor;
  ${CORE}
  void main(){
    vec3 p = threadPos(position, 1.0, aPhase);
    vColor = threadColor(p, aId, 1.0);
    gl_Position = vec4(p.xy, 0.0, 1.0);
    gl_PointSize = 2.0 + 2.5 * uEnergy;
  }
`;
const dotFragment = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c));
    gl_FragColor = vec4(vColor * a, a * 0.9);
  }
`;

export class DataThreads extends BaseArt {
  static id = 'data-threads';
  static label = 'Data Threads';

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.paletteShift = 0;
    this.tint = new THREE.Color('#ffffff');
    this.energy = new Eased(0.5, { max: 3, decay: 0.5, rise: 2.0 });
    this.tintAmount = new Eased(0, { max: 0.85, decay: 0.4, rise: 2.5 });
    this.fx = new EffectField(FX_MAX);

    const linePos = new Float32Array(THREADS * 2 * 3);
    const lineId = new Float32Array(THREADS * 2);
    const lineEnd = new Float32Array(THREADS * 2);
    const linePhase = new Float32Array(THREADS * 2);
    const dotPos = new Float32Array(THREADS * 3);
    const dotId = new Float32Array(THREADS);
    const dotPhase = new Float32Array(THREADS);

    for (let i = 0; i < THREADS; i++) {
      const cat = (Math.random() * NCAT) | 0;
      const topX = -0.85 + (cat / (NCAT - 1)) * 1.7 + (Math.random() - 0.5) * 0.05;
      const topY = 0.9;
      const botX = (Math.random() * 2 - 1) * 0.95;
      const botY = -0.95 + Math.random() * 1.0;
      const idc = cat / (NCAT - 1) + (Math.random() - 0.5) * 0.04;
      const phase = Math.random();

      // line: two vertices (top anchor, bottom dot)
      const a = i * 2;
      linePos[a * 3 + 0] = topX; linePos[a * 3 + 1] = topY; linePos[a * 3 + 2] = 0;
      linePos[(a + 1) * 3 + 0] = botX; linePos[(a + 1) * 3 + 1] = botY; linePos[(a + 1) * 3 + 2] = 0;
      lineId[a] = idc; lineId[a + 1] = idc;
      lineEnd[a] = 0; lineEnd[a + 1] = 1;
      linePhase[a] = phase; linePhase[a + 1] = phase;

      dotPos[i * 3 + 0] = botX; dotPos[i * 3 + 1] = botY; dotPos[i * 3 + 2] = 0;
      dotId[i] = idc; dotPhase[i] = phase;
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('aId', new THREE.BufferAttribute(lineId, 1));
    lineGeo.setAttribute('aEnd', new THREE.BufferAttribute(lineEnd, 1));
    lineGeo.setAttribute('aPhase', new THREE.BufferAttribute(linePhase, 1));

    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    dotGeo.setAttribute('aId', new THREE.BufferAttribute(dotId, 1));
    dotGeo.setAttribute('aPhase', new THREE.BufferAttribute(dotPhase, 1));

    // One uniforms object shared by both materials.
    this.uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0.5 },
      uPaletteShift: { value: 0 },
      uTint: { value: this.tint.clone() },
      uTintAmount: { value: 0 },
      uFxPos: { value: Array.from({ length: FX_MAX }, () => new THREE.Vector4()) },
      uFxColor: { value: Array.from({ length: FX_MAX }, () => new THREE.Color()) },
      uFxCount: { value: 0 },
    };
    const common = { uniforms: this.uniforms, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending };
    this.lineMat = new THREE.ShaderMaterial({ ...common, vertexShader: lineVertex, fragmentShader: lineFragment });
    this.dotMat = new THREE.ShaderMaterial({ ...common, vertexShader: dotVertex, fragmentShader: dotFragment });

    this.lines = new THREE.LineSegments(lineGeo, this.lineMat);
    this.dots = new THREE.Points(dotGeo, this.dotMat);
    this.lines.frustumCulled = false;
    this.dots.frustumCulled = false;
    this.lineGeo = lineGeo;
    this.dotGeo = dotGeo;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070a12');
    this.camera = new THREE.Camera();
    this.scene.add(this.lines, this.dots);

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  resize(size) {
    this.size = size;
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    const fx = this.fx.spawn(event);
    if (fx) this.energy.bump(KIND_ENERGY[fx.kind]);
    if (event.type === EventTypes.FLAVOUR_SOLD) {
      this.tint.set(event.data?.color || '#ffffff');
      this.tintAmount.set(0.85);
    }
  }

  update(dt) {
    this.time += dt;
    this.paletteShift += dt * 0.01;
    this.fx.update(dt);

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
    this.lineGeo.dispose();
    this.dotGeo.dispose();
    this.lineMat.dispose();
    this.dotMat.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(DataThreads);
