// ---------------------------------------------------------------------------
// Art option: "Vitrine" — a window into a real space.
//
// Unlike every other (shader-field) option, this is a physically-lit 3D room
// seen through a window: large bevelled cubes and smaller spheres hang unevenly
// in the depth, lit from above by a soft key light that drops real shadows onto
// the floor and back wall. ACES tone mapping + an environment map give the
// materials weight — you should feel you could grab them.
//
// Life cycle: objects are BORN deep in the room (scaling in), drift slowly
// toward the window with a gentle roll; whatever leaves the canvas is gone —
// new ones keep being born in the depth, so the front is always on the move.
//
// Brand identity lives in the MATERIALS (this art opts out of the duotone
// grade — `ownLook`):
//   IQOS — brushed-metal cubes · cloth spheres (sheen + weave) · dark slate room
//   ZYN  — white plastic cubes · cream paper spheres · light airy room
//   VEEV — dark gunmetal cubes · see-through black plastic spheres · near-black room
//
// TOUCH: press and hold — the objects part away from your finger and the brand
// mark glows deep in the room (IQOS emblem / ZYN wordmark / VEEV V); release
// and they drift back. No LED-prism target for this piece (`noPrism`).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { EventTypes } from '../../core/events.js';
import { Eased } from '../effects.js';
import { BRAND_SILHOUETTES } from '../../core/brandSilhouettes.data.js';
import { drawBrandGlyph } from '../../core/brandGlyph.js';

const ROOM = { left: -3.6, right: 3.6, top: 2.1, bottom: -2.2, back: -8.6, exitZ: 2.0, bornZ: -7.6 };

// --- procedural material textures (no external assets) ---------------------
function canvasTex(size, draw, repeat = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}
const noiseFill = (ctx, s, base, amp, cell = 1) => {
  for (let y = 0; y < s; y += cell) {
    for (let x = 0; x < s; x += cell) {
      const v = Math.max(0, Math.min(255, base + (Math.random() - 0.5) * amp));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, cell, cell);
    }
  }
};
const clothBump = () => canvasTex(256, (ctx, s) => {
  noiseFill(ctx, s, 128, 40, 2);
  ctx.globalAlpha = 0.5;
  for (let y = 0; y < s; y += 4) { ctx.fillStyle = y % 8 ? '#9a9a9a' : '#c8c8c8'; ctx.fillRect(0, y, s, 2); }
  for (let x = 0; x < s; x += 4) { ctx.fillStyle = x % 8 ? '#9f9f9f' : '#c2c2c2'; ctx.fillRect(x, 0, 2, s); }
  ctx.globalAlpha = 1;
}, 6);
const paperBump = () => canvasTex(256, (ctx, s) => noiseFill(ctx, s, 132, 26, 1), 4);
const brushedRough = () => canvasTex(256, (ctx, s) => {
  noiseFill(ctx, s, 110, 22, 2);
  ctx.globalAlpha = 0.45;
  for (let y = 0; y < s; y++) {
    const v = 90 + Math.random() * 70;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, s, 1);
  }
  ctx.globalAlpha = 1;
}, 2);

// --- brand logo → glowing texture (crisp glyph + soft halo) ----------------
function glyphCanvas(brandId) {
  const sil = BRAND_SILHOUETTES[brandId];
  const W = 1024, H = sil && sil.aspect > 1.4 ? 420 : 1024;
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = H;
  drawBrandGlyph(mask.getContext('2d'), W, H, brandId);
  // halo + crisp composite
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.filter = 'blur(22px)';
  ctx.globalAlpha = 0.9;
  ctx.drawImage(mask, 0, 0);
  ctx.drawImage(mask, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.drawImage(mask, 0, 0);
  return out;
}

export class Vitrine extends BaseArt {
  static id = 'vitrine';
  static label = 'Vitrine';
  static ownLook = true; // brand identity lives in the PBR materials, not the grade
  static noPrism = true; // a realistic window doesn't translate to the LED wall
  static params = [
    { key: 'cubes', type: 'range', label: 'Cubes', min: 4, max: 36, step: 1, default: 14 },
    { key: 'spheres', type: 'range', label: 'Spheres', min: 6, max: 70, step: 1, default: 30 },
    { key: 'driftSpeed', type: 'range', label: 'Drift', min: 0.2, max: 2.5, step: 0.1, default: 1 },
    { key: 'scale', type: 'range', label: 'Object scale', min: 0.5, max: 1.8, step: 0.05, default: 1 },
  ];

  init(ctx) {
    this.renderer = ctx.renderer;
    this.size = ctx.size;
    this.time = 0;
    this.cubes = 14;
    this.spheres = 30;
    this.driftSpeed = 1;
    this.objScale = 1;
    this.brandId = null;
    this.reveal = 0;
    this._ptrActive = false;
    this._ptr = new THREE.Vector2(0, 0);
    this._ptrWorld = new THREE.Vector2(0, 0);
    this.lightPulse = new Eased(0, { max: 1, decay: 1.2, rise: 6 });
    this.signPulse = new Eased(0, { max: 1, decay: 0.9, rise: 6 });
    this.jolt = new Eased(0, { max: 1, decay: 1.6, rise: 8 });

    // Realism settings (global on the shared renderer; tone mapping restored on destroy).
    this._prevToneMapping = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;

    const aspect = this.size.width / this.size.height;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 40);
    this.camera.position.set(0, 0, 4.6);
    this.camera.lookAt(0, 0, -2);

    // Light from the top (the brief), dropping real shadows.
    this.key = new THREE.DirectionalLight(0xffffff, 2.6);
    this.key.position.set(0.6, 7.5, 1.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.left = -6; this.key.shadow.camera.right = 6;
    this.key.shadow.camera.top = 6; this.key.shadow.camera.bottom = -6;
    this.key.shadow.camera.near = 1; this.key.shadow.camera.far = 20;
    this.key.shadow.bias = -0.0004;
    this.scene.add(this.key);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x303438, 0.5);
    this.scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0xbfd4ff, 0.35);
    this.fill.position.set(-4, 1.5, 3);
    this.scene.add(this.fill);
    // Rim/back light — lifts dark materials off a dark room (product-photo style).
    this.rim = new THREE.DirectionalLight(0xdfe8ff, 0.4);
    this.rim.position.set(-3, 4.5, -6);
    this.scene.add(this.rim);

    // Room: floor + back wall receive the falling shadows.
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.95 });
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = ROOM.bottom - 0.45;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), this.wallMat);
    wall.position.z = ROOM.back - 0.4;
    wall.receiveShadow = true;
    this.scene.add(wall);

    // Shared geometries + texture set.
    this.cubeGeo = new RoundedBoxGeometry(1, 1, 1, 4, 0.07);
    this.sphereGeo = new THREE.SphereGeometry(0.5, 48, 32);
    this.tex = { cloth: clothBump(), paper: paperBump(), brushed: brushedRough() };

    // Brand material kits + room moods (fill = secondary light intensity/colour).
    this.kits = {
      iqos: {
        cube: new THREE.MeshStandardMaterial({ color: 0xc9d2da, metalness: 1, roughness: 0.42, roughnessMap: this.tex.brushed, envMapIntensity: 1.2 }),
        sphere: new THREE.MeshPhysicalMaterial({ color: 0x46606e, metalness: 0, roughness: 0.95, bumpMap: this.tex.cloth, bumpScale: 0.6, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x9fc4d4), envMapIntensity: 0.45 }),
        bg: 0x141a22, floor: 0x161c25, wall: 0x121720, fog: 0.075,
        key: 2.6, hemi: 0.5, fill: 0.35, fillColor: 0xbfd4ff, rim: 0.45, logo: 0xeaf7ff,
      },
      zyn: {
        // dark navy room so the pale objects pop; cubes get a clear ZYN-blue cast
        cube: new THREE.MeshPhysicalMaterial({ color: 0x9fd4ec, metalness: 0, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 1.0 }),
        sphere: new THREE.MeshStandardMaterial({ color: 0xefe3c8, metalness: 0, roughness: 0.93, bumpMap: this.tex.paper, bumpScale: 0.35, envMapIntensity: 0.55 }),
        bg: 0x0c1d2d, floor: 0x112638, wall: 0x0a1926, fog: 0.045,
        key: 3.0, hemi: 0.7, fill: 0.5, fillColor: 0x9fd8ff, rim: 0.4, logo: 0x00a9e0,
      },
      veev: {
        cube: new THREE.MeshStandardMaterial({ color: 0x4d535c, metalness: 1, roughness: 0.4, roughnessMap: this.tex.brushed, envMapIntensity: 1.7 }),
        sphere: new THREE.MeshPhysicalMaterial({ color: 0x101014, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.6, clearcoat: 1, clearcoatRoughness: 0.08, ior: 1.45, envMapIntensity: 1.8 }),
        bg: 0x101218, floor: 0x161823, wall: 0x0e1018, fog: 0.07,
        // brighter dark room: strong key + lilac fill + white-blue rim as extra sources
        key: 3.4, hemi: 0.75, fill: 1.0, fillColor: 0xb89fef, rim: 1.3, logo: 0xb89fef,
      },
    };

    // The brand mark — a glowing sign deep in the room, revealed on touch.
    this.signMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.signMat);
    this.sign.position.set(0, 0.1, -5.6);
    this.sign.renderOrder = 2;
    this.scene.add(this.sign);
    this._signTextures = {}; // brandId → CanvasTexture cache

    this.objects = [];
    this._applyKit('iqos');
    this._buildObjects();

    this.renderTarget = new THREE.WebGLRenderTarget(this.size.width, this.size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  _kitId(brandId) { return this.kits[brandId] ? brandId : 'iqos'; }

  // CMS-uploaded textures become standalone OPAQUE material variants so the
  // uploaded image always reads as the surface — independent of the brand's
  // own (diffuse / transparent / fogged) material. One variant per texture;
  // objects pick by index, so multiple textures distribute across them.
  _buildVariants() {
    this._disposeVariants();
    const make = (kind, list) => (list || []).slice(0, 8).map((t) => {
      const tex = new THREE.TextureLoader().load(t.src);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return new THREE.MeshStandardMaterial({
        map: tex,
        roughness: kind === 'cube' ? 0.5 : 0.8,
        metalness: kind === 'cube' ? 0.3 : 0.0,
        envMapIntensity: 0.5,
      });
    });
    this._cubeVar = make('cube', this.brandData?.textures?.cubes);
    this._sphereVar = make('sphere', this.brandData?.textures?.spheres);
  }

  _disposeVariants() {
    for (const m of [...(this._cubeVar || []), ...(this._sphereVar || [])]) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    this._cubeVar = [];
    this._sphereVar = [];
  }

  _materialFor(kind, idx) {
    const kit = this.kits[this._kitId(this.brandId)];
    const variants = kind === 'cube' ? this._cubeVar : this._sphereVar;
    return variants && variants.length ? variants[idx % variants.length] : (kind === 'cube' ? kit.cube : kit.sphere);
  }

  _applyKit(brandId) {
    const id = this._kitId(brandId);
    const kit = this.kits[id];
    this.scene.background = new THREE.Color(kit.bg);
    this.scene.fog = new THREE.FogExp2(kit.bg, kit.fog);
    this.floorMat.color.set(kit.floor);
    this.wallMat.color.set(kit.wall);
    this.key.intensity = kit.key;
    this.hemi.intensity = kit.hemi;
    this.fill.intensity = kit.fill;
    this.fill.color.set(kit.fillColor);
    this.rim.intensity = kit.rim;
    this._buildVariants();
    for (const o of this.objects) {
      o.mesh.material = this._materialFor(o.kind, o.idx);
    }
    // Brand sign texture + glow colour + plane aspect.
    if (!this._signTextures[id]) {
      const c = glyphCanvas(id === 'iqos' ? null : id);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      this._signTextures[id] = { tex: t, aspect: c.width / c.height };
    }
    const s = this._signTextures[id];
    this.signMat.map = s.tex;
    this.signMat.color.set(kit.logo);
    this.signMat.needsUpdate = true;
    const h = s.aspect > 1.6 ? 1.7 : 3.0;
    this.sign.scale.set(h * s.aspect, h, 1);
  }

  _spawn(kind, initial) {
    const idx = this.objects.length;
    const mesh = new THREE.Mesh(kind === 'cube' ? this.cubeGeo : this.sphereGeo, this._materialFor(kind, idx));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const o = { mesh, kind, idx, home: new THREE.Vector3(), base: 1, kR: kind === 'cube' ? 0.6 : 0.5, curR: 0.3, age: 0, vz: 0, vx: 0, rot: new THREE.Vector3(), spin: new THREE.Vector3() };
    this._reseed(o, initial);
    this.scene.add(mesh);
    return o;
  }

  // Place an object: newborns appear deep in the room; the initial population
  // is spread through the whole depth so the window opens already alive.
  // Retries a few spots so solid objects don't spawn inside each other.
  _reseed(o, initial = false) {
    const big = o.kind === 'cube';
    o.base = (big ? 0.65 + Math.random() * 0.75 : 0.16 + Math.random() * 0.26) * this.objScale;
    o.curR = o.base * o.kR;
    for (let tries = 0; tries < 9; tries++) {
      o.home.set(
        THREE.MathUtils.lerp(ROOM.left, ROOM.right, Math.random()),
        THREE.MathUtils.lerp(ROOM.bottom, ROOM.top, Math.random()),
        initial ? THREE.MathUtils.lerp(ROOM.bornZ, ROOM.exitZ - 0.8, Math.random()) : ROOM.bornZ + Math.random() * 0.8,
      );
      let clear = true;
      for (const other of this.objects) {
        if (other === o) continue;
        const rr = o.curR + other.curR;
        if (o.home.distanceToSquared(other.home) < rr * rr) { clear = false; break; }
      }
      if (clear) break;
    }
    o.age = initial ? 2 : 0; // newborns scale in; initial population is grown
    o.vz = 0.10 + Math.random() * 0.16;
    o.vx = (Math.random() - 0.5) * 0.05;
    o.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    o.spin.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.2);
  }

  _buildObjects() {
    for (const o of this.objects) this.scene.remove(o.mesh);
    this.objects = [];
    for (let i = 0; i < this.cubes; i++) this.objects.push(this._spawn('cube', true));
    for (let i = 0; i < this.spheres; i++) this.objects.push(this._spawn('sphere', true));
  }

  // SOLID BODIES: firm pairwise separation (positional relaxation) on either the
  // `home` targets or the rendered mesh positions, so objects hit and push each
  // other apart instead of interpenetrating. Several iterations → rigid contact.
  _relax(iters, onHome) {
    const objs = this.objects;
    for (let it = 0; it < iters; it++) {
      for (let a = 0; a < objs.length; a++) {
        const A = objs[a]; const pa = onHome ? A.home : A.mesh.position;
        for (let b = a + 1; b < objs.length; b++) {
          const B = objs[b]; const pb = onHome ? B.home : B.mesh.position;
          const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
          const rr = A.curR + B.curR;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-9) continue;
          const d = Math.sqrt(d2);
          const push = (rr - d) * 0.5;            // split the overlap between the pair
          const nx = dx / d, ny = dy / d, nz = dz / d;
          pa.x -= nx * push; pa.y -= ny * push; pa.z -= nz * push;
          pb.x += nx * push; pb.y += ny * push; pb.z += nz * push;
        }
      }
    }
  }

  /** Brand identity = material kit (+ any CMS-uploaded cube/sphere textures). */
  setBrand(brandId, brand) {
    const sameBrand = brandId === this.brandId;
    this.brandId = brandId;
    if (brand) this.brandData = brand;
    if (sameBrand && !brand) return; // nothing new to apply
    this._applyKit(brandId);
  }

  setPointer(x, y, active) {
    this._ptr.set(x, y);
    this._ptrActive = active;
  }

  setParams(p) {
    if (p.driftSpeed != null) this.driftSpeed = p.driftSpeed;
    if (p.scale != null) this.objScale = p.scale;
    let rebuild = false;
    if (p.cubes != null && (p.cubes | 0) !== this.cubes) { this.cubes = p.cubes | 0; rebuild = true; }
    if (p.spheres != null && (p.spheres | 0) !== this.spheres) { this.spheres = p.spheres | 0; rebuild = true; }
    if (rebuild && this.scene) this._buildObjects();
  }

  resize(size) {
    this.size = size;
    this.camera.aspect = size.width / size.height;
    this.camera.updateProjectionMatrix();
    this.renderTarget.setSize(size.width, size.height);
  }

  onEvent(event) {
    switch (event.type) {
      case EventTypes.VISITOR_ENTERED:
        this.lightPulse.bump(1); // the room light breathes
        break;
      case EventTypes.SALE_MADE:
      case EventTypes.FLAVOUR_SOLD:
        this.signPulse.bump(1); // the brand sign glows brighter (its colour never changes)
        break;
      case EventTypes.PRODUCT_SOLD:
        this.jolt.bump(1); // a shiver runs through the objects
        break;
    }
  }

  update(dt) {
    this.time += dt;
    const lp = this.lightPulse.update(dt);
    const sp = this.signPulse.update(dt);
    const jolt = this.jolt.update(dt);
    const kit = this.kits[this._kitId(this.brandId)];
    this.key.intensity = kit.key * (1 + lp * 0.35);
    this.hemi.intensity = kit.hemi * (1 + lp * 0.25);

    // Touch: ease the reveal in while held, out when released.
    this.reveal += ((this._ptrActive ? 1 : 0) - this.reveal) * Math.min(1, dt * (this._ptrActive ? 4 : 2));
    // Pointer in world space at the cluster's depth plane.
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (this.camera.position.z + 2);
    this._ptrWorld.set(this._ptr.x * halfH * this.camera.aspect, this._ptr.y * halfH);

    // Subtle parallax sway — looking through a window, not at a still.
    this.camera.position.x = Math.sin(this.time * 0.12) * 0.10;
    this.camera.position.y = Math.sin(this.time * 0.09 + 1.7) * 0.06;
    this.camera.lookAt(0, 0, -2.2);

    const reveal = this.reveal;
    // 1) Drift + life cycle bookkeeping.
    for (const o of this.objects) {
      o.age += dt;
      o.home.z += o.vz * this.driftSpeed * dt;
      o.home.x += o.vx * this.driftSpeed * dt;
      // Near the window things slide off-axis (as if passing the glass), so
      // they exit via the sides instead of flying into the viewer's eye.
      const dist = this.camera.position.z - o.home.z;
      if (dist < 2.6) {
        const away = (2.6 - dist) * dt * this.driftSpeed;
        o.home.x += Math.sign(o.home.x || 0.3) * away * 0.55;
        o.home.y += Math.sign(o.home.y || 0.2) * away * 0.3;
      }
      const grow = THREE.MathUtils.smoothstep(o.age, 0, 1.4); // born small in the depth
      o.curR = o.base * o.kR * Math.max(grow, 0.05);
    }

    // 2) Solid bodies: firm separation of the drift TARGETS (stable, non-
    //    overlapping homes to ease toward).
    this._relax(4, true);

    // 3) Pose, touch parting, and off-screen recycling.
    const camX = this.camera.position.x, camY = this.camera.position.y, camZ = this.camera.position.z;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    for (const o of this.objects) {
      const grow = THREE.MathUtils.smoothstep(o.age, 0, 1.4);
      const wob = 1 + 0.012 * Math.sin(this.time * 1.3 + o.rot.x * 10);
      o.mesh.scale.setScalar(o.base * grow * wob);
      o.rot.x += o.spin.x * dt; o.rot.y += o.spin.y * dt; o.rot.z += o.spin.z * dt;
      const jr = jolt * 0.25;
      o.mesh.rotation.set(o.rot.x + jr * Math.sin(o.rot.y * 9 + this.time * 14), o.rot.y, o.rot.z + jr * Math.cos(o.rot.x * 7 + this.time * 12));

      // TOUCH PARTING: slide away from the finger, clearing the sign's window.
      let px = o.home.x, py = o.home.y;
      if (reveal > 0.002) {
        const dx = o.home.x - this._ptrWorld.x;
        const dy = o.home.y - this._ptrWorld.y;
        const r2 = dx * dx + dy * dy;
        const push = Math.exp(-r2 * 0.30) * 3.1 * reveal;
        const inv = 1 / Math.max(Math.sqrt(r2), 0.25);
        px += dx * inv * push;
        py += dy * inv * push * 0.8;
      }
      const ease = Math.min(1, dt * 9); // snappy, so contact reads as solid
      o.mesh.position.x += (px - o.mesh.position.x) * ease;
      o.mesh.position.y += (py - o.mesh.position.y) * ease;
      o.mesh.position.z += (o.home.z - o.mesh.position.z) * ease;
    }

    // 4) Final separation on the RENDERED positions, so what's on screen never
    //    interpenetrates (hit + push), then recycle anything fully off-screen.
    this._relax(3, false);
    for (const o of this.objects) {
      const r = o.curR * 1.25;
      const dist = camZ - o.mesh.position.z;
      if (dist < -r) { this._reseed(o); continue; }       // fully past the window
      if (dist > 0.3) {
        const hh = tanH * dist, hw = hh * this.camera.aspect;
        if (o.mesh.position.x - camX > hw + r || camX - o.mesh.position.x > hw + r ||
            o.mesh.position.y - camY > hh + r || camY - o.mesh.position.y > hh + r) {
          this._reseed(o);
        }
      }
    }

    // The brand sign: revealed by touch, or glowing briefly on a sale. Its
    // colour is the brand's own (set in _applyKit) and is never changed here.
    this.signMat.opacity = Math.min(1, reveal * 1.15 + sp * 0.9);

    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this.renderTarget.texture; }

  destroy() {
    this.renderer.toneMapping = this._prevToneMapping;
    for (const o of this.objects) this.scene.remove(o.mesh);
    this._disposeVariants();
    this.cubeGeo.dispose();
    this.sphereGeo.dispose();
    Object.values(this.tex).forEach((t) => t.dispose());
    Object.values(this.kits).forEach((k) => { k.cube.dispose(); k.sphere.dispose(); });
    Object.values(this._signTextures).forEach((s) => s.tex.dispose());
    this.signMat.dispose();
    this.floorMat.dispose();
    this.wallMat.dispose();
    this.envTex.dispose();
    this.renderTarget.dispose();
  }
}

registerArt(Vitrine);
