// ---------------------------------------------------------------------------
// Emblem geometry — analytic (a JS twin of EMBLEM_GLSL in shaderLib.js).
//
// The shape is recreated mathematically (rounded triangle ∖ circle) rather than
// rasterised from an image, so it is razor-sharp everywhere. This module is the
// CPU side, used by the particle style to place points inside the emblem.
// ---------------------------------------------------------------------------

function sdTriEq(px, py, r) {
  const k = Math.sqrt(3.0);
  px = Math.abs(px) - r;
  py = py + r / k;
  if (px + k * py > 0.0) {
    const nx = (px - k * py) / 2.0;
    const ny = (-k * px - py) / 2.0;
    px = nx;
    py = ny;
  }
  px -= Math.min(0.0, Math.max(-2.0 * r, px));
  return -Math.hypot(px, py) * Math.sign(py || 1);
}

/** Signed distance to the emblem ring (centred space, y up); < 0 inside. */
export function emblemDist(x, y) {
  const tri = sdTriEq(x, y - 0.04, 0.28) - 0.175;
  const circ = Math.hypot(x, y + 0.02) - 0.335;
  return Math.max(tri, -circ);
}

/** Inside-ness (positive inside) — used for particle depth. */
export function sdfAt(x, y) {
  return Math.max(0, -emblemDist(x, y));
}

/** Rejection-sample n points inside the emblem → Float32Array [x,y,...] in ~[-0.5,0.5]. */
export function samplePoints(n) {
  const out = new Float32Array(n * 2);
  let i = 0;
  let guard = 0;
  while (i < n && guard < n * 90) {
    guard++;
    const x = (Math.random() * 2 - 1) * 0.6;
    const y = (Math.random() * 2 - 1) * 0.6;
    if (emblemDist(x, y) < 0) {
      out[i * 2] = x;
      out[i * 2 + 1] = y;
      i++;
    }
  }
  return out;
}
