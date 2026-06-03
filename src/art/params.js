// ---------------------------------------------------------------------------
// Per-art parameters.
//
// Every art has, for free, a per-art COLOUR theme (primary, secondary, amount)
// consumed by the Stage's duotone colour grade. Arts may ALSO declare their own
// `static params` (range/number/color) which they read via setParams() — e.g.
// the pattern style's size/rotation/padding/distance.
//
// mergedArtParams() resolves the effective values: art defaults + colour
// defaults, overridden by anything the user has set in state.artParams[id].
// ---------------------------------------------------------------------------

// Tasteful default primary/secondary per art (shadow → highlight).
const COLOR_DEFAULTS = {
  'data-pigments': ['#0a1430', '#ffd36b'],
  'liquid-light': ['#0a1a3a', '#ff9e6b'],
  'sliced-light': ['#04121a', '#7fe0ff'],
  'particle-flow': ['#101f38', '#ffb36b'],
  'data-threads': ['#0a1020', '#6bd0ff'],
  'pigment-plumes': ['#0a0f1e', '#9ab0ff'],
  'placeholder-field': ['#070710', '#5fd0ff'],
  'key-particles': ['#05080f', '#19d3d4'],
  'key-aura': ['#f7b8c8', '#19d3d4'],
  'key-pattern': ['#0b0d12', '#19d3d4'],
};

export function colorDefaults(artId) {
  return COLOR_DEFAULTS[artId] || ['#0a0f1e', '#7fbfff'];
}

/** The colour params every art exposes (rendered as a "Colour" panel section). */
export function colorParamDefs() {
  return [
    { key: 'colorA', type: 'color', label: 'Primary' },
    { key: 'colorB', type: 'color', label: 'Secondary' },
    { key: 'colorAmount', type: 'range', label: 'Recolour', min: 0, max: 1, step: 0.05 },
  ];
}

/** Effective params for an art: art defaults + colour defaults + user overrides. */
export function mergedArtParams(state, artId, ArtClass) {
  const out = {};
  for (const p of ArtClass?.params || []) out[p.key] = p.default;
  const [a, b] = colorDefaults(artId);
  out.colorA = a;
  out.colorB = b;
  out.colorAmount = 0.35;
  return { ...out, ...(state.artParams?.[artId] || {}) };
}
