// ---------------------------------------------------------------------------
// Brand silhouettes — particle morph targets for "brand morphing".
//
// Real, normalized outlines baked from the supplied brand assets
// (see brandSilhouettes.data.js, regenerated from ZYN_Logo.pdf / VEEV_Global.pdf):
//   • veev → the first "V" of the wordmark
//   • zyn  → the Z + Y + N wordmark (union of three letter polygons)
//
// This mirrors core/shape.js so the particle layer can sample either the emblem
// or a brand form through the same interface. IQOS has no silhouette here — it
// uses the analytic emblem (the brand's mark already lives in core/shape.js).
// ---------------------------------------------------------------------------

import { BRAND_SILHOUETTES } from './brandSilhouettes.data.js';

function bbox(polys) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  return { minx, miny, maxx, maxy };
}

// Ray-casting point-in-polygon; a point is "inside" the glyph if it falls inside
// any of the brand's polygons (the letters/marks don't overlap or contain holes).
function inside(x, y, polys) {
  for (const poly of polys) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) hit = !hit;
    }
    if (hit) return true;
  }
  return false;
}

/** True if this brand provides a particle silhouette (zyn / veev). */
export function hasBrandSilhouette(brandId) {
  return !!BRAND_SILHOUETTES[brandId];
}

function segDist(px, py, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const wx = px - ax, wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey + 1e-12)));
  const dx = wx - ex * t, dy = wy - ey * t;
  return Math.hypot(dx, dy);
}

/**
 * Signed distance to the brand silhouette (negative inside), in the same
 * normalized ~[-0.5,0.5] space as sampleBrandPoints. Used to build the
 * "obstacle in the wind" field. Returns null when the brand has no silhouette.
 */
export function brandSignedDistance(brandId, x, y) {
  const sil = BRAND_SILHOUETTES[brandId];
  if (!sil) return null;
  let dmin = Infinity;
  for (const poly of sil.polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const d = segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
      if (d < dmin) dmin = d;
    }
  }
  return inside(x, y, sil.polys) ? -dmin : dmin;
}

/**
 * Rejection-sample n points inside the brand silhouette.
 * @returns {Float32Array | null} [x,y,...] in ~[-0.5,0.5] (y up), or null.
 */
export function sampleBrandPoints(brandId, n) {
  const sil = BRAND_SILHOUETTES[brandId];
  if (!sil) return null;
  const { minx, miny, maxx, maxy } = bbox(sil.polys);
  const w = maxx - minx, h = maxy - miny;
  const out = new Float32Array(n * 2);
  let i = 0, guard = 0;
  const maxTries = n * 200;
  while (i < n && guard < maxTries) {
    guard++;
    const x = minx + Math.random() * w;
    const y = miny + Math.random() * h;
    if (inside(x, y, sil.polys)) {
      out[i * 2] = x;
      out[i * 2 + 1] = y;
      i++;
    }
  }
  // If the glyph is sparse and we ran out of tries, wrap existing samples so the
  // caller always gets a full buffer.
  for (let k = i; k < n && i > 0; k++) {
    const src = (k % i) * 2;
    out[k * 2] = out[src];
    out[k * 2 + 1] = out[src + 1];
  }
  return out;
}
