// ---------------------------------------------------------------------------
// Display target: flat screen.
//
// The simplest target — a single plane textured with the art's output. Stands
// in for a flat TV or a projection onto a wall. The plane is FRAME_HEIGHT tall
// and (FRAME_HEIGHT * aspect) wide, centred at the origin, facing +Z. The view
// cameras are positioned to frame this standard footprint.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

export const FRAME_HEIGHT = 2; // world units; width derives from the frame aspect

export class FlatTarget {
  constructor({ aspect }) {
    const w = FRAME_HEIGHT * aspect;
    this.geometry = new THREE.PlaneGeometry(w, FRAME_HEIGHT);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
  }

  setTexture(texture) {
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  addTo(scene) {
    scene.add(this.mesh);
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
