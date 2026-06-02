// ---------------------------------------------------------------------------
// Art-option registry.
//
// Styles self-register by calling registerArt() at module load. The control
// panel calls listArts() to build its option buttons, and the Stage calls
// getArt() to instantiate the active one. New options light up everywhere with
// no extra wiring.
// ---------------------------------------------------------------------------

const arts = new Map();

/** @param {typeof import('./BaseArt.js').BaseArt} ArtClass */
export function registerArt(ArtClass) {
  if (!ArtClass.id || ArtClass.id === 'base') {
    throw new Error('Art class must define a unique static `id`.');
  }
  arts.set(ArtClass.id, ArtClass);
}

export function getArt(id) {
  return arts.get(id);
}

/** @returns {{id:string,label:string}[]} ordered list for the control panel. */
export function listArts() {
  return [...arts.values()].map((A) => ({ id: A.id, label: A.label }));
}
