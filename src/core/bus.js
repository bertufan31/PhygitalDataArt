// ---------------------------------------------------------------------------
// Transport abstraction.
//
// The display and the control panel are two browser windows on the same
// machine (same origin), so we sync them with the zero-backend
// BroadcastChannel API. Everything else in the app talks to this small
// {send, subscribe, close} interface and never references BroadcastChannel
// directly — so a WebSocket implementation (for phone-as-controller across
// devices) can be dropped in later without touching any caller. See TODO.md.
// ---------------------------------------------------------------------------

/**
 * @param {string} channel logical channel name (same string on every window)
 * @returns {{ send(msg:object):void, subscribe(handler:(msg:object)=>void):()=>void, close():void }}
 */
export function createBus(channel = 'pda') {
  const bc = new BroadcastChannel(channel);
  const handlers = new Set();

  // BroadcastChannel never echoes a message back to the window that sent it,
  // which is exactly what we want: a sender applies its own change locally and
  // only *other* windows receive it over the bus.
  bc.onmessage = (e) => {
    for (const handler of handlers) handler(e.data);
  };

  return {
    send(msg) {
      bc.postMessage(msg);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      handlers.clear();
      bc.close();
    },
  };
}
