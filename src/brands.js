// ---------------------------------------------------------------------------
// Brand CMS entry point (brands.html).
//
// A dedicated route for managing brand-defining inputs. It shares the same
// state + bus as the display and control panel (same origin), so brand edits
// persist to localStorage and sync across windows. It does not render 3D.
// ---------------------------------------------------------------------------

import './ui/panel.css';
import { loadState, saveState, applyCommand } from './core/state.js';
import { createBus } from './core/bus.js';
import { CommandTypes, makeCommand } from './core/events.js';
import { initBrandPanel } from './ui/brandPanel.js';

const bus = createBus();
const state = loadState();

let panel;

// A command updates the local mirror, persists, and travels to the other
// windows. Persisting HERE matters: without it, edits made while no display
// window is open (the only other writer) would vanish on refresh.
function dispatch(cmd) {
  applyCommand(state, cmd);
  saveState(state);
  bus.send(cmd);
  panel?.refresh();
}

panel = initBrandPanel({ root: document.getElementById('panel'), state, dispatch });

bus.subscribe((msg) => {
  if (msg.kind !== 'command') return;
  if (msg.type === CommandTypes.REQUEST_STATE) return; // only the display answers these
  applyCommand(state, msg); // SYNC_STATE snapshot, or a change from another window
  panel.refresh();
});

// Ask the running display for the authoritative current state on open.
bus.send(makeCommand(CommandTypes.REQUEST_STATE));
