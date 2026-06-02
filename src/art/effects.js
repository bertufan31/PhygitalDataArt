// ---------------------------------------------------------------------------
// Data → effect principle.
//
// Every art style renders THREE visually DISTINCT reactions. The visual
// language can differ per style, but within any style the three must look
// clearly different from one another:
//
//   visitor entered            → RIPPLE     a calm expanding wave / ring
//   consumable (flavour) sale  → BLAST      a bright colour burst
//   generic sale               → BLAST      (same kind, neutral warm colour)
//   product / device sold      → DISRUPTION a glitchy shockwave that warps
//
// This module is the single source of truth for that mapping, plus a small
// EffectField that holds live effects and writes them into shader uniforms.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { EventTypes } from '../core/events.js';

export const EffectKinds = { RIPPLE: 0, BLAST: 1, DISRUPTION: 2 };

/** Map a data event to { kind, color, life(seconds) }, or null to ignore. */
export function effectForEvent(event) {
  switch (event.type) {
    case EventTypes.VISITOR_ENTERED:
      return { kind: EffectKinds.RIPPLE, color: '#7fe0ff', life: 2.8 };
    case EventTypes.FLAVOUR_SOLD:
      return { kind: EffectKinds.BLAST, color: event.data?.color || '#ffd886', life: 2.6 };
    case EventTypes.SALE_MADE:
      return { kind: EffectKinds.BLAST, color: '#ffd886', life: 2.2 };
    case EventTypes.PRODUCT_SOLD:
      return { kind: EffectKinds.DISRUPTION, color: '#cda8ff', life: 1.9 };
    default:
      return null;
  }
}

/** Per-kind energy contribution (how much each reaction stirs a style). */
export const KIND_ENERGY = [0.12, 0.42, 0.3]; // ripple, blast, disruption

/**
 * A smoothly eased scalar. Events `bump()` a target; the target decays back to a
 * baseline and the visible `value` eases toward the target. This is what keeps a
 * new event from instantly flashing the whole field — global responses (overall
 * energy, flavour tint) rise and fall gradually instead of popping.
 */
export class Eased {
  constructor(base = 0, { rise = 2.0, decay = 0.5, max = Infinity } = {}) {
    this.base = base;
    this.max = max;
    this.rise = rise; // how fast value chases target
    this.decay = decay; // how fast target falls back to base
    this.value = base;
    this.target = base;
  }
  bump(amount) {
    this.target = Math.min(this.max, this.target + amount);
  }
  set(v) {
    this.target = Math.min(this.max, v);
  }
  update(dt) {
    this.target += (this.base - this.target) * Math.min(1, dt * this.decay);
    this.value += (this.target - this.value) * Math.min(1, dt * this.rise);
    return this.value;
  }
}

/**
 * Holds live effects and writes them into shader uniform arrays as
 * vec4(x, y, ageNorm, kind) + matching colours. Shared by every style so the
 * 3-distinct-effects principle is implemented once.
 */
export class EffectField {
  constructor(max = 16) {
    this.max = max;
    this.list = [];
  }

  /** Spawn the effect for an event at a random position. Returns it (or null). */
  spawn(event) {
    const e = effectForEvent(event);
    if (!e) return null;
    const fx = {
      x: Math.random(),
      y: Math.random(),
      age: 0,
      life: e.life,
      kind: e.kind,
      color: new THREE.Color(e.color),
    };
    this.list.push(fx);
    if (this.list.length > this.max) this.list.shift();
    return fx;
  }

  update(dt) {
    for (const f of this.list) f.age += dt;
    this.list = this.list.filter((f) => f.age < f.life);
  }

  /** @param {THREE.Vector4[]} posArr @param {THREE.Color[]} colorArr @returns count */
  write(posArr, colorArr) {
    const n = Math.min(this.list.length, this.max);
    for (let i = 0; i < n; i++) {
      const f = this.list[i];
      posArr[i].set(f.x, f.y, f.age / f.life, f.kind);
      colorArr[i].copy(f.color);
    }
    return n;
  }
}
