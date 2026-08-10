// The arena: a sheet of paper laid on dark ground, ringed by bamboo.
//
// The conceit is that the duel happens on the page. The paper is the only
// bright surface in the scene, which is what lets black ink read at any
// distance and gives the frame its Kurosawa contrast.

import * as THREE from 'three';
import { toon, addOutlines } from './actors.js';
import { makePaperTexture, rng } from './paper.js';

export const ARENA = 20;       // half-extent of the paper
const BAMBOO_COUNT = 260;

export function buildWorld(scene, timeUniform) {
  const rnd = rng(99);
  const group = new THREE.Group();
  scene.add(group);

  // ------------------------------------------------------------ the paper
  const paperTex = makePaperTexture(1024, 7);
  // Tiled: at one texel per 4cm the fibres read as paper, not as scattered sticks.
  paperTex.repeat.set(5, 5);
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
    new THREE.MeshToonMaterial({ map: paperTex, color: 0xffffff }),
  );
  paper.rotation.x = -Math.PI / 2;
  paper.receiveShadow = true;
  group.add(paper);

  // Deckled edge: a slightly larger, darker sheet peeking out underneath.
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA * 2 + 1.6, ARENA * 2 + 1.6),
    toon(0.22),
  );
  under.rotation.x = -Math.PI / 2;
  under.position.y = -0.03;
  group.add(under);

  // ------------------------------------------------------------- the ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(0.055));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  group.add(ground);

  // ---------------------------------------------------------------- bamboo
  const stalkGeo = new THREE.CylinderGeometry(0.11, 0.14, 14, 5, 1, true);
  stalkGeo.translate(0, 7, 0);
  const bambooMat = toon(0.30, { side: THREE.DoubleSide });
  addSway(bambooMat, timeUniform, 0.9);

  const bamboo = new THREE.InstancedMesh(stalkGeo, bambooMat, BAMBOO_COUNT);
  bamboo.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let placed = 0;
  while (placed < BAMBOO_COUNT) {
    const a = rnd() * Math.PI * 2;
    const r = ARENA + 3 + Math.pow(rnd(), 0.6) * 46;
    pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    const lean = (rnd() - 0.5) * 0.14;
    q.setFromEuler(new THREE.Euler(lean, rnd() * Math.PI, (rnd() - 0.5) * 0.14));
    scl.set(0.7 + rnd() * 0.7, 0.6 + rnd() * 0.8, 0.7 + rnd() * 0.7);
    m.compose(pos, q, scl);
    bamboo.setMatrixAt(placed++, m);
  }
  bamboo.instanceMatrix.needsUpdate = true;
  group.add(bamboo);

  // ----------------------------------------------------------------- torii
  const torii = new THREE.Group();
  const pillarGeo = new THREE.CylinderGeometry(0.34, 0.42, 7.4, 8);
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
  torii.position.set(0, 0, -ARENA - 5);
  addOutlines(torii, 1.4);
  group.add(torii);

  // ----------------------------------------------------------------- rocks
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 26; i++) {
    const rock = new THREE.Mesh(rockGeo, toon(0.14));
    const a = rnd() * Math.PI * 2;
    const r = ARENA + 1.5 + rnd() * 34;
    rock.position.set(Math.cos(a) * r, rnd() * 0.3, Math.sin(a) * r);
    rock.scale.set(0.5 + rnd() * 1.8, 0.3 + rnd() * 0.9, 0.5 + rnd() * 1.8);
    rock.rotation.set(rnd(), rnd(), rnd());
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  // ------------------------------------------------------------------ grass
  // Cross-quad tufts just off the paper's edge, swaying with the same wind.
  const bladeGeo = new THREE.PlaneGeometry(0.8, 1.5);
  bladeGeo.translate(0, 0.75, 0);
  const grassMat = toon(0.13, { side: THREE.DoubleSide, transparent: true, alphaTest: 0.5, map: makeGrassAlpha() });
  addSway(grassMat, timeUniform, 2.2);
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, 900);
  let gi = 0;
  while (gi < 900) {
    const a = rnd() * Math.PI * 2;
    const r = ARENA + 0.5 + Math.pow(rnd(), 0.7) * 26;
    pos.set(Math.cos(a) * r, -0.1, Math.sin(a) * r);
    q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0));
    const s = 0.6 + rnd() * 1.1;
    scl.set(s, s * (0.7 + rnd() * 0.8), s);
    m.compose(pos, q, scl);
    grass.setMatrixAt(gi++, m);
  }
  grass.instanceMatrix.needsUpdate = true;
  group.add(grass);

  return { group, paper, bamboo, grass };
}

// A grass-blade alpha mask: a few tapered strands per quad.
function makeGrassAlpha() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const rnd = rng(4);
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 7; i++) {
    const x = 6 + rnd() * 52;
    const h = 28 + rnd() * 34;
    const lean = (rnd() - 0.5) * 22;
    ctx.beginPath();
    ctx.moveTo(x - 2.2, 64);
    ctx.quadraticCurveTo(x + lean * 0.4, 64 - h * 0.6, x + lean, 64 - h);
    ctx.quadraticCurveTo(x + lean * 0.4 + 2, 64 - h * 0.6, x + 2.2, 64);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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
       float amp = pow(max(transformed.y, 0.0) * 0.12, 1.7) * uSway * gust;
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
