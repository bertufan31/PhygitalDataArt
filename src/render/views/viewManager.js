// ---------------------------------------------------------------------------
// View / camera manager.
//
// Owns a single perspective camera and tweens it between named mockup views:
//   • head-on : artwork square to camera on black           (View 1 — gallery)
//   • store   : artwork in a lit white niche on a warm wood wall, inside a
//               retail room with white wavy ceiling fins + a teal accent
//               screen, evoking the IQOS boutiques            (View 2)
//   • angled  : framed artwork seen up close at an angle      (View 3 — detail)
//
// It also owns a real picture FRAME (a selectable style — see FRAME_STYLES —
// visible in every view) and the store environment (store view only). Switching
// views just animates the camera, which is why 3D view changes are cheap.
//
// Lighting: warm hemisphere + ambient + a warm key + a cool fill light the
// FRAME and the store's MeshStandardMaterial surfaces. The artwork
// (MeshBasicMaterial) and prism shader are unlit/self-shaded, so the piece
// always reads as a glowing screen regardless of room lighting.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { FRAME_HEIGHT } from '../targets/FlatTarget.js';

const TWEEN_SECONDS = 1.2;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Selectable frame styles. `null` means no frame.
const FRAME_STYLES = {
  niche: { thickness: 0.2, depth: 0.08, material: () => new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.92, metalness: 0.0 }) },
  gallery: { thickness: 0.09, depth: 0.14, material: () => new THREE.MeshStandardMaterial({ color: 0xece5d7, roughness: 0.5, metalness: 0.05 }) },
  dark: { thickness: 0.11, depth: 0.16, material: () => new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.45, metalness: 0.25 }) },
  metallic: { thickness: 0.1, depth: 0.16, material: () => new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.32, metalness: 0.7 }) },
  none: null,
};
export const FRAME_STYLE_IDS = Object.keys(FRAME_STYLES);

export class ViewManager {
  constructor(scene) {
    this.scene = scene;
    this.aspect = 16 / 9;
    this.frameStyle = 'gallery';
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);

    this.frame = null; // picture frame (always visible)
    this.room = null; // store environment (store view only)

    this._addLights();

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
    const hemi = new THREE.HemisphereLight(0xfff4e6, 0x6a5436, 0.5); // bright, airy
    const ambient = new THREE.AmbientLight(0xffe9d2, 0.5);
    const key = new THREE.DirectionalLight(0xfff1de, 1.0); // warm key, upper-right
    key.position.set(3, 4, 5);
    const fill = new THREE.DirectionalLight(0x9ab4ff, 0.18); // cool rim, left
    fill.position.set(-4, 1, 2);
    this.lights.add(hemi, ambient, key, fill);
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
        // Pulled back + up so the ceiling fins and teal screen read.
        pos: new THREE.Vector3(dist * 0.8, 0.62, dist * 1.45),
        target: new THREE.Vector3(-0.05, 0.2, 0),
        room: true,
        bg: new THREE.Color('#141017'),
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

  setFrameStyle(styleId) {
    if (!(styleId in FRAME_STYLES)) return;
    this.frameStyle = styleId;
    this._buildFrame();
  }

  _disposeGroup(group) {
    this.scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  // Real picture frame: four bars bordering the artwork, sitting slightly proud
  // of the art surface, in the currently selected style. Visible in every view.
  _buildFrame() {
    if (this.frame) {
      this._disposeGroup(this.frame);
      this.frame = null;
    }
    const style = FRAME_STYLES[this.frameStyle];
    if (!style) return; // 'none'
    const W = FRAME_HEIGHT * this.aspect;
    const H = FRAME_HEIGHT;
    const ft = style.thickness;
    const fd = style.depth;
    const mat = style.material();
    const group = new THREE.Group();
    const bar = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, fd), mat);
      m.position.set(x, y, fd / 2 - 0.02);
      group.add(m);
    };
    bar(W + 2 * ft, ft, 0, H / 2 + ft / 2);
    bar(W + 2 * ft, ft, 0, -(H / 2 + ft / 2));
    bar(ft, H, -(W / 2 + ft / 2), 0);
    bar(ft, H, W / 2 + ft / 2, 0);
    this.frame = group;
    this.scene.add(group);
  }

  _buildRoom() {
    if (this.room) this._disposeGroup(this.room);
    const W = FRAME_HEIGHT * this.aspect;
    const wallW = Math.max(W * 3.4, 10);
    const floorY = -1.7;
    const ceilY = 1.55;
    const room = new THREE.Group();

    const wood = new THREE.MeshStandardMaterial({ color: 0xdcbb90, roughness: 0.7, metalness: 0.0 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(wallW, 6.5), wood);
    wall.position.z = -0.35;
    room.add(wall);

    // Lit white niche the artwork sits in (the signature recessed look).
    const niche = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.7, FRAME_HEIGHT + 0.7),
      new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.85, emissive: new THREE.Color(0xb59d72), emissiveIntensity: 0.45 }),
    );
    niche.position.z = -0.22;
    room.add(niche);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(wallW, 9),
      new THREE.MeshStandardMaterial({ color: 0xeee7d8, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, floorY, 4.0);
    room.add(floor);

    // Warm backdrop above the fins so the gaps glow warm.
    const ceilBack = new THREE.Mesh(
      new THREE.PlaneGeometry(wallW, 9),
      new THREE.MeshStandardMaterial({ color: 0xf6efe2, roughness: 0.95, emissive: 0x3a2a16, emissiveIntensity: 0.5 }),
    );
    ceilBack.rotation.x = Math.PI / 2;
    ceilBack.position.set(0, ceilY + 0.35, 4.0);
    room.add(ceilBack);

    room.add(this._buildCeilingFins(wallW, ceilY));

    // Warm cove glow where wall meets ceiling.
    const cove = new THREE.Mesh(
      new THREE.BoxGeometry(wallW, 0.07, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffb060 }),
    );
    cove.position.set(0, ceilY - 0.05, -0.2);
    room.add(cove);

    // Teal accent screen on the wall (IQOS branding light), with a soft teal
    // bounce light. Both live in the room group, so they only affect this view.
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 2.5),
      new THREE.MeshBasicMaterial({ color: 0x17a8bd }),
    );
    screen.position.set(-(W / 2 + 1.55), -0.15, -0.33);
    room.add(screen);
    const tealLight = new THREE.PointLight(0x18b5cc, 0.6, 6, 2);
    tealLight.position.set(-(W / 2 + 1.4), 0.1, 0.5);
    room.add(tealLight);

    room.add(this._buildPlant(W / 2 + 1.15, floorY, 0.2));

    room.visible = this._presets()[this.viewId].room;
    this.room = room;
    this.scene.add(room);
  }

  // White wavy ceiling fins/blades — the boutique signature. Thin white slats
  // running across the room, stepped along depth with a gentle sine wave.
  _buildCeilingFins(wallW, ceilY) {
    const fins = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.9, metalness: 0.0 });
    const count = 16;
    for (let i = 0; i < count; i++) {
      const z = -0.5 + (i / (count - 1)) * 5.2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(wallW * 0.94, 0.045, 0.17), mat);
      fin.position.set(0, ceilY + 0.13 * Math.sin(z * 1.15 + 0.4), z);
      fin.rotation.x = 0.16 * Math.sin(z * 1.15);
      fins.add(fin);
    }
    return fins;
  }

  // Simple stylized plant echoing the boutiques' potted greenery.
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
      [0.04, 0.82, -0.02, 0.18],
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
