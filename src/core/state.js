// ---------------------------------------------------------------------------
// Shared, persisted app state.
//
// State is a plain object describing *what the display is currently showing*.
// The display is the source of truth and owns the simulator; the control panel
// sends commands that mutate this state. Because both windows share the same
// origin they also share localStorage, so a freshly opened window can recover
// the last-known state immediately (and then refresh it from the running
// display via REQUEST_STATE / SYNC_STATE — see display.js / control.js).
// ---------------------------------------------------------------------------

import { CommandTypes } from './events.js';

const STORAGE_KEY = 'pda-state-v1';

/** Canonical default state. Frame defaults to 16:9 (160 × 90 cm). */
const DEFAULT_STATE = {
  artId: 'data-pigments', // active art option
  viewId: 'head-on', // active mockup camera view
  targetId: 'flat', // 'flat' | 'prism' display target
  frameStyle: 'gallery', // picture-frame style (see viewManager FRAME_STYLES)
  frame: { w: 160, h: 90 }, // physical frame size in cm (editable in the panel)
  prism: { cols: 96, rows: 54, widthFill: 0.85, heightFill: 0.85, depth: 0.12, rise: 0.32 }, // LED-prism grid + geometry
  sim: { running: true, rate: 1.0 }, // fake-data engine on/off + speed multiplier
};

export function defaultState() {
  return structuredClone(DEFAULT_STATE);
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      // Merge over defaults so new fields added later don't break old saves.
      return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
    }
  } catch {
    /* ignore corrupt/unavailable storage */
  }
  return defaultState();
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * Apply a command to a state object in place (and return it). Used by every
 * window so they all interpret commands identically.
 */
export function applyCommand(state, cmd) {
  switch (cmd.type) {
    case CommandTypes.SET_ART:
      state.artId = cmd.data.artId;
      break;
    case CommandTypes.SET_VIEW:
      state.viewId = cmd.data.viewId;
      break;
    case CommandTypes.SET_TARGET:
      state.targetId = cmd.data.targetId;
      break;
    case CommandTypes.SET_FRAME_STYLE:
      state.frameStyle = cmd.data.frameStyle;
      break;
    case CommandTypes.SET_FRAME:
      state.frame = { ...state.frame, ...cmd.data };
      break;
    case CommandTypes.SET_PRISM:
      state.prism = { ...state.prism, ...cmd.data };
      break;
    case CommandTypes.SET_SIM:
      state.sim = { ...state.sim, ...cmd.data };
      break;
    case CommandTypes.SYNC_STATE:
      Object.assign(state, cmd.data);
      break;
  }
  return state;
}
