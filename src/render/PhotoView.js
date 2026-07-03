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
    // A FRAMED LED panel mounted in front of the wavy lightbox (per the
    // reference render): bold perspective, wall receding left → right edge
    // closer/taller; verticals lean with the scene. Corners = the OUTER frame
    // quad (measured off the reference); the screen is derived by insetting
    // through the quad's homography so the bezel stays perspective-exact.
    corners: [
      [0.291, 0.213], // TL
      [0.749, 0.088], // TR
      [0.752, 0.752], // BR
      [0.307, 0.662], // BL
    ],
    warm: 0.12,
    occluders: [],
    frame: { inset: [0.042, 0.055], color: '#c9c6c0' },
    shadow: true,
    // The boutique's own canvas artwork hangs where the panel goes and pokes
    // out under it — heal it out of the photo so the niche reads clean.
    heal: [[0.31, 0.595, 0.678, 0.778]],
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

// Bezel of the mounted panel — same homography, shaded like brushed alu.
// uInner = the screen-edge inset in frame UV, per axis; e is the edge distance
// normalized so 1.0 sits exactly on the screen seam whatever the bezel aspect.
const frameFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec2 uInner;
  varying vec3 vUVQ;
  varying vec2 vNdc;
  void main(){
    vec2 uv = vUVQ.xy / vUVQ.z;
    vec2 n = min(uv, 1.0 - uv) / uInner;
    float e = min(n.x, n.y);
    vec3 col = uColor * (0.90 + 0.18 * uv.y);                    // lit from above
    col *= 0.70 + 0.30 * smoothstep(0.0, 0.30, e);               // outer edge rim
    col *= 1.0 - 0.45 * exp(-pow((e - 1.0) / 0.22, 2.0));        // seam by the screen
    // hint of the box's underside along the bottom border (seen from below)
    col *= 1.0 - 0.20 * smoothstep(uInner.y * 0.55, 0.0, uv.y);
    gl_FragColor = vec4(col, 1.0);
  }
`;
// Soft drop shadow behind the panel, so it visibly stands off the wall.
const shadowFragment = /* glsl */ `
  precision highp float;
  varying vec3 vUVQ;
  varying vec2 vNdc;
  void main(){
    vec2 uv = vUVQ.xy / vUVQ.z;
    float a = 0.38 * (1.0 - smoothstep(0.30, 0.52, length(uv - 0.5)));
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;

// Expand a photo-space quad outward (optionally shifted down) — used for the
// drop shadow behind the panel. The quad is the perspective image of a wall
// rectangle, so the expansion is done on THAT rectangle: new corners stay on
// the diagonals through the vanishing centre at cross-ratio-correct distances.
function expandQuad(corners, grow, dv = 0) {
  const C = corners;
  const inter = lineIntersect(C[0], C[2], C[1], C[3]);
  const out = [];
  const pair = (i, j) => {
    const dA = Math.hypot(inter[0] - C[i][0], inter[1] - C[i][1]);
    const dB = Math.hypot(inter[0] - C[j][0], inter[1] - C[j][1]);
    // Rectangle-diagonal position a (0 at corner i, 1 at corner j, centre 0.5)
    // → screen-space fraction along the photo diagonal.
    const s = (a) => (a * dA) / (a * dA + (1 - a) * dB);
    const at = (f) => [C[i][0] + f * (C[j][0] - C[i][0]), C[i][1] + f * (C[j][1] - C[i][1]) + dv];
    out[i] = at(s(-grow / 2));
    out[j] = at(s(1 + grow / 2));
  };
  pair(0, 2);
  pair(1, 3);
  return out;
}

function lineIntersect(a, b, c, d) {
  const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// Homography of a quad: (s,t) in the unit square → photo coords, with
// (0,0)→BL, (1,0)→BR, (1,1)→TR, (0,1)→TL (matching the art's UV layout).
function quadMap(corners) {
  const [tl, tr, br, bl] = corners;
  const [p00, p10, p11, p01] = [bl, br, tr, tl];
  const dx1 = p10[0] - p11[0], dy1 = p10[1] - p11[1];
  const dx2 = p01[0] - p11[0], dy2 = p01[1] - p11[1];
  const dx3 = p00[0] - p10[0] + p11[0] - p01[0];
  const dy3 = p00[1] - p10[1] + p11[1] - p01[1];
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  const a = p10[0] - p00[0] + g * p10[0];
  const b = p01[0] - p00[0] + h * p01[0];
  const c = p00[0];
  const d = p10[1] - p00[1] + g * p10[1];
  const e = p01[1] - p00[1] + h * p01[1];
  const f = p00[1];
  return (s, t) => {
    const w = g * s + h * t + 1;
    return [(a * s + b * t + c) / w, (d * s + e * t + f) / w];
  };
}

// The screen quad inside a frame quad: inset the unit square by (ix, iy) and
// map it through the frame's homography → bezel widths stay perspective-true.
function insetQuad(corners, [ix, iy]) {
  const H = quadMap(corners);
  return [H(ix, 1 - iy), H(1 - ix, 1 - iy), H(1 - ix, iy), H(ix, iy)]; // TL,TR,BR,BL
}

// Paint photo regions over with a smooth per-scanline blend of the wall tones
// just outside them — removes the boutique's own artwork behind the mounted
// panel so the niche reads clean (the reference render has no canvas there).
function healRegions(img, regions) {
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  for (const [u0, v0, u1, v1] of regions) {
    const x0 = Math.round(u0 * W), y0 = Math.round(v0 * H);
    const w = Math.round((u1 - u0) * W), h = Math.round((v1 - v0) * H);
    const pad = Math.max(4, Math.round(W * 0.005));
    const src = ctx.getImageData(x0 - pad, y0, w + 2 * pad, h);
    const d = src.data, sw = w + 2 * pad;
    // Per-row colours of the bands just left/right of the region, then a small
    // vertical blur over them so photo grain doesn't turn into streaks.
    const edge = (x0off, dir) => {
      const raw = new Float32Array(h * 3);
      for (let y = 0; y < h; y++)
        for (let ch = 0; ch < 3; ch++) {
          let s = 0;
          for (let x = 0; x < pad; x++) s += d[(y * sw + x0off + dir * x) * 4 + ch];
          raw[y * 3 + ch] = s / pad;
        }
      const out = new Float32Array(h * 3), k = 6;
      for (let y = 0; y < h; y++)
        for (let ch = 0; ch < 3; ch++) {
          let s = 0, n = 0;
          for (let j = -k; j <= k; j++) {
            const yy = y + j;
            if (yy >= 0 && yy < h) { s += raw[yy * 3 + ch]; n++; }
          }
          out[y * 3 + ch] = s / n;
        }
      return out;
    };
    const L = edge(0, 1), R = edge(sw - 1, -1);
    const fe = 12; // feather (px) so the patch melts into the photo
    for (let y = 0; y < h; y++) {
      const ey = Math.min(1, Math.min(y, h - 1 - y) / fe);
      for (let x = 0; x < w; x++) {
        const e = Math.min(ey, Math.min(1, Math.min(x, w - 1 - x) / fe + 0.35));
        const t = (x + 0.5) / w;
        const i = (y * sw + x + pad) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const fill = L[y * 3 + ch] * (1 - t) + R[y * 3 + ch] * t;
          d[i + ch] = d[i + ch] * (1 - e) + fill * e;
        }
      }
    }
    ctx.putImageData(src, x0 - pad, y0);
  }
  return c;
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
  constructor({ url, corners, warm = 0, occluders = [], frame = null, shadow = false, heal = [] }) {
    this.frameCfg = frame;
    this.shadowCfg = shadow;
    this.healCfg = heal;
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
      const source = this.healCfg.length ? healRegions(img, this.healCfg) : img;
      const tex = new THREE.Texture(source);
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
    this.artMesh.renderOrder = 3;
    this.scene.add(this.artMesh);

    const makeQuad = (mat, order) => {
      const geo = new THREE.BufferGeometry();
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setAttribute('aUVQ', new THREE.BufferAttribute(new Float32Array(12), 3));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = order;
      this.scene.add(mesh);
      return { geo, mesh };
    };
    if (this.shadowCfg) {
      this.shadowMat = new THREE.ShaderMaterial({ vertexShader: artVertex, fragmentShader: shadowFragment, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      this.shadowQuad = makeQuad(this.shadowMat, 1);
    }
    if (this.frameCfg) {
      this.frameMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(this.frameCfg.color || '#c9cbce') },
          uInner: { value: new THREE.Vector2(...this.frameCfg.inset) },
        },
        vertexShader: artVertex, fragmentShader: frameFragment, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      this.frameQuad = makeQuad(this.frameMat, 2);
    }

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

    // Photo-space corner (u,v) → NDC, then per-vertex projective weights so the
    // quad's UVs interpolate perspective-correct. Same routine for every quad.
    const map = ([u, v]) => [(u * 2 - 1) * fx, (1 - v * 2) * fy];
    const writeQuad = (geo, cornersPhoto) => {
      const P = cornersPhoto.map(map); // TL, TR, BR, BL in NDC
      const inter = lineIntersect(P[0], P[2], P[1], P[3]);
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const d0 = dist(inter, P[0]), d2 = dist(inter, P[2]);
      const d1 = dist(inter, P[1]), d3 = dist(inter, P[3]);
      const q = [(d0 + d2) / d2, (d1 + d3) / d3, (d0 + d2) / d0, (d1 + d3) / d1];
      const uv = [[0, 1], [1, 1], [1, 0], [0, 0]]; // art top → niche top

      const pos = geo.attributes.position.array;
      const uvq = geo.attributes.aUVQ.array;
      for (let i = 0; i < 4; i++) {
        pos[i * 3] = P[i][0];
        pos[i * 3 + 1] = P[i][1];
        pos[i * 3 + 2] = 0;
        uvq[i * 3] = uv[i][0] * q[i];
        uvq[i * 3 + 1] = uv[i][1] * q[i];
        uvq[i * 3 + 2] = q[i];
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aUVQ.needsUpdate = true;
    };

    // With a frame, `corners` is the OUTER bezel quad and the screen (art)
    // quad is inset through its homography; without one, it's the art itself.
    const artCorners = this.frameCfg ? insetQuad(this.corners, this.frameCfg.inset) : this.corners;
    writeQuad(this.artGeo, artCorners);
    if (this.frameQuad) writeQuad(this.frameQuad.geo, this.corners);
    if (this.shadowQuad) writeQuad(this.shadowQuad.geo, expandQuad(this.corners, 0.10, 0.018));
  }

  render(renderer) {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
