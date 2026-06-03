// ---------------------------------------------------------------------------
// PhotoView — the "store photo" mockup (View 2).
//
// Renders the real boutique photo full-frame (letterboxed) and composites the
// live artwork onto the white illuminated niche on the left wall, using a
// homography quad (per-vertex projective weights) so the art sits on the wall
// at the right angle and "reads from far". The art texture is the graded output,
// so it reacts to data and respects the colour pickers like everywhere else.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import storeUrl from '../assets/store.jpg';

// Wall-niche corners in PHOTO space (0..1, origin top-left): TL, TR, BR, BL.
// Mapped to the white illuminated lightbox niche on the left wall, as a
// landscape piece (matches the placement the user drew). The camera sits
// centre-right, so the niche's right edge is nearer → slightly taller; the
// left edge is farther → slightly shorter. These give it true wall perspective.
const DEFAULT_CORNERS = [
  [0.050, 0.345],  // TL
  [0.333, 0.330],  // TR
  [0.335, 0.628],  // BR
  [0.050, 0.612],  // BL
];

const artVertex = /* glsl */ `
  attribute vec3 aUVQ;
  varying vec3 vUVQ;
  void main(){ vUVQ = aUVQ; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const artFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uArt;
  varying vec3 vUVQ;
  void main(){
    vec2 uv = vUVQ.xy / vUVQ.z;             // perspective-correct
    vec3 col = texture2D(uArt, uv).rgb;
    // subtle inner shadow so it reads as a mounted, recessed piece
    vec2 c = abs(uv - 0.5) * 2.0;
    float edge = smoothstep(1.0, 0.82, max(c.x, c.y));
    gl_FragColor = vec4(col * (0.55 + 0.45 * edge), 1.0);
  }
`;

function lineIntersect(a, b, c, d) {
  const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export class PhotoView {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');
    this.camera = new THREE.Camera();
    this.photoAspect = 1.305;
    this.canvasAspect = 16 / 9;
    this.corners = DEFAULT_CORNERS;

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
    img.src = storeUrl;

    this.artUniforms = { uArt: { value: null } };
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
