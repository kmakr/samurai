// Voxel model builder.
//
// Models are tiny 3D bitmaps: an array of Y-layers (bottom to top), each layer
// an array of Z-row strings, any non-space character a filled cell. vox()
// merges the filled cells into one BufferGeometry, emitting only faces that
// border empty space — a 50-cube column costs ~200 quads, not 300.
//
// Every vertex carries a per-voxel colour jitter so flat faces read as made of
// individual bricks rather than extruded plastic.

import * as THREE from 'three';
import { rng } from './paper.js';

const FACES = [
  // dir,        corners (unit cube, origin at cell min corner)
  { d: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { d: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { d: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { d: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

// layers: string[][] — layers[y][z] is a row of x characters.
export function vox(layers, size, opts = {}) {
  const { centerY = true, jitter = 0.05, seed = 7 } = opts;
  const H = layers.length;
  let W = 0, D = 0;
  for (const layer of layers) {
    D = Math.max(D, layer.length);
    for (const row of layer) W = Math.max(W, row.length);
  }
  const filled = (x, y, z) => {
    if (y < 0 || y >= H || z < 0 || z >= D || x < 0 || x >= W) return false;
    const row = layers[y][z];
    return !!row && x < row.length && row[x] !== ' ';
  };

  const rnd = rng(seed);
  const pos = [], nor = [], col = [];
  const ox = -W / 2, oy = centerY ? -H / 2 : 0, oz = -D / 2;

  for (let y = 0; y < H; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        if (!filled(x, y, z)) continue;
        const v = 1 + (rnd() - 0.5) * 2 * jitter;
        for (const f of FACES) {
          if (filled(x + f.d[0], y + f.d[1], z + f.d[2])) continue;
          const quad = f.c.map(([cx, cy, cz]) => [
            (x + cx + ox) * size, (y + cy + oy) * size, (z + cz + oz) * size,
          ]);
          for (const idx of [0, 1, 2, 0, 2, 3]) {
            pos.push(...quad[idx]);
            nor.push(...f.d);
            col.push(v, v, v);
          }
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------- layer helpers

// One rectangular slab row-set: inner w×d, centred in a gw×gd grid, with
// `cut` cells clipped off each corner for rough octagonal shapes.
export function slab(gw, gd, w = gw, d = gd, cut = 0) {
  const rows = [];
  const x0 = Math.floor((gw - w) / 2), z0 = Math.floor((gd - d) / 2);
  for (let z = 0; z < gd; z++) {
    let row = '';
    for (let x = 0; x < gw; x++) {
      const inX = x >= x0 && x < x0 + w;
      const inZ = z >= z0 && z < z0 + d;
      let ok = inX && inZ;
      if (ok && cut > 0) {
        const ex = Math.min(x - x0, x0 + w - 1 - x);
        const ez = Math.min(z - z0, z0 + d - 1 - z);
        if (ex + ez < cut) ok = false;
      }
      row += ok ? 'X' : ' ';
    }
    rows.push(row);
  }
  return rows;
}

// A solid box: h copies of the same slab.
export function boxLayers(w, d, h, cut = 0) {
  return Array.from({ length: h }, () => slab(w, d, w, d, cut));
}

// A vertical taper from bottom (w0×d0) to top (w1×d1) over h layers.
export function taperLayers(w0, d0, w1, d1, h, cut = 0) {
  const gw = Math.max(w0, w1), gd = Math.max(d0, d1);
  return Array.from({ length: h }, (_, i) => {
    const t = h === 1 ? 0 : i / (h - 1);
    const w = Math.round(w0 + (w1 - w0) * t);
    const d = Math.round(d0 + (d1 - d0) * t);
    return slab(gw, gd, w, d, cut);
  });
}

// ------------------------------------------------------------------- gibs

// The voxel payoff: bodies come apart into the cubes they were made of.
// One instanced mesh, a fixed pool, zero allocation during play.
export class VoxelGibs {
  constructor(scene, material, max = 320, size = 0.13) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), material, max);
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.gibs = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  burst(x, y, z, count, dirX = 0, dirZ = 0, force = 1) {
    for (let i = 0; i < count; i++) {
      if (this.gibs.length >= this.max) this.gibs.shift();
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * 2.6 * force;
      this.gibs.push({
        x, y: y + (Math.random() - 0.5) * 0.6, z,
        vx: dirX * 3.2 * force + Math.cos(a) * s,
        vy: 2.2 * force + Math.random() * 2.8,
        vz: dirZ * 3.2 * force + Math.sin(a) * s,
        rx: Math.random() * Math.PI, rz: Math.random() * Math.PI,
        wx: (Math.random() - 0.5) * 14, wz: (Math.random() - 0.5) * 14,
        scale: 0.7 + Math.random() * 0.9,
        rest: 0,
        age: 0,
      });
    }
  }

  update(dt, ink) {
    const alive = this.gibs;
    for (let i = alive.length - 1; i >= 0; i--) {
      const g = alive[i];
      g.age += dt;

      // Retiring chunks must stay below the contact plane. Otherwise the next
      // update clamps them back onto the paper before they can finish sinking.
      if (g.rest > 1.6) {
        g.y -= dt * 0.5;
        if (g.y < -0.3) alive.splice(i, 1);
        continue;
      }

      g.vy -= 24 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      g.rx += g.wx * dt; g.rz += g.wz * dt;
      if (g.y < 0.07 * g.scale) {
        g.y = 0.07 * g.scale;
        if (Math.abs(g.vy) > 1.0) {
          g.vy *= -0.3; g.vx *= 0.6; g.vz *= 0.6;
          g.wx *= 0.5; g.wz *= 0.5;
          // A chunk that hits the page marks it.
          if (ink && Math.random() < 0.5) ink.addStain(g.x, g.z, 0.2 + Math.random() * 0.3, { alpha: 0.5 });
        } else {
          g.vx = 0; g.vz = 0; g.vy = 0; g.wx *= 0.8; g.wz *= 0.8;
          g.rest += dt;
        }
      }
    }

    for (let i = 0; i < this.max; i++) {
      const g = alive[i];
      if (!g) { this.mesh.setMatrixAt(i, this._hidden); continue; }
      this._p.set(g.x, g.y, g.z);
      this._q.setFromEuler(this._e.set(g.rx, 0, g.rz));
      this._s.setScalar(g.scale);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.gibs.length = 0;
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
