# Roadmap / TODO

Scaffold is done: full architecture + plumbing end-to-end with one placeholder art.
What follows is parked for later, roughly in priority order.

## Phase 2 — Presentation (deferred, do not start yet)
- [ ] Build the pitch deck / narrative to get the project budgeted.
- [ ] Decide live-demo script: which art option, which views, which "data moments" to
      trigger from the DJ booth while presenting.

## Art
- [ ] Polished, Anadol-grade art styles (fluid / curl-noise / particle flow, pigment
      mixing) using the `BaseArt` interface. The placeholder shows the contract.
- [ ] Map each data signal to richer, distinct visual behaviour per style.
- [ ] Curate a palette/identity aligned with the brand and the reference images.

## Display targets & hardware
- [ ] Refine the LED-prism preview (lighting, spacing, depth response curve).
- [ ] Hardware spec doc derived from `PrismTarget` (grid count, prism size, travel,
      drive electronics) for the physical spring-loaded build.
- [ ] Performance pass for large prism grids (toward ~160×90 ≈ 14.4k prisms).

## Views / mockups
- [ ] Replace the placeholder room in View 2 with the real 3D store model (drop a
      `.glb` into `public/assets/` and load it in `viewManager`).
- [ ] Tune View 3 (angled close-up) framing per art style.
- [ ] Optional: free-look/orbit dev camera (kept out of scaffold to avoid fighting the
      view tweens).

## Data & transport
- [ ] WebSocket transport implementation behind the existing `bus.js` interface, so a
      phone/tablet can drive a separate screen across devices.
- [ ] Real data integration: POS sales webhook + door-sensor / people-counter feed,
      emitting the same event types the simulator/pads already use.

## Infra / polish
- [ ] Confirm the GitHub Pages base path matches the repo name in `deploy.yml`.
- [ ] Light visual QA across screen sizes; presenter "kiosk" niceties (hide cursor,
      prevent sleep).
