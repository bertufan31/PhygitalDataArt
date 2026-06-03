// ---------------------------------------------------------------------------
// Emblem geometry — analytic (a JS twin of EMBLEM_GLSL in shaderLib.js).
//
// The shape is recreated mathematically (rounded triangle ∖ circle) rather than
// rasterised from an image, so it is razor-sharp everywhere. This module is the
// CPU side, used by the particle style to place points inside the emblem.
// ---------------------------------------------------------------------------

function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const e0x = bx - ax, e0y = by - ay;
  const e1x = cx - bx, e1y = cy - by;
  const e2x = ax - cx, e2y = ay - cy;
  const v0x = px - ax, v0y = py - ay;
  const v1x = px - bx, v1y = py - by;
  const v2x = px - cx, v2y = py - cy;
  const proj = (vx, vy, ex, ey) => {
    const t = Math.min(1, Math.max(0, (vx * ex + vy * ey) / (ex * ex + ey * ey)));
    return [vx - ex * t, vy - ey * t];
  };
  const [q0x, q0y] = proj(v0x, v0y, e0x, e0y);
  const [q1x, q1y] = proj(v1x, v1y, e1x, e1y);
  const [q2x, q2y] = proj(v2x, v2y, e2x, e2y);
  const s = Math.sign(e0x * e2y - e0y * e2x);
  // Componentwise min (matches the GLSL): nearest distance² and inside/outside sign.
  const dx = Math.min(q0x * q0x + q0y * q0y, q1x * q1x + q1y * q1y, q2x * q2x + q2y * q2y);
  const dy = Math.min(s * (v0x * e0y - v0y * e0x), s * (v1x * e1y - v1y * e1x), s * (v2x * e2y - v2y * e2x));
  return -Math.sqrt(dx) * Math.sign(dy || 1);
}

/** Signed distance to the emblem ring (centred space, y up); < 0 inside. */
export function emblemDist(x, y) {
  const tri = sdTriangle(x, y, 0.0, 0.29, -0.34, -0.255, 0.34, -0.255) - 0.15;
  const circ = Math.hypot(x, y) - 0.28;
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
