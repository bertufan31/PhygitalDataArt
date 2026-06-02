// ---------------------------------------------------------------------------
// Fake-data engine.
//
// Emits realistic-feeling store events on randomized intervals so the art
// always looks alive during a pitch. It calls a supplied `emit(event)` callback
// rather than touching the bus directly, so the display can both feed the art
// and broadcast the event to the control panel's live feed.
//
// The manual "DJ pad" buttons in the control panel build events with the very
// same makeEvent() helper, so they are indistinguishable from simulated ones.
// ---------------------------------------------------------------------------

import { EventTypes, makeEvent, Flavours, Products } from './events.js';

// Relative likelihoods of each event type per tick. Visitors are common;
// sales / products / flavours are rarer, mirroring a real store.
const WEIGHTS = [
  [EventTypes.VISITOR_ENTERED, 0.5],
  [EventTypes.SALE_MADE, 0.2],
  [EventTypes.PRODUCT_SOLD, 0.15],
  [EventTypes.FLAVOUR_SOLD, 0.15],
];

const BASE_INTERVAL_MS = 1400; // average gap between events at rate = 1.0

function pickWeighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of pairs) {
    if ((r -= w) <= 0) return value;
  }
  return pairs[0][0];
}

const randItem = (arr) => arr[(Math.random() * arr.length) | 0];

export class Simulator {
  constructor(emit) {
    this.emit = emit;
    this.running = false;
    this.rate = 1.0;
    this._timer = null;
  }

  start(rate = this.rate) {
    this.rate = rate;
    if (this.running) return;
    this.running = true;
    this._schedule();
  }

  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this._timer = null;
  }

  setRate(rate) {
    this.rate = Math.max(0.05, rate);
  }

  _schedule() {
    if (!this.running) return;
    // Exponential-ish jitter scaled by rate so it feels organic, not metronomic.
    const jitter = 0.4 + Math.random() * 1.2;
    const delay = (BASE_INTERVAL_MS * jitter) / this.rate;
    this._timer = setTimeout(() => {
      this._tick();
      this._schedule();
    }, delay);
  }

  _tick() {
    const type = pickWeighted(WEIGHTS);
    let data = {};
    switch (type) {
      case EventTypes.SALE_MADE:
        data = { amount: 5 + Math.round(Math.random() * 120) };
        break;
      case EventTypes.PRODUCT_SOLD:
        data = { product: randItem(Products) };
        break;
      case EventTypes.FLAVOUR_SOLD: {
        const f = randItem(Flavours);
        data = { flavour: f.name, color: f.color };
        break;
      }
      default:
        break; // VISITOR_ENTERED carries no payload
    }
    this.emit(makeEvent(type, data));
  }
}
