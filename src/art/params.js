// ---------------------------------------------------------------------------
// Per-art parameters.
//
// Every art has, for free, a per-art COLOUR theme (primary, secondary,
// background, amount) consumed by the Stage's chroma-preserving duotone grade.
// Arts may ALSO declare their own `static params` (range/number/color) read via
// setParams() — e.g. the pattern style's size/rotation/padding/distance.
// ---------------------------------------------------------------------------

// Default [primary, secondary, background] per art (shadow → highlight → ground).
const COLOR_DEFAULTS = {
  'data-pigments': ['#0a1430', '#ffd36b', '#04060e'],
  'liquid-light': ['#0a1a3a', '#ff9e6b', '#04060e'],
  'sliced-light': ['#04121a', '#7fe0ff', '#02060a'],
  'particle-flow': ['#101f38', '#ffb36b', '#04060e'],
  'data-threads': ['#0a1020', '#6bd0ff', '#05080f'],
  'pigment-plumes': ['#0a0f1e', '#9ab0ff', '#070a14'],
  'key-particles': ['#0a2440', '#19d3d4', '#070a16'],
  'presence-field': ['#06131f', '#19d3d4', '#04070d'],
  'key-aura': ['#d98aa0', '#ffe6cf', '#b88497'],
  'key-pattern': ['#0b2a30', '#19d3d4', '#06121a'],
  'slipstream': ['#0a1c3a', '#8fe3ff', '#05080f'],
};

// Default recolour amount per art (how strongly the duotone applies).
const AMOUNT_DEFAULTS = {
  'key-aura': 0, // colours itself from the 3-stop gradient
  'key-particles': 0.5,
  'key-pattern': 0.5,
  'slipstream': 0.8, // wind streaks are near-monochrome → duotone carries the brand colour
};

export function colorDefaults(artId) {
  return COLOR_DEFAULTS[artId] || ['#0a0f1e', '#7fbfff', '#05060a'];
}

/** The colour params every art exposes (rendered as a "Colour" panel section). */
export function colorParamDefs() {
  return [
    { key: 'colorA', type: 'color', label: 'Primary' },
    { key: 'colorB', type: 'color', label: 'Secondary' },
    { key: 'colorBg', type: 'color', label: 'Background' },
    { key: 'colorAmount', type: 'range', label: 'Recolour', min: 0, max: 1, step: 0.05 },
  ];
}

/** Effective params for an art: art defaults + colour defaults + user overrides. */
export function mergedArtParams(state, artId, ArtClass) {
  const out = {};
  for (const p of ArtClass?.params || []) out[p.key] = p.default;
  const [a, b, bg] = colorDefaults(artId);
  out.colorA = a;
  out.colorB = b;
  out.colorBg = bg;
  out.colorAmount = AMOUNT_DEFAULTS[artId] ?? 0.35;
  return { ...out, ...(state.artParams?.[artId] || {}) };
}
