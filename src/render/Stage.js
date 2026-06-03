// ---------------------------------------------------------------------------
// Stage — the render orchestrator.
//
// Composes the three independent layers and runs the frame loop:
//   active ART renders into its own texture
//     ▸ active DISPLAY TARGET (flat plane / prism grid) shows that texture
//       ▸ active VIEW (camera) frames the result, drawn to the canvas.
//
// It also turns state changes (from the control panel or the hamburger menu)
// into concrete swaps/rebuilds. State is the single source of truth; Stage just
// realises it.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { getArt } from '../art/registry.js';
import { FlatTarget } from './targets/FlatTarget.js';
import { PrismTarget } from './targets/PrismTarget.js';
import { ViewManager } from './views/viewManager.js';

const ART_BASE_RESOLUTION = 1024;

export class Stage {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.state = state;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');
    this.clock = new THREE.Clock();

    this.art = null;
    this.target = null;
    this.views = new ViewManager(this.scene);

    this._artSize = this._computeArtSize(state.frame);
    this.views.setAspect(this._frameAspect());
    this.views.setFrameStyle(state.frameStyle || 'gallery');

    this.setArt(state.artId);
    this.setTarget(state.targetId);
    this.setView(state.viewId);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _frameAspect() {
    return this.state.frame.w / this.state.frame.h;
  }

  /** Fixed-area art render resolution at the frame's aspect ratio. */
  _computeArtSize(frame) {
    const aspect = frame.w / frame.h;
    return aspect >= 1
      ? { width: ART_BASE_RESOLUTION, height: Math.round(ART_BASE_RESOLUTION / aspect) }
      : { width: Math.round(ART_BASE_RESOLUTION * aspect), height: ART_BASE_RESOLUTION };
  }

  setArt(artId) {
    const ArtClass = getArt(artId) || getArt(this.state.artId);
    if (!ArtClass) return;
    if (this.art) this.art.destroy();
    this.art = new ArtClass();
    this.art.init({ renderer: this.renderer, size: this._artSize, frame: this.state.frame });
    this.state.artId = ArtClass.id;
    if (this.target) this.target.setTexture(this.art.texture);
  }

  setTarget(targetId) {
    if (this.target) this.target.dispose(this.scene);
    const aspect = this._frameAspect();
    if (targetId === 'prism') {
      this.target = new PrismTarget({ aspect, prism: this.state.prism });
    } else {
      targetId = 'flat';
      this.target = new FlatTarget({ aspect });
    }
    this.target.addTo(this.scene);
    if (this.art) this.target.setTexture(this.art.texture);
    this.state.targetId = targetId;
  }

  setView(viewId) {
    this.views.setView(viewId);
    this.state.viewId = viewId;
  }

  setFrameStyle(styleId) {
    this.views.setFrameStyle(styleId);
    this.state.frameStyle = styleId;
  }

  setFrame(frame) {
    this.state.frame = { ...this.state.frame, ...frame };
    this._artSize = this._computeArtSize(this.state.frame);
    if (this.art) this.art.resize(this._artSize);
    this.views.setAspect(this._frameAspect());
    this.setTarget(this.state.targetId); // rebuild target geometry at the new aspect
  }

  setPrism(prism) {
    this.state.prism = { ...this.state.prism, ...prism };
    if (this.state.targetId === 'prism') this.setTarget('prism');
  }

  onEvent(event) {
    if (this.art) this.art.onEvent(event);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.views.resize(w, h);
  }

  start() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1); // clamp after tab-switch stalls
      if (this.art) this.art.update(dt); // renders art into its own target
      if (this.target && this.target.update) this.target.update(this.renderer, dt); // prism easing pass
      this.views.update(dt);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.views.camera);
    };
    loop();
  }
}
