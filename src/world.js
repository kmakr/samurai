// The world: an endless sheet of paper, dressed with sumi-e vegetation.
//
// Nothing here is actually infinite. The paper is one large tile-snapped plane
// that follows the player, and every piece of vegetation lives in a fixed
// instance pool that wraps around the player like a torus — walk far enough
// and stalks quietly recycle from behind you to ahead of you, hidden by fog.

import * as THREE from 'three';
import { toon, addOutlines } from './actors.js';
import { makePaperTexture, rng } from './paper.js';

// Kept for spawn-distance scale; the world itself no longer has walls.
export const ARENA = 20;

const PAPER_TILE = 8;          // world units per texture repeat; snap unit
const PAPER_SIZE = 480;

export function buildWorld(scene, timeUniform) {
  const rnd = rng(99);
  const group = new THREE.Group();
  scene.add(group);

  // ------------------------------------------------------------ the paper
  const paperTex = makePaperTexture(1024, 7);
  // One repeat per PAPER_TILE units, so a snap of exactly PAPER_TILE moves the
  // pattern onto itself and the floor never visibly swims.
  paperTex.repeat.set(PAPER_SIZE / PAPER_TILE, PAPER_SIZE / PAPER_TILE);
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(PAPER_SIZE, PAPER_SIZE),
    new THREE.MeshToonMaterial({ map: paperTex, color: 0xffffff }),
  );
  paper.rotation.x = -Math.PI / 2;
  paper.receiveShadow = true;
  group.add(paper);

  // ----------------------------------------------------------------- torii
  // A single fixed landmark. On an endless page it doubles as the only proof
  // of how far you have wandered.
  const torii = new THREE.Group();
  const pillarGeo = new THREE.BoxGeometry(0.72, 7.4, 0.72);
  for (const x of [-3.1, 3.1]) {
    const p = new THREE.Mesh(pillarGeo, toon(0.09));
    p.position.set(x, 3.7, 0);
    p.castShadow = true;
    torii.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.55, 0.8), toon(0.07));
  lintel.position.y = 7.5;
  lintel.castShadow = true;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.36, 0.6), toon(0.07));
  beam.position.y = 6.5;
  beam.castShadow = true;
  torii.add(lintel, beam);
  torii.position.set(0, 0, -25);
  addOutlines(torii, 1.4);
  group.add(torii);

  // ------------------------------------------------------------ vegetation
  const scatters = [];

  // Bamboo: clustered groves. A bare pole reads as scaffolding from the
  // game's steep camera, so each stalk carries leaf tufts near the top —
  // that is what makes both the stalk and its long shadow read as a plant.
  {
    const geo = new THREE.CylinderGeometry(0.09, 0.12, 11, 4, 1);
    geo.rotateY(Math.PI / 4);
    geo.translate(0, 5.5, 0);
    const mat = toon(0.34, { side: THREE.DoubleSide });
    addSway(mat, timeUniform, 0.9);

    const leafMat = toon(0.30);
    addSway(leafMat, timeUniform, 1.1);
    const leaf = (r, h, y, ox, rotY) => {
      const c = new THREE.ConeGeometry(r, h, 4);
      c.scale(1, 0.42, 1);
      c.rotateY(rotY);
      c.translate(ox, y, 0);
      return c;
    };

    scatters.push(new Scatter(group, [
      { geo, mat },
      { geo: leaf(1.05, 1.6, 8.0, 0.35, 0.0), mat: leafMat },
      { geo: leaf(0.85, 1.4, 9.4, -0.3, 2.1), mat: leafMat },
      { geo: leaf(0.55, 1.2, 10.6, 0.15, 4.2), mat: leafMat },
    ], 150, 72, rnd, {
      cluster: 3.5,
      minDist: 12,
      scale: () => [0.7 + rnd() * 0.6, 0.55 + rnd() * 0.75, 0.7 + rnd() * 0.6],
      lean: 0.1,
      shadows: true,
    }));
  }

  // Pines. Stacked cones read as concentric blobs from the game's overhead
  // camera, so the canopy is built the way ink painters actually draw pine:
  // flat irregular bough-pads, offset asymmetrically around the trunk. From
  // above they overlap into a broken silhouette instead of a target.
  {
    const trunk = new THREE.CylinderGeometry(0.26, 0.42, 5.2, 4);
    trunk.rotateY(Math.PI / 4);
    trunk.translate(0, 2.6, 0);
    // A stub of trunk continuing into the canopy keeps distant trees from
    // reading as floating caps once fog eats the thin lower trunk.
    const upper = new THREE.CylinderGeometry(0.15, 0.22, 2.6, 4);
    upper.rotateY(Math.PI / 4);
    upper.translate(0.1, 6.2, 0);

    const pad = (r, y, ox, oz, rotY) => {
      // A flat slab per bough — blocky pine tiers, offset like brush pads.
      const p = new THREE.BoxGeometry(r * 1.9, r * 0.42, r * 1.9);
      p.rotateY(rotY);
      p.translate(ox, y, oz);
      return p;
    };

    const trunkMat = toon(0.18);
    const needleMat = toon(0.27);
    addSway(needleMat, timeUniform, 0.35);
    scatters.push(new Scatter(group, [
      { geo: trunk, mat: trunkMat },
      { geo: upper, mat: trunkMat },
      { geo: pad(2.1, 4.7, 0.9, 0.3, 0.4), mat: needleMat },
      { geo: pad(1.7, 5.6, -1.0, -0.4, 1.9), mat: needleMat },
      { geo: pad(1.35, 6.5, 0.4, -0.8, 3.6), mat: needleMat },
      { geo: pad(0.9, 7.3, -0.2, 0.5, 5.1), mat: needleMat },
    ], 54, 84, rnd, {
      // Trees stay a backdrop. Anything closer than this is re-seated at the
      // rim by Scatter.update, so a canopy never sits between camera and duel.
      minDist: 22,
      scale: () => { const s = 0.75 + rnd() * 0.6; return [s, s * (0.85 + rnd() * 0.4), s]; },
      lean: 0.05,
      shadows: true,
    }));
  }

  // Grass: tufts everywhere, swaying hard. Two crossed planes per tuft — a
  // single vertical card viewed from the game's steep camera collapses
  // edge-on into a hairline scratch, which is exactly how it used to look.
  // Wider, shorter, and mid-grey, it reads as a brushed tuft instead.
  {
    const a = new THREE.PlaneGeometry(1.1, 1.0);
    a.translate(0, 0.5, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    const mat = toon(0.30, {
      side: THREE.DoubleSide, transparent: true, alphaTest: 0.5, map: makeGrassAlpha(),
    });
    addSway(mat, timeUniform, 2.2);
    scatters.push(new Scatter(group, [{ geo: a, mat }, { geo: b, mat }], 1300, 52, rnd, {
      scale: () => { const s = 0.5 + rnd() * 0.9; return [s, s * (0.6 + rnd() * 0.6), s]; },
    }));
  }

  // Rocks.
  {
    const geo = new THREE.BoxGeometry(1.7, 1.1, 1.7);
    scatters.push(new Scatter(group, [{ geo, mat: toon(0.26) }], 42, 68, rnd, {
      minDist: 6,
      scale: () => [0.4 + rnd() * 1.5, 0.25 + rnd() * 0.7, 0.4 + rnd() * 1.5],
      lean: 0.6,
      shadows: true,
      sink: 0.15,
    }));
  }

  // ------------------------------------------------------------------ update
  function update(center) {
    // Snap the paper to the texture tile so the pattern is continuous.
    paper.position.x = Math.round(center.x / PAPER_TILE) * PAPER_TILE;
    paper.position.z = Math.round(center.z / PAPER_TILE) * PAPER_TILE;
    for (const s of scatters) s.update(center);
  }

  return { group, update, scatters };
}

// A pool of instances scattered in a disc that follows a moving center by
// wrapping: an instance drifting outside the radius teleports to the opposite
// side with fresh jitter. Fog covers the seam.
class Scatter {
  constructor(parent, parts, count, radius, rnd, opts = {}) {
    this.count = count;
    this.radius = radius;
    this.rnd = rnd;
    this.cluster = opts.cluster ?? 0;
    this.minDist = opts.minDist ?? 0;
    this.scaleFn = opts.scale ?? (() => [1, 1, 1]);
    this.lean = opts.lean ?? 0;
    this.sink = opts.sink ?? 0;

    this.pos = new Float32Array(count * 2);       // x, z
    this.rotY = new Float32Array(count);
    this.scale = new Float32Array(count * 3);
    this.leanXZ = new Float32Array(count * 2);

    // Cluster seeds, for vegetation that grows in stands rather than alone.
    this.seeds = [];
    if (this.cluster > 0) {
      for (let i = 0; i < Math.max(6, count / 5); i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
        this.seeds.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    }

    for (let i = 0; i < count; i++) this.place(i, 0, 0, true);

    this.meshes = parts.map(({ geo, mat }) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.castShadow = !!opts.shadows;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(m);
      return m;
    });

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.writeAll();
  }

  place(i, cx, cz, initial) {
    const rnd = this.rnd;
    let x, z;
    if (this.cluster > 0 && rnd() < 0.85) {
      const s = this.seeds[(rnd() * this.seeds.length) | 0];
      x = s[0] + (rnd() - 0.5) * this.cluster * 2;
      z = s[1] + (rnd() - 0.5) * this.cluster * 2;
      if (!initial) {
        // Wrapped in from the far side: re-seat the cluster seed occasionally
        // so groves themselves migrate rather than orbiting forever.
        if (rnd() < 0.1) {
          const a = rnd() * Math.PI * 2;
          s[0] = Math.cos(a) * this.radius * 0.9;
          s[1] = Math.sin(a) * this.radius * 0.9;
        }
      }
    } else {
      const a = rnd() * Math.PI * 2;
      const r = this.minDist + Math.sqrt(rnd()) * (this.radius - this.minDist);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    this.pos[i * 2] = cx + x;
    this.pos[i * 2 + 1] = cz + z;
    this.rotY[i] = rnd() * Math.PI * 2;
    const [sx, sy, sz] = this.scaleFn();
    this.scale[i * 3] = sx; this.scale[i * 3 + 1] = sy; this.scale[i * 3 + 2] = sz;
    this.leanXZ[i * 2] = (rnd() - 0.5) * 2 * this.lean;
    this.leanXZ[i * 2 + 1] = (rnd() - 0.5) * 2 * this.lean;
  }

  writeOne(i) {
    this._p.set(this.pos[i * 2], -this.sink, this.pos[i * 2 + 1]);
    this._e.set(this.leanXZ[i * 2], this.rotY[i], this.leanXZ[i * 2 + 1]);
    this._q.setFromEuler(this._e);
    this._s.set(this.scale[i * 3], this.scale[i * 3 + 1], this.scale[i * 3 + 2]);
    this._m.compose(this._p, this._q, this._s);
    for (const mesh of this.meshes) mesh.setMatrixAt(i, this._m);
  }

  writeAll() {
    for (let i = 0; i < this.count; i++) this.writeOne(i);
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  update(center) {
    const R = this.radius;
    const near = this.minDist;
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const dx = this.pos[i * 2] - center.x;
      const dz = this.pos[i * 2 + 1] - center.z;
      const d2 = dx * dx + dz * dz;
      // Too far behind, or (for backdrop pieces) too close to the action.
      if (d2 > R * R * 1.1 || (near > 0 && d2 < near * near)) {
        // Rebirth on the leading edge, in a random forward-ish arc.
        this.place(i, center.x, center.z, false);
        // Nudge the fresh position toward the rim opposite where it left.
        const a = Math.atan2(-dz, -dx) + (this.rnd() - 0.5) * 1.8;
        const r = R * (0.6 + this.rnd() * 0.38);
        this.pos[i * 2] = center.x + Math.cos(a) * r;
        this.pos[i * 2 + 1] = center.z + Math.sin(a) * r;
        this.writeOne(i);
        dirty = true;
      }
    }
    if (dirty) for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}

// A grass-tuft alpha mask: a fan of blades rising from one root point, the
// way a loaded brush flicks a tuft in three strokes. Fanning from a shared
// base is what keeps it reading as a plant rather than stray hairs.
function makeGrassAlpha() {
  const c = document.createElement('canvas');
  // Low-res on purpose: with nearest filtering the blade edges land as hard
  // pixel steps, which is the grass equivalent of the blocky geometry.
  const S = 24;
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = rng(4);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  const rootX = S / 2, rootY = S;
  for (let i = 0; i < 7; i++) {
    // Spread across the fan, denser in the middle, arcing outward.
    const t = (i + 0.5) / 7;
    const spread = (t - 0.5) * 2;                       // -1..1 across the fan
    const h = (0.45 + rnd() * 0.5) * S * (1 - Math.abs(spread) * 0.35);
    const tipX = rootX + spread * S * 0.52 + (rnd() - 0.5) * 2;
    const tipY = rootY - h;
    const ctrlX = rootX + spread * S * 0.18;
    const ctrlY = rootY - h * 0.55;
    const w = 1.2 + rnd() * 1.1;                        // base width of blade
    ctx.beginPath();
    ctx.moveTo(rootX - w, rootY);
    ctx.quadraticCurveTo(ctrlX - w * 0.5, ctrlY, tipX, tipY);
    ctx.quadraticCurveTo(ctrlX + w * 0.5, ctrlY, rootX + w, rootY);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// Injects wind into any material. Displacement rises with height so the base
// stays planted; instanced meshes offset by world position so they desync.
function addSway(material, timeUniform, strength) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uSway = { value: strength };
    shader.vertexShader = `
      uniform float uTime;
      uniform float uSway;
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float swayOffset = 0.0;
       #ifdef USE_INSTANCING
         swayOffset = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.22;
       #endif
       float gust = 0.6 + 0.4 * sin(uTime * 0.37 + swayOffset * 0.1);
       float amp = min(pow(max(transformed.y, 0.0) * 0.12, 1.7), 0.55) * uSway * gust;
       transformed.x += sin(uTime * 1.6 + swayOffset) * amp;
       transformed.z += cos(uTime * 1.3 + swayOffset * 1.4) * amp * 0.6;
      `,
    );
  };
  material.customProgramCacheKey = () => `sway${strength}`;
}

// ------------------------------------------------------------------ weather

// Wind-blown motes. Kurosawa's frames are almost never still air.
export class Dust {
  constructor(scene, count = 420) {
    const rnd = rng(12);
    const pos = new Float32Array(count * 3);
    this.vel = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * 120;
      pos[i * 3 + 1] = rnd() * 16;
      pos[i * 3 + 2] = (rnd() - 0.5) * 120;
      this.vel.push(3 + rnd() * 7, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 2.5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.11, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.count = count;
    this.pos = pos;
    scene.add(this.points);
  }

  update(dt, center) {
    const p = this.pos;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      p[i3] += this.vel[i3] * dt;
      p[i3 + 1] += this.vel[i3 + 1] * dt;
      p[i3 + 2] += this.vel[i3 + 2] * dt;
      // Recycle around the camera target rather than a fixed box.
      if (p[i3] > center.x + 60) p[i3] -= 120;
      if (p[i3] < center.x - 60) p[i3] += 120;
      if (p[i3 + 2] > center.z + 60) p[i3 + 2] -= 120;
      if (p[i3 + 2] < center.z - 60) p[i3 + 2] += 120;
      if (p[i3 + 1] > 17) p[i3 + 1] = 0;
      if (p[i3 + 1] < 0) p[i3 + 1] = 16;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// Rain, saved for boss waves. Vertical white streaks over a dark field is the
// single most recognisable image in the whole genre.
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
      color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false,
    }));
    this.lines.frustumCulled = false;
    this.count = count;
    this.pos = pos;
    this.intensity = 0;
    scene.add(this.lines);
  }

  update(dt, center, target) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.6);
    this.lines.material.opacity = this.intensity * 0.5;
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
