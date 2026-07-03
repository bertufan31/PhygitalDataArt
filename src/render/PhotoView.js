// ---------------------------------------------------------------------------
// PhotoView — a "store photo" mockup (Views 3 & 4).
//
// Renders a real boutique photo full-frame (letterboxed) and composites the
// live artwork onto a wall niche with correct perspective, using a homography
// quad (per-vertex projective weights) so the art sits on the wall at the right
// angle and "reads from far". The art texture is the graded output, so it
// reacts to data and respects the colour pickers like everywhere else.
//
// Each view is a CONFIG: photo url + quad corners + optional store-light warmth
// (a warm, top-lit grade so the art looks lit by the niche) + optional OCCLUDER
// polygons (photo-space) for foreground elements — e.g. the sculpted white
// waves that cross in front of the artwork in the second boutique photo.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import storeUrl from '../assets/store.jpg';
import store2Url from '../assets/store2.jpg';

// The two store mockups, keyed by viewId.
export const STORE_PHOTO_VIEWS = {
  store: {
    url: storeUrl,
    // White illuminated niche, left wall. Wall recedes right → left edge larger.
    corners: [
      [0.048, 0.322], // TL
      [0.332, 0.345], // TR
      [0.332, 0.620], // BR
      [0.048, 0.658], // BL
    ],
    warm: 0.3,
    occluders: [],
  },
  store2: {
    url: store2Url,
    // The winged-figure painting in the wavy lightbox. Wall recedes LEFT →
    // right edge is closer/taller. Top-left raised to cover the figure's hair.
    corners: [
      [0.304, 0.293], // TL
      [0.640, 0.281], // TR
      [0.640, 0.725], // BR
      [0.304, 0.695], // BL
    ],
    warm: 0.85,
    occluders: [
      // sculpted wave crossing the artwork's bottom (closed to photo bottom)
      { closeToBottom: true, points: [[0.26, 0.83], [0.30, 0.775], [0.33, 0.745], [0.36, 0.722], [0.40, 0.706], [0.44, 0.698], [0.48, 0.697], [0.52, 0.708], [0.55, 0.725], [0.58, 0.75], [0.60, 0.775], [0.63, 0.83]] },
      // wave edge clipping the artwork's top-left corner
      { points: [[0.322, 0.25], [0.315, 0.30], [0.307, 0.34], [0.300, 0.40], [0.296, 0.47], [0.295, 0.53], [0.23, 0.53], [0.23, 0.25]] },
    ],
  },
};

const artVertex = /* glsl */ `
  attribute vec3 aUVQ;
  varying vec3 vUVQ;
  varying vec2 vNdc;
  void main(){ vUVQ = aUVQ; vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const artFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uArt;
  uniform sampler2D uOcc;
  uniform float uHasOcc, uWarm;
  uniform vec2 uFit;
  varying vec3 vUVQ;
  varying vec2 vNdc;
  void main(){
    // Foreground occluders (photo-space mask): store furniture/sculpture that
    // passes IN FRONT of the artwork keeps hiding it.
    if (uHasOcc > 0.5) {
      vec2 pUv = vec2((vNdc.x / uFit.x + 1.0) * 0.5, (1.0 - vNdc.y / uFit.y) * 0.5);
      if (texture2D(uOcc, pUv).r > 0.5) discard;
    }
    vec2 uv = vUVQ.xy / vUVQ.z;             // perspective-correct
    vec3 col = texture2D(uArt, uv).rgb;
    // subtle inner shadow so it reads as a mounted, recessed piece
    vec2 c = abs(uv - 0.5) * 2.0;
    float edge = smoothstep(1.0, 0.82, max(c.x, c.y));
    col *= (0.55 + 0.45 * edge);
    // STORE LIGHT: warm, top-lit grade + an additive wash (spot glow falling on
    // the surface) so even a dark artwork visibly catches the niche lighting.
    vec3 lit = col * vec3(1.07, 1.0, 0.90) * mix(0.92, 1.30, uv.y);
    lit += vec3(0.16, 0.125, 0.085) * pow(uv.y, 1.8) * (0.35 + 0.65 * edge);
    lit += vec3(0.05, 0.04, 0.03); // ambient bounce from the lightbox
    col = mix(col, lit, uWarm);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function lineIntersect(a, b, c, d) {
  const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// Photo-space occluder polygons → a mask texture the art shader samples.
function buildOcclusionTexture(occluders) {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  for (const occ of occluders) {
    ctx.beginPath();
    occ.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * W, y * H) : ctx.lineTo(x * W, y * H)));
    if (occ.closeToBottom) {
      ctx.lineTo(occ.points[occ.points.length - 1][0] * W, H);
      ctx.lineTo(occ.points[0][0] * W, H);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export class PhotoView {
  constructor({ url, corners, warm = 0, occluders = [] }) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');
    this.camera = new THREE.Camera();
    this.photoAspect = 1.5;
    this.canvasAspect = 16 / 9;
    this.corners = corners;

    this.photoMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.photoMat);
    this.scene.add(this.photoMesh);

    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      this.photoMat.map = tex;
      this.photoMat.color.set(0xffffff);
      this.photoMat.needsUpdate = true;
      this.photoAspect = img.width / img.height;
      this.layout();
    };
    img.src = url;

    this.artUniforms = {
      uArt: { value: null },
      uOcc: { value: occluders.length ? buildOcclusionTexture(occluders) : null },
      uHasOcc: { value: occluders.length ? 1 : 0 },
      uWarm: { value: warm },
      uFit: { value: new THREE.Vector2(1, 1) },
    };
    this.artMat = new THREE.ShaderMaterial({ uniforms: this.artUniforms, vertexShader: artVertex, fragmentShader: artFragment, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.artGeo = new THREE.BufferGeometry();
    this.artGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.artGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.artGeo.setAttribute('aUVQ', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.artMesh = new THREE.Mesh(this.artGeo, this.artMat);
    this.artMesh.renderOrder = 1;
    this.scene.add(this.artMesh);

    this.layout();
  }

  setArtTexture(texture) {
    this.artUniforms.uArt.value = texture;
  }

  setCorners(corners) {
    this.corners = corners;
    this.layout();
  }

  layout(canvasAspect) {
    if (canvasAspect) this.canvasAspect = canvasAspect;
    const pa = this.photoAspect;
    const ca = this.canvasAspect;
    let fx, fy;
    if (pa >= ca) { fx = 1; fy = ca / pa; } else { fy = 1; fx = pa / ca; }
    this.photoMesh.scale.set(fx, fy, 1);
    this.artUniforms.uFit.value.set(fx, fy);

    // Photo-space corner (u,v) → NDC.
    const map = ([u, v]) => [(u * 2 - 1) * fx, (1 - v * 2) * fy];
    const P = this.corners.map(map); // TL, TR, BR, BL in NDC
    const inter = lineIntersect(P[0], P[2], P[1], P[3]);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const d0 = dist(inter, P[0]), d2 = dist(inter, P[2]);
    const d1 = dist(inter, P[1]), d3 = dist(inter, P[3]);
    const q = [(d0 + d2) / d2, (d1 + d3) / d3, (d0 + d2) / d0, (d1 + d3) / d1];
    const uv = [[0, 1], [1, 1], [1, 0], [0, 0]]; // art top → niche top

    const pos = this.artGeo.attributes.position.array;
    const uvq = this.artGeo.attributes.aUVQ.array;
    for (let i = 0; i < 4; i++) {
      pos[i * 3] = P[i][0];
      pos[i * 3 + 1] = P[i][1];
      pos[i * 3 + 2] = 0;
      uvq[i * 3] = uv[i][0] * q[i];
      uvq[i * 3 + 1] = uv[i][1] * q[i];
      uvq[i * 3 + 2] = q[i];
    }
    this.artGeo.attributes.position.needsUpdate = true;
    this.artGeo.attributes.aUVQ.needsUpdate = true;
  }

  render(renderer) {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
