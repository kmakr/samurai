// Characters, built from primitives and shaded flat.
//
// In monochrome the silhouette carries everything, so each enemy type differs
// in outline — hat, height, stance — rather than in colour.

import * as THREE from 'three';
import { vox, boxLayers, taperLayers } from './voxel.js';

// --------------------------------------------------------------- materials

// Hard-stepped ramp. Three tones is enough to read as brush-inked shading.
function gradientMap(steps = [0.18, 0.55, 1.0]) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    const b = Math.round(v * 255);
    data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const RAMP = gradientMap();

const OUTLINE_VERT = /* glsl */`
  uniform float uThickness;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    // Scale by view depth so the outline keeps a constant screen weight.
    mv.xyz += n * uThickness * max(-mv.z, 1.0) * 0.006;
    gl_Position = projectionMatrix * mv;
  }
`;

const OUTLINE_FRAG = /* glsl */`
  uniform vec3 uColor;
  void main() { gl_FragColor = vec4(uColor, 1.0); }
`;

export function outlineMaterial(thickness = 1.0, color = 0x000000) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
  });
}

const SHARED_OUTLINE = outlineMaterial(1.0);

export function toon(value, opts = {}) {
  return new THREE.MeshToonMaterial({
    color: new THREE.Color(value, value, value),
    gradientMap: RAMP,
    ...opts,
  });
}

// Attaching the outline as a *child* of each mesh means it inherits every
// animated transform for free — no clone to keep in sync.
export function addOutlines(root, thickness = 1.0) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.noOutline) meshes.push(o); });
  for (const m of meshes) {
    const o = new THREE.Mesh(m.geometry, thickness === 1.0 ? SHARED_OUTLINE : outlineMaterial(thickness));
    o.castShadow = false;
    o.receiveShadow = false;
    o.userData.noOutline = true;
    o.renderOrder = -1;
    m.add(o);
  }
}

// --------------------------------------------------------- geometry cache
// Enemies are built and thrown away continuously, so primitives are shared
// rather than reallocated. Only materials are per-instance.

const geoCache = new Map();
function cached(key, build) {
  let g = geoCache.get(key);
  if (!g) { g = build(); geoCache.set(key, g); }
  return g;
}
const box = (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s, open = false) =>
  cached(`c${rt},${rb},${h},${s},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open));
const cone = (r, h, s) => cached(`n${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
// Square column, optionally tapered: a 4-sided cylinder turned 45 degrees so
// its faces are axis-aligned. Radius is bumped so the face width matches the
// round primitive it replaces. This is the "blocky" workhorse.
const sq = (rt, rb, h) => cached(`s${rt},${rb},${h}`, () => {
  const g = new THREE.CylinderGeometry(rt * 1.18, rb * 1.18, h, 4, 1);
  g.rotateY(Math.PI / 4);
  return g;
});

function part(geo, value, opts) {
  const m = new THREE.Mesh(geo, toon(value, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------- voxel parts

// All characters share one voxel scale, so every figure reads as built from
// the same bricks. Geometry is cached by key; materials stay per-instance.
const VS = 0.105;

function vpart(key, layers, value, opts = {}) {
  const geo = cached(`v${key}`, () => vox(layers, VS, { seed: hashKey(key), ...opts }));
  const m = new THREE.Mesh(geo, toon(value, { vertexColors: true }));
  m.castShadow = true;
  m.receiveShadow = true;
  // The inverted-hull outline splits at every cube edge on non-indexed voxel
  // geometry; voxel figures carry their shape with faces, not ink lines.
  m.userData.noOutline = true;
  return m;
}

function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// A limb mesh hung below its pivot group, so rotation happens at the joint.
function vlimb(key, layers, value, dropY) {
  const m = vpart(key, layers, value);
  m.position.y = dropY;
  return m;
}

// ------------------------------------------------------------------ katana

function makeKatana(len = 1.15, dark = false) {
  const g = new THREE.Group();
  // Voxel blade with a stepped tip — the last two cells shift sideways, the
  // way a voxel sword suggests its kissaki. Length in cells tracks `len`.
  const cells = Math.round(len / VS);
  const bladeLayers = [];
  for (let i = 0; i < cells - 2; i++) bladeLayers.push(['X ']);
  bladeLayers.push(['XX'], [' X']);
  const blade = vpart(`blade${cells}`, bladeLayers, dark ? 0.42 : 0.95, { centerY: false });
  blade.position.y = 0.12;
  blade.userData.isBlade = true;
  if (dark) {
    // A second, slightly larger blade supplies a clean aura without a bloom
    // post-effect. Its opacity is driven by the real parry timing window.
    const glow = new THREE.Mesh(blade.geometry, new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    glow.scale.setScalar(1.1);
    glow.renderOrder = 7;
    glow.userData.isBladeGlow = true;
    glow.userData.noOutline = true;
    blade.add(glow);
  }
  const tsuba = vpart('tsuba', boxLayers(2, 2, 1), 0.10);
  tsuba.position.y = 0.10;
  const tsuka = vpart('tsuka', boxLayers(1, 1, 3), 0.06);
  tsuka.position.y = -0.06;
  g.add(blade, tsuba, tsuka);
  return g;
}

// ------------------------------------------------------------------ player

export function makeSamurai() {
  const root = new THREE.Group();
  root.scale.setScalar(1.06);

  const hips = new THREE.Group();
  hips.position.y = 0.94;
  root.add(hips);

  // A fitted dō instead of the enemy's square robe. The bright front plates
  // and lacing keep their shape while the torso twists through a cut.
  const torso = vpart('pTorsoArmored', taperLayers(7, 5, 6, 4, 7, 1), 0.38);
  torso.position.y = 0.34;
  hips.add(torso);
  const breastplate = vpart('pBreastplate', boxLayers(6, 1, 4, 1), 0.68);
  breastplate.position.set(0, 0.02, 0.28);
  torso.add(breastplate);
  const chestLace = vpart('pChestLace', boxLayers(6, 1, 1), 0.08);
  chestLace.position.set(0, -0.14, 0.34);
  torso.add(chestLace);

  // Broad lamellar shoulders are the first player-only silhouette cue.
  const shoulders = vpart('pShouldersArmored', taperLayers(12, 5, 9, 4, 3, 1), 0.52);
  shoulders.position.y = 0.60;
  hips.add(shoulders);

  const hakama = vpart('pHakamaArmored', taperLayers(10, 9, 5, 4, 9, 1), 0.18);
  hakama.position.y = -0.44;
  hips.add(hakama);

  const obi = vpart('pObi', boxLayers(6, 5, 1), 0.03);
  obi.position.y = 0.0;
  hips.add(obi);

  const neck = vpart('pNeck', boxLayers(2, 2, 1), 0.48);
  neck.position.y = 0.74;
  hips.add(neck);

  // Two white war-sash tails stay visible from the high camera at every
  // facing. They are both costume and player marker, not a HUD ring.
  const sashL = vpart('pSashLong', boxLayers(2, 2, 12), 0.94);
  sashL.position.set(-0.15, 0.38, -0.62);
  sashL.rotation.set(Math.PI / 2, -0.09, 0);
  hips.add(sashL);
  const sashR = vpart('pSashShort', boxLayers(2, 2, 9), 0.82);
  sashR.position.set(0.14, 0.34, -0.50);
  sashR.rotation.set(Math.PI / 2, 0.12, 0);
  hips.add(sashR);

  const head = new THREE.Group();
  head.position.y = 0.88;
  hips.add(head);
  const skull = vpart('pSkullArmored', boxLayers(3, 3, 3), 0.42);
  head.add(skull);
  // Kabuto bowl, flared shikoro neck guard, and a bright frontal maedate.
  // The crest is a flat voxel sun rather than oni-like horns.
  const shikoro = vpart('pShikoro', taperLayers(7, 6, 4, 4, 3, 1), 0.14);
  shikoro.position.y = -0.02;
  head.add(shikoro);
  const kabuto = vpart('pKabuto', taperLayers(5, 5, 4, 4, 4, 1), 0.10);
  kabuto.position.y = 0.20;
  head.add(kabuto);
  const maedate = vpart('pMaedate', boxLayers(5, 1, 4, 1), 0.96);
  maedate.position.set(0, 0.30, 0.28);
  head.add(maedate);
  const faceGuard = vpart('pMenpo', boxLayers(3, 1, 2, 1), 0.06);
  faceGuard.position.set(0, -0.07, 0.20);
  head.add(faceGuard);

  const armL = new THREE.Group();
  armL.position.set(-0.58, 0.55, 0);
  hips.add(armL);
  armL.add(vlimb('pArm', boxLayers(2, 2, 6), 0.42, -0.28));
  const sodeL = vpart('pSode', boxLayers(3, 2, 5, 1), 0.62);
  sodeL.position.set(-0.05, -0.14, 0);
  armL.add(sodeL);

  const armR = new THREE.Group();
  armR.position.set(0.58, 0.55, 0);
  hips.add(armR);
  armR.add(vlimb('pArm', boxLayers(2, 2, 6), 0.42, -0.28));
  const sodeR = vpart('pSode', boxLayers(3, 2, 5, 1), 0.62);
  sodeR.position.set(0.05, -0.14, 0);
  armR.add(sodeR);

  const katana = makeKatana(1.2);
  katana.position.set(0, -0.56, 0.06);
  // Grip pitch: the blade leaves the fist angled forward (chūdan guard), not
  // straight up the arm — bare +Y runs the blade vertically past the skull,
  // which from the game's top-down camera reads as growing out of the head.
  katana.rotation.x = 1.05;
  armR.add(katana);

  const legL = new THREE.Group();
  legL.position.set(-0.17, -0.78, 0);
  hips.add(legL);
  legL.add(vlimb('pLeg', boxLayers(2, 2, 7), 0.12, -0.34));

  const legR = new THREE.Group();
  legR.position.set(0.17, -0.78, 0);
  hips.add(legR);
  legR.add(vlimb('pLeg', boxLayers(2, 2, 7), 0.12, -0.34));

  return { root, hips, head, torso, shoulders, hakama, armL, armR, legL, legR, katana, sashL, sashR };
}

// ------------------------------------------------------------------ enemies

export const ENEMY_TYPES = {
  // Rank and file. Straw hat gives a wide, flat silhouette.
  ronin: { height: 1.0, hat: true, mask: false, hp: 34, speed: 3.0, reach: 2.5, windup: 0.52, damage: 12, value: 1 },
  // Faster, bare-headed, closes hard.
  hunter: { height: 0.94, hat: false, mask: false, hp: 26, speed: 4.2, reach: 2.3, windup: 0.36, damage: 10, value: 1 },
  // Slow, heavy, huge reach. Read the wind-up or pay for it.
  brute: { height: 1.35, hat: false, mask: true, hp: 90, speed: 2.0, reach: 3.4, windup: 0.82, damage: 26, value: 3 },
  // Boss.
  oni: { height: 1.85, hat: false, mask: true, hp: 340, speed: 2.3, reach: 4.0, windup: 0.7, damage: 32, value: 12 },
};

export function makeEnemy(type) {
  const spec = ENEMY_TYPES[type];
  const root = new THREE.Group();

  const hips = new THREE.Group();
  hips.position.y = 0.88;
  root.add(hips);

  const torso = vpart('eTorso', boxLayers(6, 4, 7), 0.20);
  torso.position.y = 0.32;
  hips.add(torso);

  const shoulders = vpart('eShoulders', boxLayers(9, 4, 2), 0.16);
  shoulders.position.y = 0.56;
  hips.add(shoulders);

  const skirt = vpart('eSkirt', taperLayers(8, 8, 4, 4, 8, 1), 0.22);
  skirt.position.y = -0.40;
  hips.add(skirt);

  const head = new THREE.Group();
  head.position.y = 0.82;
  hips.add(head);
  const skull = vpart('eSkull', boxLayers(3, 3, 3), spec.mask ? 0.06 : 0.62);
  head.add(skull);

  if (spec.hat) {
    // Kasa: a wide stepped pyramid that hides the face entirely.
    const hat = vpart('eKasa', taperLayers(9, 9, 3, 3, 3, 2), 0.78);
    hat.position.y = 0.24;
    head.add(hat);
  } else if (spec.mask) {
    const horns = new THREE.Group();
    const hornL = vpart('eHorn', boxLayers(1, 1, 3), 0.88);
    hornL.position.set(-0.11, 0.31, 0);
    hornL.rotation.z = -0.42;
    const hornR = vpart('eHorn', boxLayers(1, 1, 3), 0.88);
    hornR.position.set(0.11, 0.31, 0);
    hornR.rotation.z = 0.42;
    horns.add(hornL, hornR);
    head.add(horns);
    // Bright eyes are the only high-value pixels on the model, so they read
    // even at distance through the grain.
    const eyes = new THREE.Mesh(
      box(0.22, 0.045, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    eyes.position.set(0, 0.03, 0.145);
    eyes.userData.noOutline = true;
    head.add(eyes);
  } else {
    const hair = vpart('eHair', boxLayers(4, 4, 2, 1), 0.10);
    hair.position.y = 0.14;
    head.add(hair);
  }

  const armL = new THREE.Group();
  armL.position.set(-0.46, 0.5, 0);
  hips.add(armL);
  armL.add(vlimb('eArm', boxLayers(2, 2, 6), 0.18, -0.27));

  const armR = new THREE.Group();
  armR.position.set(0.46, 0.5, 0);
  hips.add(armR);
  armR.add(vlimb('eArm', boxLayers(2, 2, 6), 0.18, -0.27));

  // Enemy steel stays grey until the emissive wind-up telegraph. The player's
  // blade remains white, which makes ownership clear when figures overlap.
  const katana = makeKatana(type === 'oni' || type === 'brute' ? 1.5 : 1.1, true);
  katana.position.set(0, -0.52, 0.05);
  // Same grip pitch as the player: without it the blade skewers the kasa.
  katana.rotation.x = 1.05;
  armR.add(katana);

  const legL = new THREE.Group();
  legL.position.set(-0.16, -0.74, 0);
  hips.add(legL);
  legL.add(vlimb('eLeg', boxLayers(2, 2, 7), 0.16, -0.32));

  const legR = new THREE.Group();
  legR.position.set(0.16, -0.74, 0);
  hips.add(legR);
  legR.add(vlimb('eLeg', boxLayers(2, 2, 7), 0.16, -0.32));

  root.scale.setScalar(spec.height);

  return { root, hips, head, torso, shoulders, skirt, armL, armR, legL, legR, katana };
}

// ---------------------------------------------------------------- animation

// Shared locomotion. `phase` advances with distance travelled so the gait stays
// in step with actual movement instead of drifting against it.
export function animateLocomotion(a, phase, blend, t) {
  const swing = Math.sin(phase) * 0.85 * blend;
  a.legL.rotation.x = swing;
  a.legR.rotation.x = -swing;
  a.hips.position.y = a.baseHipY + Math.abs(Math.sin(phase)) * 0.07 * blend;
  a.hips.rotation.z = Math.sin(phase) * 0.03 * blend;
  a.head.rotation.z = -Math.sin(phase) * 0.04 * blend;
  // Idle breathing, so a standing figure is never perfectly still.
  const breathe = Math.sin(t * 1.9) * 0.02 * (1 - blend);
  a.hips.position.y += breathe;
  if (a.sashL) {
    const drift = Math.sin(t * 3.1 + phase * 0.18) * (0.035 + blend * 0.065);
    a.sashL.rotation.y = -0.09 + drift;
    a.sashR.rotation.y = 0.12 - drift * 0.8;
  }
}
