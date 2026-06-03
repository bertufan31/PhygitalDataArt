// ---------------------------------------------------------------------------
// Shape asset — the IQOS emblem (rounded triangle with a circular cut-out),
// extracted as a vector path from the supplied PDF.
//
// At startup it rasterises the emblem once to:
//   • a MASK texture (white shape on black),
//   • a signed-distance FIELD (DataTexture, R = 0.5±dist) for soft shading,
//   • ImageData, for CPU point-sampling (the particle style).
// Both textures use flipY=false so they share orientation; shape shaders sample
// with v flipped to put the apex up. Preloaded before the Stage (see display.js).
// ---------------------------------------------------------------------------

import * as THREE from 'three';

const PATH_D = [
  'M286.144 314.211 L327.723 240.454 L369.303 166.698',
  'C390.214 129.571 387.539 87.959 369.303 55.566',
  'C351.066 23.173 317.025 -0.001 275.202 -0.001 L192.044 -0.001 L108.886 -0.001',
  'C67.064 -0.001 33.265 23.173 14.786 55.566',
  'C-3.694 87.959 -6.126 129.820 14.786 166.698 L56.365 240.454 L98.187 314.211',
  'C119.098 351.338 155.571 369.777 192.287 369.777',
  'C228.760 369.777 265.233 351.338 286.144 314.211 Z',
  'M192.287 305.490 C153.140 305.490 117.639 289.293 91.865 262.880',
  'C66.091 236.468 50.286 200.088 50.286 159.970 C50.286 119.853 66.091 83.473 91.865 57.061',
  'C117.639 30.648 153.140 14.451 192.287 14.451 C231.435 14.451 266.935 30.648 292.709 57.061',
  'C318.484 83.473 334.045 120.102 334.045 160.220 C334.045 200.337 318.240 236.717 292.466 263.130',
  'C266.692 289.543 231.435 305.490 192.287 305.490 Z',
].join(' ');

let cache = null;
export function getShape() {
  return cache;
}

export function loadShape(size = 512) {
  if (cache) return Promise.resolve(cache);
  return new Promise((resolve) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 384 384' width='${size}' height='${size}'><g transform='translate(0,392.223) scale(1,-1)' fill='#ffffff' fill-rule='evenodd'><path d='${PATH_D}'/></g></svg>`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, size, size); // transparent bg → shape alpha marks "inside"
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size);

      const maskTexture = new THREE.CanvasTexture(canvas);
      maskTexture.flipY = false;
      maskTexture.minFilter = THREE.LinearFilter;
      maskTexture.magFilter = THREE.LinearFilter;

      const { texture: sdfTexture, data: sdfData } = computeSDF(data, size);
      cache = { size, canvas, data, maskTexture, sdfTexture, sdfData };
      resolve(cache);
    };
    img.onerror = () => resolve((cache = { size, data: null }));
    img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  });
}

/** Rejection-sample n points inside the shape → Float32Array [x,y,...] in [-1,1] (apex up). */
export function samplePoints(n) {
  const out = new Float32Array(n * 2);
  if (!cache || !cache.data) return out;
  const { data, size } = cache;
  let i = 0;
  let guard = 0;
  while (i < n && guard < n * 60) {
    guard++;
    const px = (Math.random() * size) | 0;
    const py = (Math.random() * size) | 0;
    if (data.data[(py * size + px) * 4 + 3] > 127) {
      out[i * 2 + 0] = (px / size - 0.5) * 2;
      out[i * 2 + 1] = (0.5 - py / size) * 2; // row 0 (top) → +y
      i++;
    }
  }
  return out;
}

/** Inside-ness (signed-distance, normalised) at a sample point in [-1,1] space. */
export function sdfAt(x, y) {
  if (!cache || !cache.sdfData) return 0;
  const { size, sdfData } = cache;
  const px = Math.min(size - 1, Math.max(0, Math.round((x * 0.5 + 0.5) * size)));
  const py = Math.min(size - 1, Math.max(0, Math.round((0.5 - y * 0.5) * size)));
  return sdfData[py * size + px];
}

// --- Felzenszwalb exact Euclidean distance transform → signed field ---------
function edt1d(f, n) {
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
  return d;
}
function dt2d(grid, w, h) {
  const f = new Float64Array(Math.max(w, h));
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    const d = edt1d(f, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    const d = edt1d(f, w);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
}
function computeSDF(imageData, size) {
  const w = size, h = size, INF = 1e20;
  const inside = new Float64Array(w * h);
  const outside = new Float64Array(w * h);
  const a = imageData.data;
  for (let i = 0; i < w * h; i++) {
    const isIn = a[i * 4 + 3] > 127;
    inside[i] = isIn ? 0 : INF;
    outside[i] = isIn ? INF : 0;
  }
  dt2d(inside, w, h);
  dt2d(outside, w, h);
  const data = new Float32Array(w * h);
  const buf = new Uint8Array(w * h * 4);
  const range = size * 0.16;
  for (let i = 0; i < w * h; i++) {
    const signed = Math.sqrt(outside[i]) - Math.sqrt(inside[i]); // + inside, - outside
    const nrm = Math.max(-1, Math.min(1, signed / range));
    data[i] = nrm;
    const u = Math.round((nrm * 0.5 + 0.5) * 255);
    buf[i * 4] = u; buf[i * 4 + 1] = u; buf[i * 4 + 2] = u; buf[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, data };
}
