// ---------------------------------------------------------------------------
// Art option: "Collective Canvas" — one canvas, painted by everyone.
//
// A shared blank canvas for all flagship stores: anyone viewing the display can
// paint strokes or place brand stamps, and everyone else sees them. A toolbar
// under the canvas offers the brand colours + the TEREA pack colours, three
// brush sizes, and the three logo stamps (IQOS emblem / ZYN / VEEV V).
//
// HOW THE SHARING WORKS (mockup-grade, no backend of our own):
//   • The artwork is an append-only STROKE LOG (grow-only set → conflict-free).
//   • First activation creates a shared "room" (an anonymous JSON bin on
//     jsonblob.com) from the viewer's browser; its id goes into localStorage
//     and into the SHARE LINK (…/index.html#canvas=<id>). Anyone opening that
//     link joins the same room.
//   • Every few seconds each client GETs the room, merges by stroke id, adopts
//     what's new and PUTs back anything the room is missing. Everyone
//     converges; strokes are never lost (each client also keeps a full local
//     copy, so the owner's browser re-seeds the room if it ever expires).
//   • The room can also be a full custom URL (#canvas=https://…) — the seam
//     for swapping in Firebase or a tiny KV service in production.
//
// The toolbar lives on the display page while this art is active. Painting is
// exact-under-cursor via the Stage's pointer→art-surface UV raycast.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { BaseArt } from '../BaseArt.js';
import { registerArt } from '../registry.js';
import { Flavours } from '../../core/events.js';
import { drawBrandGlyph } from '../../core/brandGlyph.js';

const CANVAS_W = 1600;
const PAPER = '#f2efe9';
const STORAGE_KEY = 'pda-collective-canvas-v1';
const ROOM_KEY = 'pda-collective-room-v1';
const JSONBLOB = 'https://jsonblob.com/api/jsonBlob';
const POLL_MS = 4000;

// THE GLOBAL ROOM. When set, every viewer joins this shared store by default —
// no room creation, no share-hash needed. Point it at a JSON endpoint that
// supports GET + PUT of a {"strokes": []} document, e.g. a Firebase Realtime
// Database REST path: 'https://<your-db>.firebasedatabase.app/collective.json'
// (rules read/write true). Overridable per-link via #canvas=<url>.
const DEFAULT_ROOM = 'https://phygital-canvas-default-rtdb.europe-west1.firebasedatabase.app/collective.json';

const BRAND_SWATCHES = [
  { name: 'IQOS', color: '#00D1D2' },
  { name: 'ZYN', color: '#00A9E0' },
  { name: 'VEEV', color: '#B89FEF' },
];
const BRUSHES = [
  { name: 'S', w: 0.006 },
  { name: 'M', w: 0.014 },
  { name: 'L', w: 0.03 },
];
const STAMPS = ['iqos', 'zyn', 'veev'];
const STAMP_GLYPH = { iqos: null, zyn: 'zyn', veev: 'veev' }; // null → emblem

export class CollectiveCanvas extends BaseArt {
  static id = 'collective-canvas';
  static label = 'Collective Canvas';
  static ownLook = true; // the painted colours ARE the artwork
  static noPrism = true; // a white canvas doesn't translate to the prism wall

  init(ctx) {
    this.size = ctx.size;
    const aspect = ctx.frame.w / ctx.frame.h;
    this.W = CANVAS_W;
    this.H = Math.round(CANVAS_W / aspect);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx2d = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;

    this.color = BRAND_SWATCHES[0].color;
    this.brush = BRUSHES[1].w;
    this.tool = 'brush'; // 'brush' | 'stamp:<id>'
    this.strokes = this._loadLocal();
    this._live = null; // in-progress stroke
    this._dirtyRemote = false;
    this._status = 'local'; // 'local' | 'live' | 'joining'
    this._stampCache = {};

    this._redraw();
    this._buildToolbar();
    this._startSync();
  }

  // --- local persistence --------------------------------------------------
  _loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }
  _saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.strokes)); } catch { /* full/blocked */ }
  }

  // --- drawing --------------------------------------------------------------
  _redraw() {
    const c = this.ctx2d;
    c.fillStyle = PAPER;
    c.fillRect(0, 0, this.W, this.H);
    for (const s of this.strokes) this._drawStroke(s);
    if (this._live) this._drawStroke(this._live);
    this.tex.needsUpdate = true;
  }

  _drawStroke(s) {
    const c = this.ctx2d;
    if (s.t === 'stamp') {
      c.drawImage(this._stamp(s.s, s.c), (s.x - s.r) * this.W, (s.y - s.r * (this.W / this.H)) * this.H, s.r * 2 * this.W, s.r * 2 * (this.W / this.H) * this.H);
      return;
    }
    if (!s.p || s.p.length === 0) return;
    c.strokeStyle = s.c;
    c.lineWidth = s.w * this.W;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    const pts = s.p;
    c.moveTo(pts[0][0] * this.W, pts[0][1] * this.H);
    if (pts.length === 1) { c.lineTo(pts[0][0] * this.W + 0.01, pts[0][1] * this.H); }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2 * this.W;
      const my = (pts[i][1] + pts[i + 1][1]) / 2 * this.H;
      c.quadraticCurveTo(pts[i][0] * this.W, pts[i][1] * this.H, mx, my);
    }
    if (pts.length > 1) {
      const L = pts[pts.length - 1];
      c.lineTo(L[0] * this.W, L[1] * this.H);
    }
    c.stroke();
  }

  // Tinted logo stamp, cached per (brand, colour).
  _stamp(brandId, color) {
    const key = `${brandId}|${color}`;
    if (!this._stampCache[key]) {
      const s = 320;
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d');
      drawBrandGlyph(g, s, s, STAMP_GLYPH[brandId]);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, s, s);
      this._stampCache[key] = c;
    }
    return this._stampCache[key];
  }

  // --- pointer → paint ------------------------------------------------------
  setPointer(_x, _y, active, u, v) {
    const inCanvas = u != null && u >= 0 && u <= 1 && v >= 0 && v <= 1;
    const px = inCanvas ? [u, 1 - v] : null; // canvas y is down
    if (active && px) {
      if (this.tool.startsWith('stamp:')) {
        if (!this._stamped) { // one stamp per press
          this._stamped = true;
          this._commit({ id: crypto.randomUUID(), t: 'stamp', s: this.tool.slice(6), c: this.color, x: px[0], y: px[1], r: 0.07 });
        }
        return;
      }
      if (!this._live) {
        this._live = { id: crypto.randomUUID(), t: 'path', c: this.color, w: this.brush, p: [px] };
      } else {
        const last = this._live.p[this._live.p.length - 1];
        if (Math.hypot(px[0] - last[0], px[1] - last[1]) > 0.002) this._live.p.push(px);
      }
      this._redraw();
    } else {
      this._stamped = false;
      if (this._live) {
        const done = this._live;
        this._live = null;
        this._commit(done);
      }
    }
  }

  _commit(stroke) {
    this.strokes.push(stroke);
    this._saveLocal();
    this._redraw();
    this._dirtyRemote = true;
    this._pushSoon();
  }

  // --- shared room sync -----------------------------------------------------
  // Room tokens: 'xc:<id>' (extendsclass json-storage — id returned in the
  // response BODY, immune to CORS header quirks), 'jb:<id>' (jsonblob — id in
  // the Location header), a full custom http(s) URL, or a legacy bare jsonblob
  // id. Providers are tried in order; creation retries every 30s while local.
  _roomFromHash() {
    const m = (window.location.hash || '').match(/canvas=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  _endpoint() {
    if (!this.room) return null;
    if (this.room.startsWith('http')) return this.room;
    if (this.room.startsWith('xc:')) return `https://json.extendsclass.com/bin/${this.room.slice(3)}`;
    if (this.room.startsWith('jb:')) return `${JSONBLOB}/${this.room.slice(3)}`;
    return `${JSONBLOB}/${this.room}`; // legacy bare id
  }

  async _createRoom() {
    const payload = JSON.stringify({ strokes: this.strokes });
    const providers = [
      async () => { // extendsclass — id in the response body
        const r = await fetch('https://json.extendsclass.com/bin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
        });
        if (!r.ok) throw new Error(`extendsclass ${r.status}`);
        const j = await r.json();
        const id = j.id || String(j.uri || '').split('/').pop();
        if (!id) throw new Error('extendsclass: no id in response');
        return `xc:${id}`;
      },
      async () => { // jsonblob — id in the Location header (must be CORS-exposed)
        const r = await fetch(JSONBLOB, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: payload,
        });
        if (!r.ok) throw new Error(`jsonblob ${r.status}`);
        const loc = r.headers.get('Location') || r.headers.get('X-jsonblob');
        const id = loc ? loc.split('/').pop() : null;
        if (!id) throw new Error('jsonblob: Location header not readable');
        return `jb:${id}`;
      },
    ];
    this._lastCreate = Date.now();
    for (const create of providers) {
      try {
        this.room = await create();
        localStorage.setItem(ROOM_KEY, this.room);
        this._lastErr = '';
        return true;
      } catch (e) {
        this._lastErr = String(e && e.message ? e.message : e);
      }
    }
    return false;
  }

  async _startSync() {
    // Precedence: explicit share-link > the baked-in global room > a room this
    // browser used before > create a fresh one.
    this.room = this._roomFromHash() || DEFAULT_ROOM || localStorage.getItem(ROOM_KEY) || null;
    if (this.room) localStorage.setItem(ROOM_KEY, this.room);
    this._status = this.room ? 'joining' : 'local';
    this._renderStatus();
    if (!this.room) await this._createRoom(); // sharer's device creates the room
    this._syncTimer = setInterval(() => this._syncOnce(), POLL_MS);
    this._syncOnce();
  }

  async _syncOnce() {
    // Self-heal: while local-only, retry room creation every 30s.
    if (!this.room && !this._creating && Date.now() - (this._lastCreate || 0) > 30000) {
      this._creating = true;
      await this._createRoom();
      this._creating = false;
    }
    const url = this._endpoint();
    if (!url || this._syncing) { this._renderStatus(); return; }
    this._syncing = true;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const remote = (await res.json())?.strokes || [];
      const have = new Set(this.strokes.map((s) => s.id));
      const theirs = new Set(remote.map((s) => s.id));
      const newOnes = remote.filter((s) => !have.has(s.id));
      const missing = this.strokes.filter((s) => !theirs.has(s.id));
      if (newOnes.length) {
        this.strokes = this.strokes.concat(newOnes);
        this._saveLocal();
        this._redraw();
      }
      if (missing.length || this._dirtyRemote) {
        const merged = remote.concat(missing.length ? this.strokes.filter((s) => !theirs.has(s.id)) : []);
        await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ strokes: missing.length ? merged : this.strokes }),
        });
        this._dirtyRemote = false;
      }
      this._status = 'live';
      this._lastErr = '';
    } catch (e) {
      this._status = this.room ? 'joining' : 'local';
      this._lastErr = String(e && e.message ? e.message : e);
    }
    this._syncing = false;
    this._renderStatus();
  }

  _pushSoon() {
    clearTimeout(this._pushT);
    this._pushT = setTimeout(() => this._syncOnce(), 400);
  }

  // --- toolbar ----------------------------------------------------------------
  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'pda-paint';
    this.bar = bar;

    const group = (label) => {
      const g = document.createElement('div');
      g.className = 'pda-paint__group';
      if (label) {
        const l = document.createElement('span');
        l.className = 'pda-paint__label';
        l.textContent = label;
        g.append(l);
      }
      bar.append(g);
      return g;
    };

    const swatches = [...BRAND_SWATCHES, ...Flavours.map((f) => ({ name: f.name, color: f.color }))];
    const gCol = group('Colours');
    this._swatchEls = swatches.map((s) => {
      const b = document.createElement('button');
      b.className = 'pda-paint__swatch';
      b.style.background = s.color;
      b.title = s.name;
      b.addEventListener('click', () => { this.color = s.color; this._refreshToolbar(); });
      gCol.append(b);
      return { el: b, color: s.color };
    });

    const gBrush = group('Brush');
    this._brushEls = BRUSHES.map((br) => {
      const b = document.createElement('button');
      b.className = 'pda-paint__brush';
      b.title = `Brush ${br.name}`;
      const dot = document.createElement('span');
      dot.style.width = dot.style.height = `${6 + br.w * 500}px`;
      b.append(dot);
      b.addEventListener('click', () => { this.tool = 'brush'; this.brush = br.w; this._refreshToolbar(); });
      gBrush.append(b);
      return { el: b, w: br.w };
    });

    const gStamp = group('Stamps');
    this._stampEls = STAMPS.map((id) => {
      const b = document.createElement('button');
      b.className = 'pda-paint__stampbtn';
      b.title = `${id.toUpperCase()} stamp`;
      const icon = document.createElement('canvas');
      icon.width = icon.height = 26;
      const g = icon.getContext('2d');
      drawBrandGlyph(g, 26, 26, STAMP_GLYPH[id]);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#e7e9f0';
      g.fillRect(0, 0, 26, 26);
      b.append(icon);
      b.addEventListener('click', () => { this.tool = `stamp:${id}`; this._refreshToolbar(); });
      gStamp.append(b);
      return { el: b, id };
    });

    const gShare = group('');
    this.shareBtn = document.createElement('button');
    this.shareBtn.className = 'pda-paint__share';
    this.shareBtn.textContent = 'Copy share link';
    this.shareBtn.addEventListener('click', async () => {
      if (!this.room) await this._createRoom(); // one more try, on demand
      const url = this.room
        ? `${window.location.origin}${window.location.pathname}#canvas=${encodeURIComponent(this.room)}`
        : window.location.href;
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch { /* fall through */ }
      if (!copied) window.prompt('Copy this link:', url); // clipboard blocked → manual
      this.shareBtn.textContent = this.room ? 'Link copied ✓' : 'Copied (local only)';
      setTimeout(() => { this.shareBtn.textContent = 'Copy share link'; }, 1800);
      this._renderStatus();
    });
    this.statusEl = document.createElement('button');
    this.statusEl.className = 'pda-paint__status';
    this.statusEl.type = 'button';
    this.statusEl.addEventListener('click', async () => { // click = retry now
      if (!this.room) await this._createRoom();
      this._syncOnce();
    });
    gShare.append(this.shareBtn, this.statusEl);

    document.body.append(bar);
    this._refreshToolbar();
    this._renderStatus();
  }

  _refreshToolbar() {
    for (const s of this._swatchEls) s.el.classList.toggle('active', s.color === this.color && true);
    for (const b of this._brushEls) b.el.classList.toggle('active', this.tool === 'brush' && this.brush === b.w);
    for (const st of this._stampEls) st.el.classList.toggle('active', this.tool === `stamp:${st.id}`);
  }

  _renderStatus() {
    if (!this.statusEl) return;
    const map = { live: '● live — shared canvas', joining: '◌ connecting… (click to retry)', local: '○ local only (click to retry)' };
    this.statusEl.textContent = map[this._status] || '';
    this.statusEl.dataset.state = this._status;
    this.statusEl.title = this._lastErr || '';
  }

  resize() { /* canvas keeps its own resolution */ }
  update() { /* CanvasTexture updates via needsUpdate on draw */ }
  get texture() { return this.tex; }

  destroy() {
    clearInterval(this._syncTimer);
    clearTimeout(this._pushT);
    this.bar?.remove();
    this.tex.dispose();
  }
}

registerArt(CollectiveCanvas);
