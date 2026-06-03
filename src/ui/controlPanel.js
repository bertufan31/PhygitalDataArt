// ---------------------------------------------------------------------------
// The "DJ booth" control panel (control.html).
//
// Builds its whole UI from the registry + shared catalogues, so new art options
// and flavours appear automatically. Every interaction goes through two
// injected functions:
//   dispatch(command) → change what the display shows (art/view/target/frame…)
//   fire(event)       → inject a data event ("TEREA Yellow sold") right now
// Both reach the display over the bus; the panel never renders 3D itself.
// ---------------------------------------------------------------------------

import { CommandTypes, EventTypes, makeCommand, makeEvent, Flavours, Products } from '../core/events.js';
import { listArts, getArt } from '../art/registry.js';
import { mergedArtParams, colorParamDefs } from '../art/params.js';

const VIEWS = [
  ['head-on', 'View 1 · Head-on'],
  ['store', 'View 2 · Store'],
  ['angled', 'View 3 · Angled'],
];
const TARGETS = [
  ['flat', 'Flat screen'],
  ['prism', 'LED prisms'],
];
const FRAMES = [
  ['niche', 'Niche'],
  ['gallery', 'Gallery'],
  ['dark', 'Dark'],
  ['metallic', 'Metallic'],
  ['none', 'None'],
];
const RATIO_PRESETS = [
  ['16:9', 160, 90],
  ['3:2', 150, 100],
  ['4:3', 160, 120],
  ['1:1', 120, 120],
  ['9:16', 90, 160],
];

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

function section(title, body) {
  return el('section', { class: 'panel-section' }, [el('h2', { text: title }), body]);
}

export function initControlPanel({ root, state, dispatch, fire }) {
  // Track buttons that need active-state highlighting on refresh().
  const artBtns = new Map();
  const viewBtns = new Map();
  const targetBtns = new Map();
  const frameBtns = new Map();
  const flavourBtns = new Map();

  // -- Art options -------------------------------------------------------
  const artRow = el('div', { class: 'btn-grid' });
  for (const a of listArts()) {
    const b = el('button', {
      class: 'opt',
      text: a.label,
      onclick: () => dispatch(makeCommand(CommandTypes.SET_ART, { artId: a.id })),
    });
    artBtns.set(a.id, b);
    artRow.append(b);
  }

  // -- Mockup views ------------------------------------------------------
  const viewRow = el('div', { class: 'btn-grid' });
  for (const [id, label] of VIEWS) {
    const b = el('button', {
      class: 'opt',
      text: label,
      onclick: () => dispatch(makeCommand(CommandTypes.SET_VIEW, { viewId: id })),
    });
    viewBtns.set(id, b);
    viewRow.append(b);
  }

  // -- Display target ----------------------------------------------------
  const targetRow = el('div', { class: 'btn-grid' });
  for (const [id, label] of TARGETS) {
    const b = el('button', {
      class: 'opt',
      text: label,
      onclick: () => dispatch(makeCommand(CommandTypes.SET_TARGET, { targetId: id })),
    });
    targetBtns.set(id, b);
    targetRow.append(b);
  }

  // -- Frame style -------------------------------------------------------
  const frameRow = el('div', { class: 'btn-grid' });
  for (const [id, label] of FRAMES) {
    const b = el('button', {
      class: 'opt opt--sm',
      text: label,
      onclick: () => dispatch(makeCommand(CommandTypes.SET_FRAME_STYLE, { frameStyle: id })),
    });
    frameBtns.set(id, b);
    frameRow.append(b);
  }

  // -- Live data / DJ pads ----------------------------------------------
  // Each pad shows the distinct effect it triggers, so you can demonstrate the
  // data → effect principle live.
  const pad = (cls, evt, title, fx, onclick) =>
    el('button', { class: `pad ${cls}`, 'data-evt': evt, onclick }, [
      el('span', { class: 'pad-title', text: title }),
      el('span', { class: 'pad-fx', text: fx }),
    ]);
  const visitorPad = pad('pad--visitor', EventTypes.VISITOR_ENTERED, 'Someone entered', 'ripple',
    () => fire(makeEvent(EventTypes.VISITOR_ENTERED)));
  const salePad = pad('pad--sale', EventTypes.SALE_MADE, 'Sale made', 'blast',
    () => fire(makeEvent(EventTypes.SALE_MADE, { amount: 5 + Math.round(Math.random() * 120) })));
  const productPad = pad('pad--product', EventTypes.PRODUCT_SOLD, 'Product sold', 'disruption',
    () => fire(makeEvent(EventTypes.PRODUCT_SOLD, { product: Products[(Math.random() * Products.length) | 0] })));
  const padRow = el('div', { class: 'pad-grid' }, [visitorPad, salePad, productPad]);

  const flavourNote = el('div', { class: 'fx-note', text: 'Consumable / flavour sale → colour blast (in its colour)' });
  const flavourGrid = el('div', { class: 'flavour-grid' });
  for (const f of Flavours) {
    const b = el('button', {
      class: 'flavour',
      'data-flavour': f.name,
      onclick: () => fire(makeEvent(EventTypes.FLAVOUR_SOLD, { flavour: f.name, color: f.color })),
    }, [el('span', { class: 'swatch', style: `background:${f.color}` }), el('span', { text: f.name })]);
    flavourBtns.set(f.name, b);
    flavourGrid.append(b);
  }

  // -- Simulator ---------------------------------------------------------
  const simBtn = el('button', {
    class: 'opt opt--wide',
    onclick: () => dispatch(makeCommand(CommandTypes.SET_SIM, { running: !state.sim.running })),
  });
  const rateLabel = el('span', { class: 'rate-label' });
  const rateSlider = el('input', {
    type: 'range', min: '0.25', max: '4', step: '0.25',
    oninput: (e) => dispatch(makeCommand(CommandTypes.SET_SIM, { rate: parseFloat(e.target.value) })),
  });
  const simBody = el('div', { class: 'stack' }, [
    simBtn,
    el('label', { class: 'field' }, [el('span', { text: 'Data speed' }), rateSlider, rateLabel]),
  ]);

  // -- Frame & grid ------------------------------------------------------
  const ratioRow = el('div', { class: 'btn-grid' });
  for (const [label, w, h] of RATIO_PRESETS) {
    ratioRow.append(el('button', {
      class: 'opt opt--sm',
      text: label,
      onclick: () => dispatch(makeCommand(CommandTypes.SET_FRAME, { w, h })),
    }));
  }
  // Small field builders.
  const numField = (labelText, min, max, getVal, onCommit) => {
    const input = el('input', {
      type: 'number', min: String(min), max: String(max),
      onchange: (e) => onCommit(clampNum(e.target.value, min, max, getVal())),
    });
    return { input, field: el('label', { class: 'field' }, [el('span', { text: labelText }), input]) };
  };
  const rangeField = (labelText, min, max, step, onInput) => {
    const val = el('span', { class: 'rate-label' });
    const input = el('input', {
      type: 'range', min: String(min), max: String(max), step: String(step),
      oninput: (e) => onInput(parseFloat(e.target.value)),
    });
    return { input, val, field: el('label', { class: 'field' }, [el('span', { text: labelText }), input, val]) };
  };

  // Frame size (cm) + ratio presets.
  const fW = numField('Frame W (cm)', 10, 1000, () => state.frame.w, (v) => dispatch(makeCommand(CommandTypes.SET_FRAME, { w: v })));
  const fH = numField('Frame H (cm)', 10, 1000, () => state.frame.h, (v) => dispatch(makeCommand(CommandTypes.SET_FRAME, { h: v })));
  const frameSizeBody = el('div', { class: 'stack' }, [ratioRow, el('div', { class: 'field-row' }, [fW.field, fH.field])]);

  // LED-prism grid + geometry.
  const pCols = numField('Cols', 8, 220, () => state.prism.cols, (v) => dispatch(makeCommand(CommandTypes.SET_PRISM, { cols: v })));
  const pRows = numField('Rows', 8, 220, () => state.prism.rows, (v) => dispatch(makeCommand(CommandTypes.SET_PRISM, { rows: v })));
  const pWidth = rangeField('Width', 0.3, 1.0, 0.05, (v) => dispatch(makeCommand(CommandTypes.SET_PRISM, { widthFill: v })));
  const pHeight = rangeField('Height', 0.3, 1.0, 0.05, (v) => dispatch(makeCommand(CommandTypes.SET_PRISM, { heightFill: v })));
  const pDepth = rangeField('Base depth', 0.02, 0.4, 0.01, (v) => dispatch(makeCommand(CommandTypes.SET_PRISM, { depth: v })));
  const pRise = rangeField('Max rise', 0.0, 1.0, 0.02, (v) => dispatch(makeCommand(CommandTypes.SET_PRISM, { rise: v })));
  const pSmooth = rangeField('Smoothing', 0.02, 1.0, 0.02, (v) => dispatch(makeCommand(CommandTypes.SET_PRISM, { smoothing: v })));
  const prismBody = el('div', { class: 'stack' }, [
    el('div', { class: 'field-row' }, [pCols.field, pRows.field]),
    el('div', { class: 'field-row' }, [pWidth.field, pHeight.field]),
    el('div', { class: 'field-row' }, [pDepth.field, pRise.field]),
    el('div', { class: 'field-row' }, [pSmooth.field]),
  ]);

  // -- Per-art colour + style settings (rebuilt when the active art changes) --
  const colourBody = el('div', { class: 'stack' });
  const artSettingsBody = el('div', { class: 'stack' });
  const artSettingsSection = section('Style settings', artSettingsBody);

  const fmtParam = (def, v) => {
    const n = parseFloat(v);
    return def.max <= 1 ? n.toFixed(2) : String(Math.round(n));
  };
  const makeParamField = (def, value, artId) => {
    const commit = (v) => dispatch(makeCommand(CommandTypes.SET_ART_PARAM, { artId, key: def.key, value: v }));
    if (def.type === 'color') {
      const input = el('input', { type: 'color', class: 'color-input', value, oninput: (e) => commit(e.target.value) });
      return el('label', { class: 'field' }, [el('span', { text: def.label }), input]);
    }
    const isNum = def.type === 'number';
    const valEl = el('span', { class: 'rate-label' });
    const input = el('input', {
      type: isNum ? 'number' : 'range',
      min: String(def.min), max: String(def.max), step: String(def.step ?? (isNum ? 1 : 0.01)), value: String(value),
      oninput: isNum ? undefined : (e) => { valEl.textContent = fmtParam(def, e.target.value); commit(parseFloat(e.target.value)); },
      onchange: isNum ? (e) => commit(clampNum(e.target.value, def.min, def.max, value)) : undefined,
    });
    if (!isNum) valEl.textContent = fmtParam(def, value);
    return el('label', { class: 'field' }, isNum ? [el('span', { text: def.label }), input] : [el('span', { text: def.label }), input, valEl]);
  };
  let lastArtId = null;
  function rebuildArtUI() {
    const ArtClass = getArt(state.artId);
    const params = mergedArtParams(state, state.artId, ArtClass);
    colourBody.replaceChildren(...colorParamDefs().map((def) => makeParamField(def, params[def.key], state.artId)));
    const defs = (ArtClass && ArtClass.params) || [];
    artSettingsBody.replaceChildren(...defs.map((def) => makeParamField(def, params[def.key], state.artId)));
    artSettingsSection.style.display = defs.length ? '' : 'none';
  }

  // -- Live feed ---------------------------------------------------------
  const feed = el('ul', { class: 'feed' });

  // -- Assemble ----------------------------------------------------------
  root.append(
    el('header', { class: 'panel-header' }, [
      el('div', {}, [
        el('h1', { text: 'PhygitalDataArt' }),
        el('p', { class: 'subtitle', text: 'Control booth' }),
      ]),
      el('a', { class: 'display-link', href: './index.html', target: '_blank', rel: 'noopener', text: 'Open display ↗' }),
    ]),
    el('div', { class: 'panel-grid' }, [
      section('Art options', artRow),
      section('Colour', colourBody),
      artSettingsSection,
      section('Mockup view', viewRow),
      section('Display target', targetRow),
      section('Frame style', frameRow),
      section('Simulator', simBody),
      section('Live data', el('div', { class: 'stack' }, [padRow, flavourNote, flavourGrid])),
      section('Frame size', frameSizeBody),
      section('LED prisms', prismBody),
    ]),
    section('Live feed', feed),
  );

  // -- refresh / flash ---------------------------------------------------
  const setActive = (map, id) => {
    for (const [key, btn] of map) btn.classList.toggle('active', key === id);
  };

  function refresh() {
    setActive(artBtns, state.artId);
    setActive(viewBtns, state.viewId);
    setActive(targetBtns, state.targetId);
    setActive(frameBtns, state.frameStyle);
    simBtn.textContent = state.sim.running ? '■ Pause data feed' : '▶ Resume data feed';
    simBtn.classList.toggle('active', state.sim.running);
    rateSlider.value = String(state.sim.rate);
    rateLabel.textContent = `${state.sim.rate.toFixed(2)}×`;
    if (document.activeElement !== fW.input) fW.input.value = String(state.frame.w);
    if (document.activeElement !== fH.input) fH.input.value = String(state.frame.h);
    if (document.activeElement !== pCols.input) pCols.input.value = String(state.prism.cols);
    if (document.activeElement !== pRows.input) pRows.input.value = String(state.prism.rows);
    pWidth.input.value = String(state.prism.widthFill); pWidth.val.textContent = Math.round(state.prism.widthFill * 100) + '%';
    pHeight.input.value = String(state.prism.heightFill); pHeight.val.textContent = Math.round(state.prism.heightFill * 100) + '%';
    pDepth.input.value = String(state.prism.depth); pDepth.val.textContent = Number(state.prism.depth).toFixed(2);
    pRise.input.value = String(state.prism.rise); pRise.val.textContent = Number(state.prism.rise).toFixed(2);
    pSmooth.input.value = String(state.prism.smoothing); pSmooth.val.textContent = Number(state.prism.smoothing).toFixed(2);
    if (state.artId !== lastArtId) { lastArtId = state.artId; rebuildArtUI(); }
  }

  function flash(event) {
    const { text, color } = describe(event);
    // Pulse the matching pad.
    const pad =
      event.type === EventTypes.FLAVOUR_SOLD
        ? flavourBtns.get(event.data?.flavour)
        : root.querySelector(`.pad[data-evt="${event.type}"]`);
    if (pad) {
      pad.classList.remove('flash');
      void pad.offsetWidth; // restart the animation
      pad.classList.add('flash');
    }
    // Log it.
    const li = el('li', {}, [
      el('span', { class: 'dot', style: `background:${color}` }),
      el('time', { text: new Date(event.ts || Date.now()).toLocaleTimeString() }),
      el('span', { text }),
    ]);
    feed.prepend(li);
    while (feed.children.length > 40) feed.lastChild.remove();
  }

  refresh();
  return { refresh, flash };
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function describe(event) {
  switch (event.type) {
    case EventTypes.VISITOR_ENTERED:
      return { text: 'Someone entered', color: '#5fd0ff' };
    case EventTypes.SALE_MADE:
      return { text: `Sale made · €${event.data?.amount ?? '?'}`, color: '#ffd86b' };
    case EventTypes.PRODUCT_SOLD:
      return { text: `Product sold · ${event.data?.product ?? '?'}`, color: '#9b7bff' };
    case EventTypes.FLAVOUR_SOLD:
      return { text: `Flavour · ${event.data?.flavour ?? '?'}`, color: event.data?.color ?? '#ffffff' };
    default:
      return { text: event.type, color: '#ffffff' };
  }
}
