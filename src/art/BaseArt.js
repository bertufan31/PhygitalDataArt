// ---------------------------------------------------------------------------
// Art-option interface.
//
// Every art style extends this class. An art renders itself into its OWN
// offscreen WebGLRenderTarget and exposes the result as `.texture`. It knows
// nothing about how it will be shown — the Stage hands that texture to whatever
// display target (flat plane / LED-prism grid) and camera view is active. This
// keeps the three layers (art ▸ target ▸ view) fully independent, so any art
// works with any target and any view.
//
// To add a new art option: create a file under art/styles/, extend BaseArt,
// give it a unique static `id` + `label`, call registerArt() at the bottom,
// and add one import line to art/styles/index.js. It then appears as a button
// on the control panel automatically (built from listArts()).
// ---------------------------------------------------------------------------

export class BaseArt {
  /** Unique id used in state + on the control panel. Override in subclass. */
  static id = 'base';
  /** Human-readable label shown on the control-panel button. */
  static label = 'Base';
  /** Optional style-specific controls, e.g. [{ key, type:'range'|'number'|'color', label, min, max, step, default }]. */
  static params = [];

  /** Apply current per-art parameter values (called on init and on change). */
  setParams(_params) {}

  /**
   * Create GPU resources.
   * @param {{ renderer: THREE.WebGLRenderer, size: {width:number,height:number}, frame: {w:number,h:number} }} ctx
   */
  init(_ctx) {}

  /** Frame aspect / render resolution changed. @param {{width:number,height:number}} _size */
  resize(_size) {}

  /** React to a data event ({ type, data, ts }) from the simulator or a DJ pad. */
  onEvent(_event) {}

  /** Advance + render into the internal render target. @param {number} _dt seconds */
  update(_dt) {}

  /** The current output texture for the active display target. @returns {THREE.Texture|null} */
  get texture() {
    return null;
  }

  /** Release GPU resources when this art is swapped out. */
  destroy() {}
}
