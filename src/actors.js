// Characters, built from primitives and shaded flat.
//
// In monochrome the silhouette carries everything, so each enemy type differs
// in outline — hat, height, stance — rather than in colour.

import * as THREE from 'three';

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

function part(geo, value, opts) {
  const m = new THREE.Mesh(geo, toon(value, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A limb mesh hung below its pivot group, so rotation happens at the joint.
function limb(geo, value, dropY) {
  const m = part(geo, value);
  m.position.y = dropY;
  return m;
}

// ------------------------------------------------------------------ katana

function makeKatana(len = 1.15, dark = false) {
  const g = new THREE.Group();
  // Slight curve, faked by tilting two segments rather than bending geometry.
  const blade = part(box(0.045, len, 0.115), dark ? 0.42 : 0.95);
  blade.position.y = len * 0.5 + 0.12;
  const tip = part(cone(0.062, 0.2, 4), dark ? 0.42 : 0.95);
  tip.rotation.y = Math.PI * 0.25;
  tip.scale.set(1, 1, 0.55);
  tip.position.y = len + 0.2;
  const tsuba = part(cyl(0.11, 0.11, 0.035, 8), 0.10);
  tsuba.position.y = 0.10;
  const tsuka = part(box(0.062, 0.30, 0.085), 0.06);
  tsuka.position.y = -0.06;
  g.add(blade, tip, tsuba, tsuka);
  return g;
}

// ------------------------------------------------------------------ player

export function makeSamurai() {
  const root = new THREE.Group();

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const torso = part(box(0.62, 0.72, 0.38), 0.30);
  torso.position.y = 0.34;
  hips.add(torso);

  // Haori shoulders — the flared silhouette that says "samurai" at a glance.
  const shoulders = part(box(1.06, 0.24, 0.44), 0.58);
  shoulders.position.y = 0.60;
  hips.add(shoulders);

  const hakama = part(cyl(0.34, 0.62, 0.92, 8), 0.14);
  hakama.position.y = -0.44;
  hips.add(hakama);

  const obi = part(cyl(0.36, 0.36, 0.13, 8), 0.03);
  obi.position.y = 0.0;
  hips.add(obi);

  const neck = part(cyl(0.1, 0.1, 0.12, 6), 0.55);
  neck.position.y = 0.74;
  hips.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.86;
  hips.add(head);
  const skull = part(box(0.3, 0.34, 0.3), 0.72);
  head.add(skull);
  const hair = part(box(0.33, 0.2, 0.33), 0.04);
  hair.position.y = 0.11;
  head.add(hair);
  const knot = part(cyl(0.045, 0.06, 0.16, 6), 0.04);
  knot.position.set(0, 0.2, -0.09);
  knot.rotation.x = -0.5;
  head.add(knot);

  const armL = new THREE.Group();
  armL.position.set(-0.5, 0.55, 0);
  hips.add(armL);
  const armLMesh = part(box(0.17, 0.62, 0.19), 0.42);
  armLMesh.position.y = -0.28;
  armL.add(armLMesh);

  const armR = new THREE.Group();
  armR.position.set(0.5, 0.55, 0);
  hips.add(armR);
  const armRMesh = part(box(0.17, 0.62, 0.19), 0.42);
  armRMesh.position.y = -0.28;
  armR.add(armRMesh);

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
  const legLMesh = part(box(0.2, 0.72, 0.22), 0.12);
  legLMesh.position.y = -0.34;
  legL.add(legLMesh);

  const legR = new THREE.Group();
  legR.position.set(0.17, -0.78, 0);
  hips.add(legR);
  const legRMesh = part(box(0.2, 0.72, 0.22), 0.12);
  legRMesh.position.y = -0.34;
  legR.add(legRMesh);

  addOutlines(root, 1.15);

  return { root, hips, head, torso, armL, armR, legL, legR, katana };
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

  const torso = part(box(0.6, 0.7, 0.36), 0.05);
  torso.position.y = 0.32;
  hips.add(torso);

  const shoulders = part(box(0.94, 0.2, 0.4), 0.03);
  shoulders.position.y = 0.56;
  hips.add(shoulders);

  const skirt = part(cyl(0.32, 0.54, 0.8, 7), 0.08);
  skirt.position.y = -0.40;
  hips.add(skirt);

  const head = new THREE.Group();
  head.position.y = 0.82;
  hips.add(head);
  const skull = part(box(0.28, 0.32, 0.28), spec.mask ? 0.02 : 0.62);
  head.add(skull);

  if (spec.hat) {
    // Kasa: a wide cone that hides the face entirely.
    const hat = part(cone(0.46, 0.26, 10), 0.78);
    hat.position.y = 0.2;
    head.add(hat);
  } else if (spec.mask) {
    const horns = new THREE.Group();
    const hornL = part(cone(0.055, 0.34, 5), 0.88);
    hornL.position.set(-0.11, 0.28, 0);
    hornL.rotation.z = -0.42;
    const hornR = hornL.clone();
    hornR.position.x = 0.11;
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
    const hair = part(box(0.3, 0.16, 0.3), 0.03);
    hair.position.y = 0.1;
    head.add(hair);
  }

  const armL = new THREE.Group();
  armL.position.set(-0.46, 0.5, 0);
  hips.add(armL);
  armL.add(limb(box(0.16, 0.58, 0.17), 0.05, -0.27));

  const armR = new THREE.Group();
  armR.position.set(0.46, 0.5, 0);
  hips.add(armR);
  armR.add(limb(box(0.16, 0.58, 0.17), 0.05, -0.27));

  const katana = makeKatana(type === 'oni' || type === 'brute' ? 1.5 : 1.1, false);
  katana.position.set(0, -0.52, 0.05);
  // Same grip pitch as the player: without it the blade skewers the kasa.
  katana.rotation.x = 1.05;
  armR.add(katana);

  const legL = new THREE.Group();
  legL.position.set(-0.16, -0.74, 0);
  hips.add(legL);
  legL.add(limb(box(0.19, 0.68, 0.2), 0.04, -0.32));

  const legR = new THREE.Group();
  legR.position.set(0.16, -0.74, 0);
  hips.add(legR);
  legR.add(limb(box(0.19, 0.68, 0.2), 0.04, -0.32));

  root.scale.setScalar(spec.height);
  addOutlines(root, 1.1);

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
}
