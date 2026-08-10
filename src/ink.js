// The blood system: everything is ink, and ink behaves like ink on paper.
//
// Three layers:
//   1. floor stains  — permanent marks that bleed outward after they land
//   2. droplets      — airborne blood, which becomes a stain where it falls
//   3. screen ink    — marks flicked at the "page" itself, which soak and fade

import * as THREE from 'three';
import { QuadBatch, quadMaterial } from './quads.js';
import {
  makeInkAtlas, cellUV, splatCell, flickCell, dropCell, rng,
} from './paper.js';

const MAX_STAINS = 620;
const MAX_DROPS = 420;

const camDir = new THREE.Vector3();
const velDir = new THREE.Vector3();
const side = new THREE.Vector3();
const c0 = new THREE.Vector3(), c1 = new THREE.Vector3();
const c2 = new THREE.Vector3(), c3 = new THREE.Vector3();

export class InkSystem {
  constructor(scene, arenaHalf) {
    this.rnd = rng(1337);
    this.arenaHalf = arenaHalf;
    this.atlas = makeInkAtlas(256);

    // Stains sit just above the paper. depthWrite is off so overlapping marks
    // blend instead of fighting; they are all near-black so stacking reads as
    // pooling rather than as artefacts.
    this.stainBatch = new QuadBatch(MAX_STAINS, quadMaterial(this.atlas, 0x07070a, false));
    this.stainBatch.mesh.renderOrder = 2;
    scene.add(this.stainBatch.mesh);

    this.dropBatch = new QuadBatch(MAX_DROPS, quadMaterial(this.atlas, 0x08080b, false));
    this.dropBatch.mesh.renderOrder = 3;
    scene.add(this.dropBatch.mesh);

    this.stains = [];
    this.drops = [];

    // Screen-space ink lives on a 2D canvas above the WebGL surface.
    this.screenCanvas = document.getElementById('inkOverlay');
    this.screenCtx = this.screenCanvas.getContext('2d');
    this.screenMarks = [];
    this.resizeScreen();

    // The atlas is white-on-transparent (the 3D materials tint it). The 2D
    // overlay has no material, so bake a black copy for it once.
    const src = this.atlas.image;
    const dark = document.createElement('canvas');
    dark.width = src.width; dark.height = src.height;
    const dctx = dark.getContext('2d');
    dctx.drawImage(src, 0, 0);
    dctx.globalCompositeOperation = 'source-in';
    dctx.fillStyle = '#0a0a0d';
    dctx.fillRect(0, 0, dark.width, dark.height);
    this.darkAtlas = dark;
  }

  resizeScreen() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.screenCanvas.width = Math.floor(innerWidth * dpr);
    this.screenCanvas.height = Math.floor(innerHeight * dpr);
    this.screenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------- floor stains

  // size is the final radius in world units. Stains grow into that over `bleed`
  // seconds — the wicking is the whole point, so nothing appears full-size.
  addStain(x, z, size, opts = {}) {
    const r = this.rnd;
    if (Math.abs(x) > this.arenaHalf + 6 || Math.abs(z) > this.arenaHalf + 6) return;
    if (this.stains.length >= MAX_STAINS) this.stains.shift();
    const alpha = opts.alpha ?? (0.82 + r() * 0.18);
    this.stains.push({
      x, z,
      rot: opts.rot ?? r() * Math.PI * 2,
      uv: cellUV(opts.cell ?? splatCell(r)),
      size,
      // Start as a small wet dot; the soak does the rest.
      grow: 0.30 + r() * 0.12,
      bleed: opts.bleed ?? (0.9 + r() * 0.9),
      age: 0,
      alpha,
      // Ink dries lighter. It never disappears — the page keeps its history —
      // but without this the arena saturates to solid black within two waves.
      fade: opts.fade ?? 0.022,
      floor: alpha * 0.34,
      aspect: opts.aspect ?? 1,
    });
  }

  // A directional throw of ink, as if off the blade. Reads as a brush flick.
  flick(x, z, dirX, dirZ, power = 1) {
    const r = this.rnd;
    const ang = Math.atan2(dirZ, dirX);
    const n = 2 + Math.floor(r() * 3 * power);
    for (let i = 0; i < n; i++) {
      const spread = (r() - 0.5) * 0.7;
      const d = 1.2 + r() * 5.5 * power;
      const a = ang + spread;
      this.addStain(
        x + Math.cos(a) * d,
        z + Math.sin(a) * d,
        (0.55 + r() * 0.85) * power,
        { cell: flickCell(r), rot: a, aspect: 1.6 + r() * 0.8, bleed: 0.5 + r() * 0.5 },
      );
    }
    // Fine mist near the impact.
    for (let i = 0; i < 3 * power; i++) {
      const a = ang + (r() - 0.5) * 1.6;
      const d = r() * 3.2 * power;
      this.addStain(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.16 + r() * 0.3, { alpha: 0.5 + r() * 0.4 });
    }
  }

  // A pool — used for a killing blow. Big, slow, and it keeps creeping.
  pool(x, z, power = 1) {
    const r = this.rnd;
    this.addStain(x, z, 1.25 * power + r() * 0.8, { bleed: 2.4 + r() * 1.6, alpha: 0.95 });
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI * 2, d = r() * 2.2 * power;
      this.addStain(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.5 + r() * 0.85 * power, { bleed: 1.6 + r() * 1.6 });
    }
  }

  // --------------------------------------------------------------- airborne

  spray(x, y, z, count, opts = {}) {
    const r = this.rnd;
    const { dirX = 0, dirZ = 0, force = 1, up = 1 } = opts;
    for (let i = 0; i < count; i++) {
      if (this.drops.length >= MAX_DROPS) this.drops.shift();
      const a = r() * Math.PI * 2;
      const s = r() * 3.2 * force;
      this.drops.push({
        p: new THREE.Vector3(x, y, z),
        v: new THREE.Vector3(
          dirX * 4.5 * force + Math.cos(a) * s,
          (1.6 + r() * 3.4) * up,
          dirZ * 4.5 * force + Math.sin(a) * s,
        ),
        size: 0.10 + r() * 0.20,
        uv: cellUV(dropCell(r)),
        alpha: 0.85 + r() * 0.15,
      });
    }
  }

  // --------------------------------------------------------------- screen ink

  splashScreen(count = 6, power = 1) {
    const r = this.rnd;
    for (let i = 0; i < count; i++) {
      this.screenMarks.push({
        x: r() * innerWidth,
        y: r() * innerHeight,
        s: (18 + r() * 90) * power,
        rot: r() * Math.PI * 2,
        cell: r() < 0.6 ? splatCell(r) : flickCell(r),
        age: 0,
        life: 2.6 + r() * 3.0,
        alpha: 0.35 + r() * 0.45,
      });
    }
  }

  // ------------------------------------------------------------------ update

  update(dt, camera) {
    const r = this.rnd;

    // Airborne blood. A drop that reaches the paper stops being a drop.
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.v.y -= 22 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y <= 0.02) {
        this.addStain(d.p.x, d.p.z, d.size * 2.8 + r() * 0.35, {
          bleed: 0.7 + r() * 0.8,
          alpha: 0.7 + r() * 0.3,
        });
        this.drops.splice(i, 1);
      }
    }

    // Stains keep wicking outward after they land.
    for (const s of this.stains) {
      s.age += dt;
      if (s.grow < 1) s.grow = Math.min(1, s.grow + dt / s.bleed);
      if (s.fade > 0 && s.alpha > s.floor) s.alpha = Math.max(s.floor, s.alpha - s.fade * dt);
    }

    this.buildStains();
    this.buildDrops(camera);
    this.drawScreen(dt);
  }

  buildStains() {
    const b = this.stainBatch;
    b.begin();
    for (const s of this.stains) {
      if (s.alpha <= 0.01) continue;
      // Ease-out: fast initial spread, then a long slow creep.
      const g = 1 - Math.pow(1 - s.grow, 2.2);
      const hw = s.size * g * s.aspect;
      const hh = s.size * g;
      const co = Math.cos(s.rot), si = Math.sin(s.rot);
      const y = 0.012;
      c0.set(s.x - co * hw + si * hh, y, s.z - si * hw - co * hh);
      c1.set(s.x + co * hw + si * hh, y, s.z + si * hw - co * hh);
      c2.set(s.x + co * hw - si * hh, y, s.z + si * hw + co * hh);
      c3.set(s.x - co * hw - si * hh, y, s.z - si * hw + co * hh);
      // Wet ink is darkest at the moment it spreads; it lightens as it dries.
      b.push(c0, c1, c2, c3, s.uv, s.alpha * Math.min(1, 0.55 + g * 0.6));
    }
    b.end();
  }

  buildDrops(camera) {
    const b = this.dropBatch;
    b.begin();
    camera.getWorldDirection(camDir);
    for (const d of this.drops) {
      // Stretch each drop along its own motion so fast blood reads as a streak.
      const speed = d.v.length();
      velDir.copy(d.v).divideScalar(speed || 1);
      side.crossVectors(velDir, camDir);
      // Degenerate when the drop flies straight at the camera; any perpendicular
      // will do in that case since the streak has no visible direction anyway.
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0); else side.normalize();

      const long = d.size * (1 + Math.min(speed * 0.13, 2.6));
      const wide = d.size;
      const p = d.p;
      c0.copy(p).addScaledVector(velDir, -long).addScaledVector(side, wide);
      c1.copy(p).addScaledVector(velDir, long).addScaledVector(side, wide);
      c2.copy(p).addScaledVector(velDir, long).addScaledVector(side, -wide);
      c3.copy(p).addScaledVector(velDir, -long).addScaledVector(side, -wide);
      b.push(c0, c1, c2, c3, d.uv, d.alpha);
    }
    b.end();
  }

  drawScreen(dt) {
    const ctx = this.screenCtx;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!this.screenMarks.length) return;
    const atlasImg = this.darkAtlas;
    const cw = atlasImg.width / 4, ch = atlasImg.height / 4;
    for (let i = this.screenMarks.length - 1; i >= 0; i--) {
      const m = this.screenMarks[i];
      m.age += dt;
      const t = m.age / m.life;
      if (t >= 1) { this.screenMarks.splice(i, 1); continue; }
      // Soak outward slightly while fading, so it reads as absorbing.
      const grow = 1 + t * 0.28;
      const a = m.alpha * (1 - t * t);
      const sx = (m.cell % 4) * cw, sy = Math.floor(m.cell / 4) * ch;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(m.x, m.y);
      ctx.rotate(m.rot);
      const s = m.s * grow;
      ctx.drawImage(atlasImg, sx, sy, cw, ch, -s, -s, s * 2, s * 2);
      ctx.restore();
    }
  }
}
