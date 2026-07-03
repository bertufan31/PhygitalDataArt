// ---------------------------------------------------------------------------
// Display entry point (index.html) — the audience-facing art window.
//
// Owns the Stage and the fake-data Simulator, applies incoming commands, and
// answers state requests from freshly opened control windows. The emblem shape
// asset is preloaded before the Stage starts (the shape-based styles need it).
// ---------------------------------------------------------------------------

import './art/styles/index.js'; // registers all art options
import './ui/display.css';
import { loadState, saveState, applyCommand } from './core/state.js';
import { createBus } from './core/bus.js';
import { CommandTypes, makeCommand } from './core/events.js';
import { Stage } from './render/Stage.js';
import { Simulator } from './core/simulator.js';
import { initHamburger } from './ui/hamburger.js';
import { BRAND_IDS } from './core/brands.js';

const canvas = document.getElementById('stage');
const state = loadState();
const bus = createBus();

init();

function init() {
  const stage = new Stage(canvas, state);
  stage.start();

  // Each simulated event feeds the art locally AND is broadcast so the control
  // panel can show a live feed. (BroadcastChannel doesn't echo to this window.)
  const sim = new Simulator((event) => {
    stage.onEvent(event);
    bus.send(event);
  });
  if (state.sim.running) sim.start(state.sim.rate);

  // Auto brand rotation (pausable like the data feed). The display owns the
  // timer; each advance goes through dispatch so every window stays in sync.
  // (Re)arming on every manual brand pick gives it a full period before moving on.
  let brandTimer = null;
  function syncBrandCycle() {
    clearInterval(brandTimer);
    brandTimer = null;
    if (!state.brandCycle?.running) return;
    const period = Math.max(3, state.brandCycle.period ?? 12) * 1000;
    brandTimer = setInterval(() => {
      const next = BRAND_IDS[(BRAND_IDS.indexOf(state.activeBrandId) + 1) % BRAND_IDS.length];
      dispatch(makeCommand(CommandTypes.SET_ACTIVE_BRAND, { brandId: next }));
    }, period);
  }

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
      case CommandTypes.SET_ART_PARAM:
        stage.setArtParam(cmd.data.artId);
        break;
      case CommandTypes.SET_ACTIVE_BRAND:
        stage.setActiveBrand(state.activeBrandId);
        syncBrandCycle(); // manual pick (or auto-advance) restarts the timer
        break;
      case CommandTypes.SET_BRAND:
        // CMS edited a brand (palette, textures, …) — re-dress if it's live.
        if (cmd.data.brandId === state.activeBrandId) stage.setActiveBrand(state.activeBrandId);
        break;
      case CommandTypes.SET_BRAND_CYCLE:
        syncBrandCycle();
        break;
      case CommandTypes.CLEAR_CANVAS:
        stage.clearSharedCanvas();
        break;
      case CommandTypes.SET_SIM:
        sim.setRate(state.sim.rate);
        if (state.sim.running) sim.start(state.sim.rate);
        else sim.stop();
        break;
    }
    saveState(state);
    hamburger?.render();
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

  // The hamburger drives the local stage immediately and broadcasts the change
  // so the control panel's UI reflects it.
  function dispatch(cmd) {
    applyCommandLocally(cmd);
    bus.send(cmd);
  }
  hamburger = initHamburger({ state, dispatch });
  syncBrandCycle();
}
