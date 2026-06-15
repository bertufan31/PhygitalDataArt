// ---------------------------------------------------------------------------
// Brand glyph rasteriser — draws a brand's mark in WHITE on a transparent 2D
// canvas context, centred and fitted. The shape is the single source used both
// for the Vitrine "sign" and the Presence-Prisms idle logo:
//   • iqos / unknown → the analytic emblem (core/shape.js)
//   • zyn / veev     → the baked silhouette polygons (brandSilhouettes.data.js)
// Consumers read coverage from the alpha channel (.a).
// ---------------------------------------------------------------------------

import { BRAND_SILHOUETTES } from './brandSilhouettes.data.js';
import { emblemDist } from './shape.js';

/** Fill the brand mark in white (alpha = coverage) on ctx, fitted to W×H. */
export function drawBrandGlyph(ctx, W, H, brandId) {
  const sil = BRAND_SILHOUETTES[brandId];
  if (sil) {
    const pts = sil.polys.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    const scale = Math.min((W * 0.82) / (bx1 - bx0), (H * 0.78) / (by1 - by0));
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    ctx.fillStyle = '#fff';
    for (const poly of sil.polys) {
      ctx.beginPath();
      poly.forEach(([x, y], i) => {
        const px = W / 2 + (x - cx) * scale;
        const py = H / 2 - (y - cy) * scale; // y up → canvas down
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // IQOS emblem from its analytic SDF — square-fitted (never stretched),
    // white with anti-aliased alpha = coverage.
    const img = ctx.createImageData(W, H);
    const half = Math.min(W, H) * 0.5 * 0.8; // glyph half-extent in px
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ex = (x + 0.5 - W / 2) / half * 0.5;  // → emblem space ~[-0.5,0.5]
        const ey = (H / 2 - (y + 0.5)) / half * 0.5;
        const d = emblemDist(ex, ey);
        const a = Math.max(0, Math.min(1, 0.5 - d * 80));
        const k = (y * W + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
        img.data[k + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}

/** Natural width/height of a brand glyph (wide wordmarks > 1). */
export function brandGlyphAspect(brandId) {
  const sil = BRAND_SILHOUETTES[brandId];
  return sil ? sil.aspect : 1;
}
