// ---------------------------------------------------------------------------
// Display target: physical LED-prism wall (3D preview).
//
// Simulates the proposed hardware — a grid of spring-loaded rectangular prisms
// that rise/fall toward the viewer like a physical, moving RGB screen. Each
// prism is one instance of an InstancedMesh covering the same footprint as the
// flat target (FRAME_HEIGHT tall × FRAME_HEIGHT*aspect wide).
//
// The art texture drives the prisms ON THE GPU: the vertex shader samples the
// texture at each prism's cell centre, pushes the prism forward by the sampled
// brightness (a height-field), and tints it by the sampled colour. Sampling in
// the vertex shader avoids slow CPU pixel readback, so tens of thousands of
// prisms stay cheap. This same preview doubles as the spec for the real build.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { FRAME_HEIGHT } from './FlatTarget.js';

const MAX_DEPTH = 0.35; // max forward travel of a prism, in world units

const vertexShader = /* glsl */ `
  attribute vec3 aOffset;   // grid position of this prism's centre
  attribute vec2 aCellUv;   // where this prism samples the art texture
  uniform sampler2D uTexture;
  uniform float uDepth;
  varying vec3 vColor;
  varying vec3 vNormal;
  void main() {
    vec3 sampled = texture2D(uTexture, aCellUv).rgb; // vertex texture fetch (WebGL2)
    float lum = dot(sampled, vec3(0.299, 0.587, 0.114));
    vColor = sampled;
    vNormal = normalMatrix * normal;
    vec3 pos = position;
    pos.z += lum * uDepth;        // brighter cell ⇒ prism rises toward viewer
    vec3 world = pos + aOffset;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    float light = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.35, 0.5, 1.0))), 0.0);
    gl_FragColor = vec4(vColor * light, 1.0);
  }
`;

export class PrismTarget {
  constructor({ aspect, prism }) {
    const cols = Math.max(1, prism.cols);
    const rows = Math.max(1, prism.rows);
    const width = FRAME_HEIGHT * aspect;
    const cellW = width / cols;
    const cellH = FRAME_HEIGHT / rows;
    const depth = Math.min(cellW, cellH) * 1.5;

    // One box, reused for every instance; 0.85 leaves a gap so prisms read as discrete.
    const box = new THREE.BoxGeometry(cellW * 0.85, cellH * 0.85, depth);

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.attributes.position = box.attributes.position;
    geo.attributes.normal = box.attributes.normal;
    geo.attributes.uv = box.attributes.uv;
    box.dispose();

    const count = cols * rows;
    const offsets = new Float32Array(count * 3);
    const cellUvs = new Float32Array(count * 2);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        offsets[i * 3 + 0] = -width / 2 + (c + 0.5) * cellW;
        offsets[i * 3 + 1] = -FRAME_HEIGHT / 2 + (r + 0.5) * cellH;
        offsets[i * 3 + 2] = 0;
        cellUvs[i * 2 + 0] = (c + 0.5) / cols;
        cellUvs[i * 2 + 1] = (r + 0.5) / rows;
        i++;
      }
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aCellUv', new THREE.InstancedBufferAttribute(cellUvs, 2));
    geo.instanceCount = count;

    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null }, uDepth: { value: MAX_DEPTH } },
      vertexShader,
      fragmentShader,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // bounds change as prisms move; skip culling
  }

  setTexture(texture) {
    this.material.uniforms.uTexture.value = texture;
  }

  addTo(scene) {
    scene.add(this.mesh);
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
