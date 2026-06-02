// ---------------------------------------------------------------------------
// View / camera manager.
//
// Owns a single perspective camera and tweens it between named mockup views:
//   • head-on : artwork square to camera on a black screen  (View 1 — final)
//   • store   : artwork on a wall inside a placeholder room  (View 2 — stub
//               room until the user supplies the real 3D store model)
//   • angled  : artwork seen up close at an angle             (View 3 — stub)
//
// Switching views just animates the camera position + look-at target, which is
// why 3D view changes are cheap. It also owns a thin "frame bezel" around the
// artwork and a simple placeholder room, both rebuilt when the frame aspect
// changes. No scene lights are needed: every material is either unlit
// (MeshBasicMaterial) or self-shaded (the prism shader).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { FRAME_HEIGHT } from '../targets/FlatTarget.js';

const TWEEN_SECONDS = 1.2;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class ViewManager {
  constructor(scene) {
    this.scene = scene;
    this.aspect = 16 / 9;
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);

    this.bezel = null;
    this.room = null;

    // Tween bookkeeping.
    this.viewId = 'head-on';
    this._from = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._to = { pos: new THREE.Vector3(0, 0, 4), target: new THREE.Vector3() };
    this._target = new THREE.Vector3(); // current look-at, lerped each frame
    this._t = 1; // 1 = settled

    this.setAspect(this.aspect);
    this.camera.position.copy(this._to.pos);
    this._target.copy(this._to.target);
    this.camera.lookAt(this._target);
  }

  /** Distance needed to frame the whole artwork given the current viewport. */
  _fitDistance() {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const halfH = FRAME_HEIGHT / 2;
    const halfW = (FRAME_HEIGHT * this.aspect) / 2;
    const dH = halfH / Math.tan(vFov / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dW = halfW / Math.tan(hFov / 2);
    return Math.max(dH, dW) * 1.12; // small margin
  }

  _presets() {
    const dist = this._fitDistance();
    const halfW = (FRAME_HEIGHT * this.aspect) / 2;
    return {
      'head-on': {
        pos: new THREE.Vector3(0, 0, dist),
        target: new THREE.Vector3(0, 0, 0),
        room: false,
        bg: new THREE.Color('#000000'),
      },
      store: {
        pos: new THREE.Vector3(dist * 0.85, 0.65, dist * 1.4),
        target: new THREE.Vector3(0, 0, 0),
        room: true,
        bg: new THREE.Color('#0b0d12'),
      },
      angled: {
        pos: new THREE.Vector3(halfW * 0.8, -0.15, dist * 0.6),
        target: new THREE.Vector3(0, 0, 0),
        room: false,
        bg: new THREE.Color('#000000'),
      },
    };
  }

  setAspect(aspect) {
    this.aspect = aspect;
    this._buildBezel();
    this._buildRoom();
    // Re-aim at the active view's (recomputed) pose without re-animating.
    const preset = this._presets()[this.viewId];
    this._to = { pos: preset.pos, target: preset.target };
    if (this._t >= 1) {
      this.camera.position.copy(this._to.pos);
      this._target.copy(this._to.target);
      this.camera.lookAt(this._target);
    }
  }

  _buildBezel() {
    if (this.bezel) {
      this.scene.remove(this.bezel);
      this.bezel.geometry.dispose();
      this.bezel.material.dispose();
    }
    const margin = 0.12;
    const w = FRAME_HEIGHT * this.aspect + margin;
    const geo = new THREE.PlaneGeometry(w, FRAME_HEIGHT + margin);
    const mat = new THREE.MeshBasicMaterial({ color: 0x050507 });
    this.bezel = new THREE.Mesh(geo, mat);
    this.bezel.position.z = -0.02; // sits just behind the artwork as a thin border
    this.scene.add(this.bezel);
  }

  _buildRoom() {
    if (this.room) {
      this.scene.remove(this.room);
      this.room.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    const width = FRAME_HEIGHT * this.aspect;
    const room = new THREE.Group();

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 4, FRAME_HEIGHT * 3),
      new THREE.MeshBasicMaterial({ color: 0x15181f }),
    );
    back.position.z = -0.35;
    room.add(back);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x0e1016 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -FRAME_HEIGHT / 2, 4 - 0.35);
    room.add(floor);

    this.room = room;
    room.visible = this._presets()[this.viewId].room;
    this.scene.add(room);
  }

  setView(viewId) {
    const preset = this._presets()[viewId];
    if (!preset) return;
    this.viewId = viewId;
    this._from = { pos: this.camera.position.clone(), target: this._target.clone() };
    this._to = { pos: preset.pos, target: preset.target };
    this._t = 0;
    this.scene.background = preset.bg;
    if (this.room) this.room.visible = preset.room;
  }

  update(dt) {
    if (this._t >= 1) return;
    this._t = Math.min(1, this._t + dt / TWEEN_SECONDS);
    const e = easeInOut(this._t);
    this.camera.position.lerpVectors(this._from.pos, this._to.pos, e);
    this._target.lerpVectors(this._from.target, this._to.target, e);
    this.camera.lookAt(this._target);
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.setAspect(this.aspect); // refit framing to the new viewport
  }
}
