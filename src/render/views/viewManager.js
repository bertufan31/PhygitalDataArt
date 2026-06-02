// ---------------------------------------------------------------------------
// View / camera manager.
//
// Owns a single perspective camera and tweens it between named mockup views:
//   • head-on : artwork square to camera on black           (View 1 — gallery)
//   • store   : artwork in a lit white niche on a warm wood wall, inside a
//               retail room evoking the real boutiques       (View 2)
//   • angled  : framed artwork seen up close at an angle      (View 3 — detail)
//
// It also owns a real picture FRAME around the artwork (visible in every view)
// and the store environment (shown only in the store view). Switching views just
// animates the camera, which is why 3D view changes are cheap.
//
// Lighting: warm ambient + a warm key + a cool fill light the FRAME and the
// store's MeshStandardMaterial surfaces. The artwork itself (MeshBasicMaterial)
// and the prism shader are unlit/self-shaded, so the piece always reads as a
// glowing screen regardless of the room lighting.
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

    this.frame = null; // picture frame (always visible)
    this.room = null; // store environment (store view only)

    this._addLights();

    // Tween bookkeeping.
    this.viewId = 'head-on';
    this._from = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._to = { pos: new THREE.Vector3(0, 0, 4), target: new THREE.Vector3() };
    this._target = new THREE.Vector3();
    this._t = 1;

    this.setAspect(this.aspect);
    this.camera.position.copy(this._to.pos);
    this._target.copy(this._to.target);
    this.camera.lookAt(this._target);
  }

  _addLights() {
    this.lights = new THREE.Group();
    const ambient = new THREE.AmbientLight(0xffe9d2, 0.72); // warm fill
    const key = new THREE.DirectionalLight(0xfff1de, 1.05); // warm key, upper-right
    key.position.set(3, 4, 5);
    const fill = new THREE.DirectionalLight(0x9ab4ff, 0.18); // cool rim, left
    fill.position.set(-4, 1, 2);
    this.lights.add(ambient, key, fill);
    this.scene.add(this.lights);
  }

  _fitDistance() {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const halfH = FRAME_HEIGHT / 2;
    const halfW = (FRAME_HEIGHT * this.aspect) / 2;
    const dH = halfH / Math.tan(vFov / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dW = halfW / Math.tan(hFov / 2);
    return Math.max(dH, dW) * 1.12;
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
        pos: new THREE.Vector3(dist * 0.8, 0.28, dist * 1.18),
        target: new THREE.Vector3(-0.1, -0.12, 0),
        room: true,
        bg: new THREE.Color('#140d08'),
      },
      angled: {
        pos: new THREE.Vector3(halfW * 0.85, -0.05, dist * 0.52),
        target: new THREE.Vector3(0, 0, 0),
        room: false,
        bg: new THREE.Color('#050505'),
      },
    };
  }

  setAspect(aspect) {
    this.aspect = aspect;
    this._buildFrame();
    this._buildRoom();
    const preset = this._presets()[this.viewId];
    this._to = { pos: preset.pos, target: preset.target };
    if (this._t >= 1) {
      this.camera.position.copy(this._to.pos);
      this._target.copy(this._to.target);
      this.camera.lookAt(this._target);
    }
  }

  _disposeGroup(group) {
    this.scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  // A real picture frame: four bevelled bars bordering the artwork, sitting
  // slightly proud of the art surface. Warm satin off-white so it reads on both
  // black (gallery views) and the wood wall (store), matching the white niches
  // in the reference boutiques.
  _buildFrame() {
    if (this.frame) this._disposeGroup(this.frame);
    const W = FRAME_HEIGHT * this.aspect;
    const H = FRAME_HEIGHT;
    const ft = 0.09; // frame bar thickness
    const fd = 0.14; // frame depth (toward viewer)
    const mat = new THREE.MeshStandardMaterial({ color: 0xece5d7, roughness: 0.5, metalness: 0.05 });
    const group = new THREE.Group();
    const bar = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, fd), mat);
      m.position.set(x, y, fd / 2 - 0.02);
      group.add(m);
    };
    bar(W + 2 * ft, ft, 0, H / 2 + ft / 2); // top
    bar(W + 2 * ft, ft, 0, -(H / 2 + ft / 2)); // bottom
    bar(ft, H, -(W / 2 + ft / 2), 0); // left
    bar(ft, H, W / 2 + ft / 2, 0); // right
    this.frame = group;
    this.scene.add(group);
  }

  _buildRoom() {
    if (this.room) this._disposeGroup(this.room);
    const W = FRAME_HEIGHT * this.aspect;
    const wallW = Math.max(W * 3.2, 9);
    const floorY = -1.7;
    const ceilY = 1.8;
    const room = new THREE.Group();

    const wood = new THREE.MeshStandardMaterial({ color: 0xd8b78c, roughness: 0.7, metalness: 0.0 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(wallW, 6.5), wood);
    wall.position.z = -0.35;
    room.add(wall);

    // Lit white niche the artwork sits in (the signature recessed look).
    const niche = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.7, FRAME_HEIGHT + 0.7),
      new THREE.MeshStandardMaterial({
        color: 0xf5f2ea,
        roughness: 0.85,
        emissive: new THREE.Color(0xb59d72),
        emissiveIntensity: 0.5,
      }),
    );
    niche.position.z = -0.22;
    room.add(niche);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(wallW, 9),
      new THREE.MeshStandardMaterial({ color: 0xe8dfd0, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, floorY, 4.0);
    room.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(wallW, 9),
      new THREE.MeshStandardMaterial({ color: 0xf2ece2, roughness: 0.95 }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, ceilY, 4.0);
    room.add(ceil);

    // Warm cove glow where the wall meets the ceiling (unlit emissive strip).
    const cove = new THREE.Mesh(
      new THREE.BoxGeometry(wallW, 0.07, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffb060 }),
    );
    cove.position.set(0, ceilY - 0.15, -0.2);
    room.add(cove);

    room.add(this._buildPlant(-(W / 2 + 1.0), floorY, -0.05));

    room.visible = this._presets()[this.viewId].room;
    this.room = room;
    this.scene.add(room);
  }

  // A simple stylized plant to add life, echoing the boutiques' potted greenery.
  _buildPlant(x, floorY, z) {
    const plant = new THREE.Group();
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.17, 0.4, 18),
      new THREE.MeshStandardMaterial({ color: 0xe7decd, roughness: 0.85 }),
    );
    pot.position.set(x, floorY + 0.2, z);
    plant.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6b42, roughness: 0.8 });
    const blobs = [
      [0.0, 0.62, 0.0, 0.26],
      [0.16, 0.5, 0.06, 0.2],
      [-0.15, 0.52, -0.04, 0.19],
      [0.04, 0.8, -0.02, 0.18],
    ];
    for (const [dx, dy, dz, r] of blobs) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat);
      leaf.position.set(x + dx, floorY + dy, z + dz);
      leaf.scale.y = 1.4;
      plant.add(leaf);
    }
    return plant;
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
    this.setAspect(this.aspect);
  }
}
