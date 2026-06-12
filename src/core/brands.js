// ---------------------------------------------------------------------------
// Brand model — the source of truth for brand-defining inputs that shape the
// generated artwork: palette, logos, imagery, brand principles/rules and a
// motion language. Three brands are supported: IQOS, ZYN, VEEV.
//
// Seeded from the official brand assets in /public/brands (Figma exports). The
// seed is editable in the Brand CMS (brands.html); edits persist + sync like
// the rest of app state (see core/state.js). Keep this a plain data model — no
// rendering here — so the CMS and the art pipeline stay decoupled.
//
// Colour provenance: ZYN #00A9E0 is sampled from the supplied logo file. VEEV
// uses the brand baseline supplied by the team: Deep Purple #221551, Pure White
// #FFFFFF, Lilac #B89FEF, Light Purple #332072 (V mark = Light Purple on a
// Lilac ground). IQOS tones are editable starting points.
// ---------------------------------------------------------------------------

export const BRAND_IDS = ['iqos', 'zyn', 'veev'];

// Bump when the SEED changes so saved (stale) brand data is refreshed on load.
export const BRANDS_VERSION = 2;

// Resolve a /public/brands asset against the Vite base (works under the
// GitHub-Pages project subpath too).
function asset(file) {
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  return `${base}brands/${file}`.replace(/([^:])\/{2,}/g, '$1/');
}

const SEED = {
  iqos: {
    id: 'iqos',
    label: 'IQOS',
    palette: { primary: '#00D1D2', secondary: '#FFFFFF', background: '#0A1A2F', accents: ['#19D3D4', '#2A3A4A'] },
    logos: [
      { id: 'emblem', label: 'IQOS emblem', kind: 'sdf', src: null, note: 'Analytic emblem — see core/shape.js' },
    ],
    imagery: [],
    principles: ['Warm, precise minimalism', 'Unfold the experience', 'Light treated as a material'],
    motion: { language: 'Smooth, breathing, premium', easing: 'easeInOut' },
  },
  zyn: {
    id: 'zyn',
    label: 'ZYN',
    palette: { primary: '#00A9E0', secondary: '#FFFFFF', background: '#002B49', accents: ['#0A1A2F'] },
    logos: [
      { id: 'wordmark', label: 'ZYN wordmark', kind: 'vector', src: asset('zyn-logo.pdf') },
    ],
    imagery: [],
    principles: ['Crisp, clean, energetic', 'Bold cyan on deep blue'],
    motion: { language: 'Snappy, modern', easing: 'easeOut' },
  },
  veev: {
    id: 'veev',
    label: 'VEEV',
    // Brand baseline: V mark in Light Purple on a Lilac ground, shaded with
    // Deep Purple; Pure White as the supporting tone. amount 1.0 → exact brand
    // colour on the V (no white sparkle bleed).
    palette: { primary: '#332072', secondary: '#FFFFFF', background: '#B89FEF', shadow: '#221551', accents: ['#221551', '#FFFFFF'], amount: 1.0 },
    logos: [
      { id: 'wordmark', label: 'VEEV wordmark', kind: 'vector', src: asset('veev-global.pdf') },
      { id: 'v-shape', label: 'VEEV “V” mark', kind: 'image', src: asset('veev-vshape.pdf') },
    ],
    imagery: [
      { id: 'v-hero', label: 'V hero shape', src: asset('veev-vshape.pdf') },
    ],
    principles: ['Sleek, contemporary', 'The “V” as a hero motif'],
    motion: { language: 'Fluid, directional', easing: 'easeInOut' },
  },
};

/** Fresh, deep copy of the seed for default state. */
export function defaultBrands() {
  return structuredClone(SEED);
}

/** Ordered brand list for the CMS selector. */
export function listBrands(brands) {
  return BRAND_IDS.map((id) => (brands && brands[id]) || SEED[id]).filter(Boolean);
}

export function getBrand(brands, id) {
  return (brands && brands[id]) || SEED[id];
}

// The one explicit, safe seam connecting brand → output: map a brand palette to
// the per-art colour params every art already understands, so the CMS can push
// a brand look into the live artwork through the existing SET_ART_PARAM command
// (no rendering-engine changes). primary → highlight, background → shadow/ground.
export function brandColorParams(brand) {
  const p = brand.palette;
  // `shadow` (optional) is the duotone's dark end — needed when the background
  // is light, or the form's mid-tones dilute into the ground. `amount` lets a
  // brand demand exact colour fidelity (1 = fully themed); 0.7 keeps a touch of
  // the art's own luminance sparkle.
  return { colorA: p.shadow ?? p.background, colorB: p.primary, colorBg: p.background, colorAmount: p.amount ?? 0.7 };
}
