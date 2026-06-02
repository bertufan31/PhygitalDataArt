// ---------------------------------------------------------------------------
// Event & command vocabulary shared across the whole app.
//
// There are two kinds of messages that travel over the bus (see bus.js):
//   - EVENTS   (kind: 'event')   — data points from the store. The active art
//                                  reacts to these. The fake-data simulator AND
//                                  the manual "DJ pad" buttons both produce the
//                                  exact same event objects, so a simulated
//                                  event and a button press are indistinguishable
//                                  downstream. Real POS/door-sensor data will
//                                  later produce these same events.
//   - COMMANDS (kind: 'command') — control-panel instructions to the display
//                                  (switch art, change view, edit the frame…).
// ---------------------------------------------------------------------------

/** Data event types — the four store signals. */
export const EventTypes = {
  VISITOR_ENTERED: 'visitor_entered',
  SALE_MADE: 'sale_made',
  PRODUCT_SOLD: 'product_sold',
  FLAVOUR_SOLD: 'flavour_sold',
};

/** Control command types — presenter → display. */
export const CommandTypes = {
  SET_ART: 'set_art',
  SET_VIEW: 'set_view',
  SET_TARGET: 'set_target',
  SET_FRAME: 'set_frame',
  SET_PRISM: 'set_prism',
  SET_SIM: 'set_sim',
  REQUEST_STATE: 'request_state', // a window asks the running display for current state
  SYNC_STATE: 'sync_state', // the display replies with a full state snapshot
};

// Flavour catalogue. Each flavour maps to a pigment colour the art injects when
// that flavour sells — modelled loosely on TEREA's colour-named variants.
// (Colours here are illustrative, not official brand values.)
export const Flavours = [
  { name: 'TEREA Yellow', color: '#F4C20D' },
  { name: 'TEREA Amber', color: '#C8742B' },
  { name: 'TEREA Sienna', color: '#9E4A2F' },
  { name: 'TEREA Bronze', color: '#7A5C3E' },
  { name: 'TEREA Turquoise', color: '#22B3A8' },
  { name: 'TEREA Blue', color: '#2C6FB0' },
  { name: 'TEREA Green', color: '#3FA34D' },
  { name: 'TEREA Purple', color: '#7B4FA3' },
];

// Product catalogue used by the simulator + the "product sold" pad.
export const Products = [
  'Device — Iluma',
  'Device — Iluma Prime',
  'Accessory — Cap',
  'Accessory — Holder',
  'Starter Kit',
];

/** Build a data event. */
export function makeEvent(type, data = {}) {
  return { kind: 'event', type, ts: Date.now(), data };
}

/** Build a control command. */
export function makeCommand(type, data = {}) {
  return { kind: 'command', type, ts: Date.now(), data };
}
