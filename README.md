# PhygitalDataArt

Generative **data-art installation** for a physical retail store — and, right now, a
slick way to pitch the idea to management. Store signals (people entering, sales,
products, flavours) drive a continuously-playing generative artwork. A presenter
drives a **"DJ booth" control panel**; the audience watches a **fullscreen display**
that reacts in real time.

> **Status: scaffold.** The full architecture is in place end-to-end with one simple
> *placeholder* art piece that proves the data → art → display pipeline. Polished
> Anadol-style pieces, real data, and the physical build come later — see
> [`TODO.md`](./TODO.md).

## How it works — three composable layers

```
 DATA EVENTS                 ART OPTION              DISPLAY TARGET          VIEW
 (sim + DJ pads) ─────▶  renders to a texture ─▶  flat plane | LED prisms ─▶ camera ─▶ screen
```

These three layers are independent: **any art works with any display target and any
view.** Adding an art option doesn't touch the others.

- **Display** (`index.html`) — the audience-facing art. Owns the fake-data simulator
  so the art stays alive even if the control panel is closed. Has a hamburger menu
  with quick controls.
- **Control panel** (`control.html`) — the DJ booth. Switch art options / mockup views
  / display target, edit the frame size + prism grid, toggle the simulator, and fire
  manual events ("Someone entered", "Sale made", "TEREA Yellow sold").
- The two windows sync over the **BroadcastChannel API** (zero backend). They must be
  on the **same origin** — i.e. served by the same dev server or the same deployment.

## Run locally

```bash
npm install
npm run dev
```

Then open **two windows** (same browser, same machine):

1. The display — `http://localhost:5173/`
2. The control panel — `http://localhost:5173/control.html`

Drag the display window onto the projector/TV and fullscreen it (F11). Drive everything
from the control panel; the display reacts instantly. (You can also use the ☰ hamburger
on the display itself for a single-screen demo.)

```bash
npm run build     # production build of both pages
npm run preview   # serve the build locally to verify
```

## Presentation setup (one laptop)

The chosen setup is **one laptop, two windows**: the laptop runs both pages, the display
is mirrored/extended to the venue screen, and you present from the control panel. This is
why BroadcastChannel (same-origin, no server) is enough. Driving the display from a
**separate phone/tablet** would need a small WebSocket server — that path is left open by
the transport abstraction in `src/core/bus.js` (see `TODO.md`).

## Add a new art option

1. Copy `src/art/styles/placeholderField.js` to a new file.
2. Give it a unique `static id` + `static label`, and implement the `BaseArt` lifecycle
   (`init` / `resize` / `onEvent` / `update` / `get texture` / `destroy`).
3. Add one import line to `src/art/styles/index.js`.

It auto-registers and shows up as **Option N** on the control panel and hamburger.

## Project structure

```
index.html / control.html      two page entry points (Vite multi-page)
src/core/    events, bus (BroadcastChannel), state (+persistence), simulator
src/art/     BaseArt interface, registry, styles/  (drop new art here)
src/render/  Stage (loop) + targets/ (flat, prism) + views/ (cameras)
src/ui/      controlPanel (DJ booth), hamburger, CSS
```

## Deploy (GitHub Pages)

Pushing to the default branch triggers `.github/workflows/deploy.yml`, which builds with
the correct project base path and publishes both pages. Enable Pages once under
**Settings → Pages → Source: GitHub Actions**.

Deployed URLs: `…/PhygitalDataArt/` (display) and `…/PhygitalDataArt/control.html`
(control). Open both in two windows — same origin, so BroadcastChannel still syncs them.
