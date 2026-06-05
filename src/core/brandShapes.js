// ---------------------------------------------------------------------------
// Brand silhouettes — FUTURE HOOK for particle "brand morphing" (Phase 3).
//
// The plan: Key Particles morphs from the IQOS emblem into branded forms such
// as the ZYN logo and the VEEV "V". The authoritative outlines ship as vector
// assets in /public/brands; turning them into normalized point clouds / SDFs
// (the shape the particle layer consumes — see core/shape.js `samplePoints`)
// is deferred.
//
// This module exposes the STABLE INTERFACE the art will call, returning null
// for now so callers fall back to the default emblem. We deliberately do NOT
// invent final branded geometry here — wire the real samplers when Phase 3
// lands, sourcing them from the supplied assets.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Silhouette
 * @property {(n:number) => Float32Array} sample  // n points in ~[-0.5,0.5], [x,y,...]
 * @property {(x:number, y:number) => number} sdf // signed distance, <0 inside
 */

/**
 * @param {string} brandId  'iqos' | 'zyn' | 'veev'
 * @returns {Silhouette | null}  null → caller uses the default emblem
 */
export function getBrandSilhouette(brandId) {
  // TODO(Phase 3): derive samplers from /public/brands vector outlines
  // (ZYN Z/Y/N letterforms, VEEV "V"). Return null until then.
  void brandId;
  return null;
}
