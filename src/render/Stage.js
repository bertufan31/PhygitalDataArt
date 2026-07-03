// ---------------------------------------------------------------------------
// Stage — the render orchestrator.
//
// Composes the layers and runs the frame loop:
//   active ART renders into its own texture
//     ▸ a per-art duotone COLOUR GRADE re-themes it
//       ▸ active DISPLAY TARGET (flat plane / prism grid) shows the graded result
//         ▸ active VIEW (camera) frames it, drawn to the canvas.
//
// State is the single source of truth; the Stage just realises it.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { getArt } from '../art/registry.js';
import { mergedArtParams } from '../art/params.js';
import { FlatTarget, FRAME_HEIGHT } from './targets/FlatTarget.js';
import { PrismTarget } from './targets/PrismTarget.js';
import { ColorGrade } from './ColorGrade.js';
import { PhotoView } from './PhotoView.js';
import { ViewManager } from './views/viewManager.js';
import { getBrand, brandColorParams } from '../core/brands.js';

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
    this.grade = new ColorGrade(this._artSize);
    this.photoView = new PhotoView(); // View 2 store-photo composite
    this.photoView.setArtTexture(this.grade.texture);

    // For the store mockup we capture the active display TARGET (flat plane or
    // 3D prism wall) front-on into this buffer, then map it onto the niche — so
    // the LED-prism wall is previewable inside the store, not just head-on.
    this.nicheRT = new THREE.WebGLRenderTarget(this._artSize.width, this._artSize.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    this.nicheRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.nicheCam = new THREE.PerspectiveCamera(45, this._frameAspect(), 0.1, 100);
    this._black = new THREE.Color('#000000');
    this._layoutNicheCam();

    this.views.setAspect(this._frameAspect());
    this.views.setFrameStyle(state.frameStyle || 'gallery');

    this._brandColors = null; // live brand theme, once a brand is explicitly chosen
    this.setArt(state.artId);
    this.setTarget(state.targetId);
    this.setView(state.viewId);
    this.resize();
    this._initPointer();
    window.addEventListener('resize', () => this.resize());
  }

  // Forward pointer/touch on the canvas to the active art (in NDC). Used by the
  // touch-interaction concept; arts that ignore it are unaffected.
  _initPointer() {
    this.canvas.style.touchAction = 'none';
    this._px = 0; this._py = 0; this._pointerDown = false;
    const ndc = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this._px = ((e.clientX - r.left) / r.width) * 2 - 1;
      this._py = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const send = () => this.art && this.art.setPointer(this._px, this._py, this._pointerDown);
    this.canvas.addEventListener('pointerdown', (e) => { this._pointerDown = true; ndc(e); send(); });
    this.canvas.addEventListener('pointermove', (e) => { ndc(e); if (this._pointerDown) send(); });
    const release = () => { this._pointerDown = false; send(); };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointerleave', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  _frameAspect() {
    return this.state.frame.w / this.state.frame.h;
  }

  _computeArtSize(frame) {
    const aspect = frame.w / frame.h;
    return aspect >= 1
      ? { width: ART_BASE_RESOLUTION, height: Math.round(ART_BASE_RESOLUTION / aspect) }
      : { width: Math.round(ART_BASE_RESOLUTION * aspect), height: ART_BASE_RESOLUTION };
  }

  // The brand an art is themed by — some arts are pinned to one (fixedBrand).
  _themeBrandId(ArtClass) {
    return (ArtClass && ArtClass.fixedBrand) || this.state.activeBrandId;
  }

  // Apply the grade theme. Every art keeps its OWN palette (defaults + user
  // edits) unless it explicitly opts into brand re-theming (static brandTheme —
  // the brand-morphing pieces, where palette/background follow the brand).
  _applyGradeTheme(ArtClass) {
    if (ArtClass && ArtClass.brandTheme) {
      this.grade.setColors(brandColorParams(getBrand(this.state.brands, this._themeBrandId(ArtClass))));
    } else {
      this.grade.setColors(mergedArtParams(this.state, ArtClass.id, ArtClass));
    }
  }

  // Colour the prism wall by rise (brand primary→secondary) for arts that ask
  // for it; otherwise the wall uses the sampled artwork colour.
  _applyPrismRamp() {
    if (this.state.targetId !== 'prism' || !this.target || !this.target.setHeightRamp) return;
    const ArtClass = getArt(this.state.artId);
    if (ArtClass && ArtClass.prismRamp) {
      const pal = getBrand(this.state.brands, this.state.activeBrandId).palette;
      this.target.setHeightRamp(pal.background, pal.primary); // low rise = bg, high rise = primary
    } else {
      this.target.clearHeightRamp();
    }
  }

  setArt(artId) {
    const ArtClass = getArt(artId) || getArt(this.state.artId);
    if (!ArtClass) return;
    if (this.art) this.art.destroy();
    this.art = new ArtClass();
    const params = mergedArtParams(this.state, ArtClass.id, ArtClass);
    this.art.init({ renderer: this.renderer, size: this._artSize, frame: this.state.frame, params });
    this.art.setParams(params);
    this.state.artId = ArtClass.id;
    this.grade.setSource(this.art.texture);
    this._applyGradeTheme(ArtClass); // own palette, or brand palette for brandTheme arts
    const themeId = this._themeBrandId(ArtClass);
    this.art.setBrand(themeId, getBrand(this.state.brands, themeId)); // morph / re-dress
    if (ArtClass.noPrism && this.state.targetId === 'prism') this.setTarget('flat');
    else if (ArtClass.prismOnly && this.state.targetId !== 'prism') this.setTarget('prism');
    if (this.target) this.target.setTexture(this.grade.texture);
    this._applyPrismRamp();
  }

  /**
   * Make a brand the focus: brand-aware arts (e.g. Key Particles) morph toward
   * its form, and the whole piece is re-themed to the brand palette/background.
   * Arts pinned to a brand (fixedBrand) are unaffected by the grade re-theme.
   */
  setActiveBrand(brandId) {
    const prevId = this.state.activeBrandId;
    this.state.activeBrandId = brandId;
    this._brandColors = brandColorParams(getBrand(this.state.brands, brandId));
    const ArtClass = getArt(this.state.artId);
    this._applyGradeTheme(ArtClass);
    // Prism-ramp arts (Presence Prisms) morph the logo + cross-fade the colour
    // spectrum smoothly; everything else changes instantly.
    if (ArtClass?.prismRamp && prevId !== brandId && this.target?.crossfadeRamp && this.state.targetId === 'prism') {
      const np = getBrand(this.state.brands, brandId).palette;
      this.target.crossfadeRamp(np.background, np.primary);
      if (this.art) this.art.setBrand(brandId, getBrand(this.state.brands, brandId)); // rotating cross-morph
    } else {
      if (this.art) {
        const themeId = this._themeBrandId(ArtClass);
        this.art.setBrand(themeId, getBrand(this.state.brands, themeId));
      }
      this._applyPrismRamp();
    }
  }

  setTarget(targetId) {
    const ArtClass = getArt(this.state.artId);
    if (targetId === 'prism' && ArtClass?.noPrism) targetId = 'flat'; // art opts out of prisms
    if (targetId !== 'prism' && ArtClass?.prismOnly) targetId = 'prism'; // art needs prisms
    if (this.target) this.target.dispose(this.scene);
    const aspect = this._frameAspect();
    if (targetId === 'prism') {
      this.target = new PrismTarget({ aspect, prism: this.state.prism });
    } else {
      targetId = 'flat';
      this.target = new FlatTarget({ aspect });
    }
    this.target.addTo(this.scene);
    this.target.setTexture(this.grade.texture);
    this.state.targetId = targetId;
    this._applyPrismRamp();
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
    this.grade.setSize(this._artSize);
    this.nicheRT.setSize(this._artSize.width, this._artSize.height);
    this._layoutNicheCam();
    this.views.setAspect(this._frameAspect());
    this.setTarget(this.state.targetId); // rebuild target geometry at the new aspect
  }

  // Front-on camera that frames the target's standard footprint (FRAME_HEIGHT ×
  // aspect) so a capture fills the niche buffer edge-to-edge.
  _layoutNicheCam() {
    const vFov = THREE.MathUtils.degToRad(45);
    const d = (FRAME_HEIGHT / 2) / Math.tan(vFov / 2) * 1.04; // 4% breathing room
    this.nicheCam.aspect = this._frameAspect();
    this.nicheCam.position.set(0, 0, d);
    this.nicheCam.lookAt(0, 0, 0);
    this.nicheCam.updateProjectionMatrix();
  }

  // Render only the display target (no frame/room, on black) front-on into the
  // niche buffer, for compositing into the store photo.
  _captureTargetToNiche() {
    const frame = this.views.frame;
    const room = this.views.room;
    const fv = frame ? frame.visible : false;
    const rv = room ? room.visible : false;
    if (frame) frame.visible = false;
    if (room) room.visible = false;
    const bg = this.scene.background;
    this.scene.background = this._black;
    this.renderer.setRenderTarget(this.nicheRT);
    this.renderer.render(this.scene, this.nicheCam);
    this.renderer.setRenderTarget(null);
    this.scene.background = bg;
    if (frame) frame.visible = fv;
    if (room) room.visible = rv;
  }

  setPrism(prism) {
    this.state.prism = { ...this.state.prism, ...prism };
    if (this.state.targetId === 'prism') this.setTarget('prism');
  }

  /** Apply a per-art parameter change (colours via the grade, knobs via the art). */
  setArtParam(artId) {
    if (artId !== this.state.artId || !this.art) return;
    const params = mergedArtParams(this.state, artId, getArt(artId));
    this.grade.setColors(params);
    this.art.setParams(params);
  }

  onEvent(event) {
    if (this.art) this.art.onEvent(event);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.views.resize(w, h);
    this.photoView.layout(w / h);
  }

  start() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1); // clamp after tab-switch stalls
      if (this.art) {
        this.art.update(dt); // renders art into its own target
        this.grade.render(this.renderer); // re-theme into the graded target
      }
      if (this.state.viewId === 'store') {
        // Show the active target inside the niche: the 3D prism wall is captured
        // front-on; the flat screen is just the graded art texture.
        if (this.state.targetId === 'prism' && this.target) {
          if (this.target.update) this.target.update(this.renderer, dt); // prism easing
          this._captureTargetToNiche();
          this.photoView.setArtTexture(this.nicheRT.texture);
        } else {
          this.photoView.setArtTexture(this.grade.texture);
        }
        this.photoView.render(this.renderer); // store-photo composite
      } else {
        if (this.target && this.target.update) this.target.update(this.renderer, dt); // prism easing
        this.views.update(dt);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.views.camera);
      }
    };
    loop();
  }
}
