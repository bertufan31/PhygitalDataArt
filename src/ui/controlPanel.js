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
import { listArts } from '../art/registry.js';

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
  const visitorPad = el('button', {
    class: 'pad pad--visitor',
    'data-evt': EventTypes.VISITOR_ENTERED,
    text: 'Someone entered',
    onclick: () => fire(makeEvent(EventTypes.VISITOR_ENTERED)),
  });
  const salePad = el('button', {
    class: 'pad pad--sale',
    'data-evt': EventTypes.SALE_MADE,
    text: 'Sale made',
    onclick: () => fire(makeEvent(EventTypes.SALE_MADE, { amount: 5 + Math.round(Math.random() * 120) })),
  });
  const productPad = el('button', {
    class: 'pad pad--product',
    'data-evt': EventTypes.PRODUCT_SOLD,
    text: 'Product sold',
    onclick: () =>
      fire(makeEvent(EventTypes.PRODUCT_SOLD, { product: Products[(Math.random() * Products.length) | 0] })),
  });
  const padRow = el('div', { class: 'pad-grid' }, [visitorPad, salePad, productPad]);

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
  const frameW = el('input', {
    type: 'number', min: '10', max: '1000',
    onchange: (e) => dispatch(makeCommand(CommandTypes.SET_FRAME, { w: clampNum(e.target.value, 10, 1000, state.frame.w) })),
  });
  const frameH = el('input', {
    type: 'number', min: '10', max: '1000',
    onchange: (e) => dispatch(makeCommand(CommandTypes.SET_FRAME, { h: clampNum(e.target.value, 10, 1000, state.frame.h) })),
  });
  const prismCols = el('input', {
    type: 'number', min: '8', max: '200',
    onchange: (e) => dispatch(makeCommand(CommandTypes.SET_PRISM, { cols: clampNum(e.target.value, 8, 200, state.prism.cols) })),
  });
  const prismRows = el('input', {
    type: 'number', min: '8', max: '200',
    onchange: (e) => dispatch(makeCommand(CommandTypes.SET_PRISM, { rows: clampNum(e.target.value, 8, 200, state.prism.rows) })),
  });
  const frameBody = el('div', { class: 'stack' }, [
    ratioRow,
    el('div', { class: 'field-row' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Frame W (cm)' }), frameW]),
      el('label', { class: 'field' }, [el('span', { text: 'Frame H (cm)' }), frameH]),
    ]),
    el('div', { class: 'field-row' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Prism cols' }), prismCols]),
      el('label', { class: 'field' }, [el('span', { text: 'Prism rows' }), prismRows]),
    ]),
  ]);

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
      section('Mockup view', viewRow),
      section('Display target', targetRow),
      section('Frame style', frameRow),
      section('Simulator', simBody),
      section('Live data', el('div', { class: 'stack' }, [padRow, flavourGrid])),
      section('Frame & grid', frameBody),
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
    if (document.activeElement !== frameW) frameW.value = String(state.frame.w);
    if (document.activeElement !== frameH) frameH.value = String(state.frame.h);
    if (document.activeElement !== prismCols) prismCols.value = String(state.prism.cols);
    if (document.activeElement !== prismRows) prismRows.value = String(state.prism.rows);
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
