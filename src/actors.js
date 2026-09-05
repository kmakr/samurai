// Blender-authored characters, decoded once and shaded as faceted ink.
//
// In monochrome the silhouette carries everything, so each enemy type differs
// in outline — hat, height, stance — rather than in colour.

import * as THREE from 'three';
import { ACTOR_MESHES } from '../assets/models/storm-court.js';

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

// Player skins are lacquer palettes, not power. They deliberately vary tonal
// hierarchy as well as hue so each one remains distinct after the film pass
// turns the scene into an orthochromatic black-and-white print.
export const SAMURAI_SKINS = [
  {
    id: 'musashi', name: 'MUSASHI', epithet: 'WANDERING SWORD',
    colors: {
      armor: 0x5e4938, plate: 0x8d7558, cloth: 0x28201b, trim: 0x0b0908,
      skin: 0x81766b, sash: 0xc9b78f, crest: 0xd8c69d,
    },
    features: ['wildHair', 'dualSword', 'warSash'],
  },
  {
    id: 'hitokiri', name: 'HITOKIRI', epithet: 'CRIMSON DRAW',
    colors: {
      armor: 0x8b2b22, plate: 0xc95a3f, cloth: 0x211b1e, trim: 0x09080a,
      skin: 0x82766e, sash: 0xe7d9bd, crest: 0xd7462f,
    },
    features: ['ponytail', 'lightSleeves', 'warSash'],
  },
  {
    id: 'masamune', name: 'MASAMUNE', epithet: 'ONE-EYED DRAGON',
    colors: {
      armor: 0x3f5f9a, plate: 0x7899d0, cloth: 0x151c2b, trim: 0x07090d,
      skin: 0x817970, sash: 0xc1d2e8, crest: 0xe0e8ee,
    },
    features: ['kabuto', 'armoredShoulders', 'dragonCrescent'],
  },
  {
    id: 'mibu', name: 'MIBU WOLF', epithet: 'PALE HAORI',
    colors: {
      armor: 0xb7d2d1, plate: 0xe8eee7, cloth: 0x30383d, trim: 0x12161a,
      skin: 0x817870, sash: 0x496b72, crest: 0xf5efe1,
    },
    features: ['mibuHaori', 'mibuHeadband'],
  },
];

export function applySamuraiSkin(actor, skinId) {
  const skin = SAMURAI_SKINS.find((entry) => entry.id === skinId) || SAMURAI_SKINS[0];
  const features = new Set(skin.features);
  actor.root.traverse((object) => {
    const feature = object.userData.skinFeature;
    if (feature) object.visible = features.has(feature);
    const slot = object.userData.skinSlot;
    if (!slot || !object.material || !skin.colors[slot]) return;
    object.material.color.setHex(skin.colors[slot]).multiplyScalar(1.7);
  });
  actor.skin = skin.id;
  return skin;
}

// Weapons are wielded steel — an axis orthogonal to skins. A skin is who the
// samurai is; a weapon is what they carry. Each keeps the shared dash and parry,
// but carries its own combo (authored in main.js — its own animation, timing and
// hit shape, not a stat multiplier) and its own focus-spent signature. KATANA is
// the blade every run starts with; its signature is the iai draw. `blade` scales
// the katana mesh so the silhouette reads the change from the high camera.
export const WEAPONS = [
  {
    id: 'katana', name: '刀', roman: 'KATANA', epithet: 'THE DRAWN LINE',
    skill: 'iai', skillName: '居合', skillRoman: 'IAI', gaugeLabel: 'IAI',
    blade: { lengthMul: 1, widthMul: 1 },
  },
  {
    id: 'nodachi', name: '大太刀', roman: 'NODACHI', epithet: 'THE GREAT BLADE',
    skill: 'tsunami', skillName: '波断', skillRoman: 'TSUNAMI CUT', gaugeLabel: 'WAVE',
    blade: { lengthMul: 1, widthMul: 1 },
  },
];

export function applyWeapon(actor, weaponId) {
  const weapon = WEAPONS.find((entry) => entry.id === weaponId) || WEAPONS[0];
  // The player carries both cached models under one animated mount. Only the
  // selected model is visible. Enemies still use one ordinary katana model.
  if (actor.weaponModels) {
    for (const [id, model] of Object.entries(actor.weaponModels)) model.visible = id === weapon.id;
  }
  if (actor.katana) {
    actor.katana.scale.set(weapon.blade.widthMul, weapon.blade.lengthMul, weapon.blade.widthMul);
  }
  actor.weapon = weapon.id;
  return weapon;
}

export const ENEMY_TYPES = {
  // Rank and file. Straw hat gives a wide, flat silhouette.
  ronin: { height: 1.0, hat: true, mask: false, hp: 34, speed: 3.0, reach: 2.5, windup: 0.52, damage: 12, value: 1 },
  // Faster, bare-headed, closes hard.
  hunter: { height: 0.94, hat: false, mask: false, hp: 26, speed: 4.2, reach: 2.3, windup: 0.36, damage: 10, value: 1 },
  // Yari spearman: lean and tall, with a long pole that strikes from what
  // feels like a safe distance. Read the reach, not the body.
  yari: { height: 1.14, hat: false, mask: false, hp: 30, speed: 3.15, reach: 4.6, windup: 0.6, damage: 16, value: 2, pole: true },
  // Yumi archer: holds distance and fires along a telegraphed line. The only
  // enemy the player must move against rather than parry. `windup` is the
  // draw time; `range` the preferred firing distance.
  yumi: { height: 0.95, hat: true, mask: false, hp: 22, speed: 2.6, reach: 2.0, windup: 1.15, damage: 14, value: 2, bow: true, range: 12 },
  // Slow, heavy, huge reach. Read the wind-up or pay for it.
  brute: { height: 1.35, hat: false, mask: true, hp: 90, speed: 2.0, reach: 3.4, windup: 0.82, damage: 26, value: 3 },
  // Boss.
  oni: { height: 1.85, hat: false, mask: true, hp: 340, speed: 2.3, reach: 4.0, windup: 0.7, damage: 32, value: 12 },
};

// Blender-authored, quantized meshes. Decode once per part, share geometry
// across every wave, and retain the exact joint contract used by the ragdolls.
const geometryCache = new Map();
const JOINTS = {
  torso: [0, .34, 0], shoulders: [0, .56, 0], skirt: [0, -.32, 0],
  head: [0, .84, 0], armL: [-.48, .52, 0], armR: [.48, .52, 0],
  legL: [-.18, -.38, 0], legR: [.18, -.38, 0],
  sashL: [-.17, .38, -.32], sashR: [.17, .34, -.3],
};

function decodeGeometry(key, data) {
  if (geometryCache.has(key)) return geometryCache.get(key);
  const geometry = new THREE.BufferGeometry();
  const positions = Float32Array.from(data.p, value => value / 10000);
  const colors = new Float32Array(positions.length);
  for (let triangle = 0; triangle < data.c.length; triangle++) {
    // Authored values are linear ink reflectance, with a small per-face edge
    // variation already carried by the faceted normals.
    const value = data.c[triangle] / 255;
    colors.fill(value, triangle * 9, triangle * 9 + 9);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometryCache.set(key, geometry);
  return geometry;
}

function makeActor(model) {
  const root = new THREE.Group();
  root.name = `storm-court:${model}`;
  const hips = new THREE.Group(); hips.position.y = .94; root.add(hips);
  const actor = { root, hips };
  for (const [name, position] of Object.entries(JOINTS)) {
    actor[name] = new THREE.Group(); actor[name].name = name;
    actor[name].position.set(...position); hips.add(actor[name]);
  }
  actor.hakama = actor.skirt;
  actor.katana = new THREE.Group(); actor.katana.name = 'weapon-mount';
  actor.katana.position.set(0, -.52, .06); actor.katana.rotation.x = 1.05;
  actor.armR.add(actor.katana);
  if (model === 'player') {
    actor.weaponModels = { katana: new THREE.Group(), nodachi: new THREE.Group() };
    actor.katana.add(...Object.values(actor.weaponModels));
    actor.weaponModels.nodachi.visible = false;
  }
  for (const [index, data] of ACTOR_MESHES[model].entries()) {
    // Per-part materials survive independent limb retirement. Geometries stay
    // shared; ragdoll disposal must never invalidate another living actor.
    const material = toon(1, { vertexColors: true, emissive: 0x4b4b4b, emissiveIntensity: .28 });
    const mesh = new THREE.Mesh(decodeGeometry(`${model}:${index}`, data), material);
    mesh.name = `${model}:${data.joint}:${data.feature || data.slot || 'ink'}`;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.noOutline = true;
    if (data.slot && data.slot !== 'steel') mesh.userData.skinSlot = data.slot;
    if (data.feature) { mesh.userData.skinFeature = data.feature; mesh.visible = false; }
    if (data.slot === 'steel') {
      mesh.userData.isBlade = true;
      if (model !== 'player') {
        const glow = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending,
        }));
        glow.scale.setScalar(1.035); glow.renderOrder = 7;
        glow.userData.isBladeGlow = true; glow.userData.noOutline = true; mesh.add(glow);
      }
    }
    const parent = model === 'player' && actor.weaponModels[data.joint]
      ? actor.weaponModels[data.joint] : actor[data.joint];
    parent.add(mesh);
  }
  if (model === 'yumi') actor.katana.rotation.x = .12;
  if (model === 'yari') actor.katana.position.y = -.9;
  return actor;
}

export function makeSamurai() {
  const actor = makeActor('player');
  actor.root.scale.setScalar(1.06);
  return actor;
}

export function makeEnemy(type) {
  const spec = ENEMY_TYPES[type];
  const actor = makeActor(type);
  if (spec.pole) actor.root.scale.set(spec.height * .82, spec.height * 1.12, spec.height * .82);
  else actor.root.scale.setScalar(spec.height);
  return actor;
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
    a.sashL.rotation.x = -.25 - blend * .65;
    a.sashL.rotation.z = -.12 + drift;
    a.sashR.rotation.x = -.22 - blend * .55;
    a.sashR.rotation.z = .12 - drift * .8;
  }
}
