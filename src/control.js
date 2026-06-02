// ---------------------------------------------------------------------------
// Control panel entry point (control.html).
//
// Builds the DJ booth, sends commands/events to the display over the bus, and
// mirrors state changes that originate elsewhere (the display's hamburger, or
// the initial SYNC_STATE handshake) so the panel's highlights stay correct.
// ---------------------------------------------------------------------------

import './art/styles/index.js'; // so listArts() is populated for the art buttons
import './ui/panel.css';
import { loadState, applyCommand } from './core/state.js';
import { createBus } from './core/bus.js';
import { CommandTypes, makeCommand } from './core/events.js';
import { initControlPanel } from './ui/controlPanel.js';

const bus = createBus();
const state = loadState();

let panel;

// A command both updates the local UI mirror and travels to the display.
function dispatch(cmd) {
  applyCommand(state, cmd);
  bus.send(cmd);
  panel?.refresh();
}

// An event is injected into the live data stream (and flashed locally).
function fire(event) {
  bus.send(event);
  panel?.flash(event);
}

panel = initControlPanel({ root: document.getElementById('panel'), state, dispatch, fire });

bus.subscribe((msg) => {
  if (msg.kind === 'event') {
    panel.flash(msg); // simulator events broadcast by the display
  } else if (msg.kind === 'command') {
    if (msg.type === CommandTypes.REQUEST_STATE) return; // only the display answers these
    applyCommand(state, msg); // SYNC_STATE snapshot, or a change from the hamburger
    panel.refresh();
  }
});

// Ask the running display for the authoritative current state on open.
bus.send(makeCommand(CommandTypes.REQUEST_STATE));
