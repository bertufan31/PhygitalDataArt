// ---------------------------------------------------------------------------
// Display entry point (index.html) — the audience-facing art window.
//
// Owns the Stage and the fake-data Simulator (so the art keeps living even when
// the control panel is closed), applies incoming commands, and answers state
// requests from freshly opened control windows.
// ---------------------------------------------------------------------------

import './art/styles/index.js'; // registers all art options
import './ui/display.css';
import { loadState, saveState, applyCommand } from './core/state.js';
import { createBus } from './core/bus.js';
import { CommandTypes, makeCommand } from './core/events.js';
import { Stage } from './render/Stage.js';
import { Simulator } from './core/simulator.js';
import { initHamburger } from './ui/hamburger.js';

const canvas = document.getElementById('stage');
const state = loadState();
const bus = createBus();

const stage = new Stage(canvas, state);
stage.start();

// Each simulated event feeds the art locally AND is broadcast so the control
// panel can show a live feed. (BroadcastChannel doesn't echo to this window.)
const sim = new Simulator((event) => {
  stage.onEvent(event);
  bus.send(event);
});
if (state.sim.running) sim.start(state.sim.rate);

let hamburger;

function applyCommandLocally(cmd) {
  applyCommand(state, cmd);
  switch (cmd.type) {
    case CommandTypes.SET_ART:
      stage.setArt(state.artId);
      break;
    case CommandTypes.SET_VIEW:
      stage.setView(state.viewId);
      break;
    case CommandTypes.SET_TARGET:
      stage.setTarget(state.targetId);
      break;
    case CommandTypes.SET_FRAME_STYLE:
      stage.setFrameStyle(state.frameStyle);
      break;
    case CommandTypes.SET_FRAME:
      stage.setFrame(state.frame);
      break;
    case CommandTypes.SET_PRISM:
      stage.setPrism(state.prism);
      break;
    case CommandTypes.SET_SIM:
      sim.setRate(state.sim.rate);
      if (state.sim.running) sim.start(state.sim.rate);
      else sim.stop();
      break;
  }
  saveState(state);
  hamburger?.render(); // keep the quick-menu highlights in sync
}

bus.subscribe((msg) => {
  if (msg.kind === 'event') {
    stage.onEvent(msg); // a manual DJ-pad press from the control panel
  } else if (msg.kind === 'command') {
    if (msg.type === CommandTypes.REQUEST_STATE) {
      bus.send(makeCommand(CommandTypes.SYNC_STATE, structuredClone(state)));
    } else if (msg.type !== CommandTypes.SYNC_STATE) {
      applyCommandLocally(msg);
    }
  }
});

// The hamburger drives the local stage immediately and broadcasts the change so
// the control panel's UI reflects it.
function dispatch(cmd) {
  applyCommandLocally(cmd);
  bus.send(cmd);
}
hamburger = initHamburger({ state, dispatch });
