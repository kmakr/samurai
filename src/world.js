// Shared rain field for the shrine district. Fixed buffers; frozen by world time.
import * as THREE from 'three';
import { rng } from './paper.js';
export const ARENA = 20;

export class Rain {
  constructor(scene, count = 2600) {
    const rnd = rng(31);
    const pos = new Float32Array(count * 6);
    this.seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.seeds[i * 3] = (rnd() - 0.5) * 110;
      this.seeds[i * 3 + 1] = rnd() * 40;
      this.seeds[i * 3 + 2] = (rnd() - 0.5) * 110;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: 0xb3cad0, transparent: true, opacity: 0.0, depthWrite: false,
    }));
    this.lines.frustumCulled = false;
    this.count = count;
    this.pos = pos;
    this.intensity = 0;
    scene.add(this.lines);
  }

  update(dt, center, target) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.6);
    this.lines.material.opacity = this.intensity * 0.32;
    if (this.intensity < 0.01) { this.lines.visible = false; return; }
    this.lines.visible = true;

    const p = this.pos, s = this.seeds;
    const fall = 42 * dt, drift = 7 * dt;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      s[i3 + 1] -= fall;
      s[i3] += drift;
      if (s[i3 + 1] < 0) { s[i3 + 1] += 40; s[i3] -= 40 * 0.17; }
      const x = center.x + ((s[i3] % 110) + 165) % 110 - 55;
      const z = center.z + ((s[i3 + 2] % 110) + 165) % 110 - 55;
      const y = s[i3 + 1];
      const i6 = i * 6;
      p[i6] = x; p[i6 + 1] = y; p[i6 + 2] = z;
      p[i6 + 3] = x - 0.17 * 1.1; p[i6 + 4] = y - 1.1; p[i6 + 5] = z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
