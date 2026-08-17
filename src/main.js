import * as THREE from 'three';
import { FilmRenderer, applyLetterbox } from './render.js';
import { InkSystem } from './ink.js';
import { buildWorld, ARENA, Rain } from './world.js';
import { makeSamurai, makeEnemy, ENEMY_TYPES, animateLocomotion } from './actors.js';
import { SlashTrail } from './trail.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { RagdollSystem } from './ragdoll.js';
import { VoxelGibs } from './voxel.js';
import { toon } from './actors.js';

// ---------------------------------------------------------------- constants

const PLAYER_SPEED = 7.6;
const PLAYER_MAX_HP = 100;
const GAME_VERSION = new URL(import.meta.url).searchParams.get('v') || 'DEV';
const DASH_SPEED = 24;
const DASH_TIME = 0.20;
const DASH_COOLDOWN = 0.42;

// Attack phases, in seconds. Short wind-up, brief active window, longer
// recovery — committing to a swing should feel like a decision.
// Active windows sit at 7-10 frames: shorter and the swing arc is over before
// the eye registers it, which reads as the katana not moving at all.
const ATTACK = [
  { windup: 0.09, active: 0.12, recover: 0.20, damage: 34, reach: 3.1, arc: 0.05 },
  { windup: 0.07, active: 0.12, recover: 0.22, damage: 38, reach: 3.2, arc: -0.15 },
  { windup: 0.13, active: 0.16, recover: 0.34, damage: 62, reach: 3.6, arc: 0.30 },
];
const COMBO_WINDOW = 0.42;

const PARRY_STARTUP = 0.03;
const PARRY_ACTIVE = 0.24;
const PARRY_RECOVER = 0.26;
const PARRY_COOLDOWN = 0.5;

const FOCUS_MAX = 100;
const FLOW_WINDOW = 5.5;

// ------------------------------------------------------------------- setup

const app = document.getElementById('app');
const buildTagEl = document.getElementById('buildTag');
const buildVersionEl = document.getElementById('buildVersion');
buildVersionEl.textContent = `${GAME_VERSION}`;
buildTagEl.setAttribute('aria-label', `Onisolo build ${GAME_VERSION}`);
const film = new FilmRenderer(app);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05050a);
// Linear fog suits the orthographic camera: view depth barely varies with an
// ortho projection, so exponential fog just dims the whole frame uniformly.
// A near/far band instead fades the rim of the visible ground into dark.
scene.fog = new THREE.Fog(0x0a0a10, 88, 150);

// Isometric: a fixed diagonal viewpoint, orthographic so nothing changes size
// with distance. Azimuth 45 puts world edges on screen diagonals — with the
// blocky art every box shows two faces plus a top, which is the whole look.
const ISO_AZIMUTH = Math.PI / 4;
const ISO_ELEVATION = 0.72;          // ~41 degrees; higher reads clearer, lower more dramatic
const ISO_DISTANCE = 80;
const VIEW_HALF = 9.5;               // world units from screen centre to top edge
const ISO_OFFSET = new THREE.Vector3(
  Math.sin(ISO_AZIMUTH) * Math.cos(ISO_ELEVATION),
  Math.sin(ISO_ELEVATION),
  Math.cos(ISO_AZIMUTH) * Math.cos(ISO_ELEVATION),
).multiplyScalar(ISO_DISTANCE);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
camera.position.copy(ISO_OFFSET);

const timeUniform = { value: 0 };
const world = buildWorld(scene, timeUniform);
const rain = new Rain(scene);
const WORLD_BOUND = 1e9;   // the page never ends
const ink = new InkSystem(scene, WORLD_BOUND);
const ragdolls = new RagdollSystem(scene, ink, WORLD_BOUND);
// Bodies are made of cubes now, so they come apart into cubes.
const gibs = new VoxelGibs(scene, toon(0.07), 320, 0.13);
const trail = new SlashTrail(scene, { radius: 2.7, width: 1.7, sweep: 3.0 });
const enemyTrail = new SlashTrail(scene, { radius: 2.2, width: 1.0, sweep: 2.4, color: 0x101015 });

const input = new Input(film.domElement);
const audio = new Audio();

// Lighting: one hard key for shape, a dim fill so blacks aren't dead, and a
// back light to separate figures from the ground.
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(-24, 38, 24);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -46; key.shadow.camera.right = 46;
key.shadow.camera.top = 46; key.shadow.camera.bottom = -46;
key.shadow.camera.far = 130;
key.shadow.bias = -0.0012;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);
scene.add(new THREE.HemisphereLight(0x9fb0c8, 0x0a0a10, 0.30));
const back = new THREE.DirectionalLight(0xffffff, 0.5);
back.position.set(26, 14, -20);
scene.add(back);

// -------------------------------------------------------------------- state

const player = makeSamurai();
player.baseHipY = player.hips.position.y;
player.root.position.set(0, 0, 6);
scene.add(player.root);

const state = {
  running: false,
  over: false,
  hp: PLAYER_MAX_HP,
  kills: 0,
  perfectParries: 0,
  wave: 0,
  focus: 0,
  time: 0,
  timeScale: 1,
  hitstop: 0,
  phase: 0,          // gait phase
  vel: new THREE.Vector3(),
  facing: 0,
  action: 'idle',    // idle | attack | dash | parry | iai | hurt
  actionT: 0,
  comboIndex: 0,
  comboTimer: 0,
  attackPhase: '',
  hitThisSwing: null,
  dashDir: new THREE.Vector3(),
  dashCooldown: 0,
  parryCooldown: 0,
  invuln: 0,
  waveBreak: 0,
  slots: 2,
  chain: 0,
  chainTimer: 0,
  bestChain: 0,
  rivalKills: 0,
  seenYari: false,
  lastStandUsed: false,
  deathBy: '',
  deathInfo: null,
  escapeCharges: 0,
  pendingUpgrade: false,
  choosingUpgrade: false,
  upgrades: {
    steelMind: 0,
    bloodWind: 0,
    finalStroke: 0,
    stillWater: 0,
    longShadow: 0,
    fallingLeaf: 0,
  },
  dashHit: new Set(),
};

let enemies = [];

// Daily run: a date-seeded PRNG shapes the run — spawn layout and the
// discipline scrolls offered — so everyone playing the day's trial meets the
// same structure. Cosmetic randomness (particles, shake, AI micro-timing)
// stays on Math.random, so runs still feel alive rather than on rails.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dateSeed(dateStr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const run = { daily: false, dateStr: '', rng: Math.random };

// Reusable scratch vectors — the update loop allocates nothing.
const vMove = new THREE.Vector3();
const vAim = new THREE.Vector3();
const vTmp = new THREE.Vector3();
const vTmp2 = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const camShake = new THREE.Vector3();
const camPunch = new THREE.Vector3();
const vCut = new THREE.Vector3();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// ------------------------------------------------------------------- aiming

function aimPoint(out) {
  pointer.set((input.mouse.x / innerWidth) * 2 - 1, -(input.mouse.y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, out)) {
    out.copy(player.root.position).add(vTmp.set(0, 0, -1));
  }
  return out;
}

function aimYaw() {
  aimPoint(vAim);
  const dx = vAim.x - player.root.position.x;
  const dz = vAim.z - player.root.position.z;
  if (dx * dx + dz * dz < 0.02) return state.facing;
  return Math.atan2(dx, dz);
}

// ------------------------------------------------------------------ effects

let shakeAmount = 0;
function shake(v) { shakeAmount = Math.min(1.4, shakeAmount + v); }

function hitstop(duration, scale = 0.08) {
  state.hitstop = Math.max(state.hitstop, duration);
  state.timeScale = scale;
}

let whiteFlash = 0;
let deathCrush = 0;
function flash(v) { whiteFlash = Math.max(whiteFlash, v); }

const combatCalloutEl = document.getElementById('combatCallout');
function showCombatCallout(mark, meaning) {
  combatCalloutEl.querySelector('.mark').textContent = mark;
  combatCalloutEl.querySelector('.meaning').textContent = meaning;
  combatCalloutEl.classList.remove('show');
  void combatCalloutEl.offsetWidth;
  combatCalloutEl.classList.add('show');
}

function makeBrushRing() {
  const segments = 40;
  const pos = [];
  for (let i = 0; i < segments; i++) {
    const a0 = i / segments * Math.PI * 2;
    const a1 = (i + 1) / segments * Math.PI * 2;
    const wob0 = Math.sin(i * 4.7) * 0.035 + Math.sin(i * 1.9) * 0.025;
    const wob1 = Math.sin((i + 1) * 4.7) * 0.035 + Math.sin((i + 1) * 1.9) * 0.025;
    const outer0 = 1 + wob0, outer1 = 1 + wob1;
    const inner0 = 0.76 + wob0 * 0.45, inner1 = 0.76 + wob1 * 0.45;
    const p = (a, r) => [Math.cos(a) * r, Math.sin(a) * r, 0];
    pos.push(...p(a0, inner0), ...p(a0, outer0), ...p(a1, outer1));
    pos.push(...p(a0, inner0), ...p(a1, outer1), ...p(a1, inner1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

const parryRingGeo = makeBrushRing();
const parryRings = [];
const impactBursts = [];

function spawnImpactBurst(position, strength = 1) {
  const pos = [];
  const rays = 9 + Math.floor(strength * 5);
  for (let i = 0; i < rays; i++) {
    const a = i / rays * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
    const half = 0.025 + Math.random() * 0.045;
    const inner = 0.18 + Math.random() * 0.28;
    const outer = (0.8 + Math.random() * 1.35) * strength;
    pos.push(
      Math.cos(a - half) * inner, 0, Math.sin(a - half) * inner,
      Math.cos(a) * outer, 0, Math.sin(a) * outer,
      Math.cos(a + half) * inner, 0, Math.sin(a + half) * inner,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const material = new THREE.MeshBasicMaterial({
    color: 0x08080c,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, 0.075, position.z);
  mesh.scale.setScalar(0.42);
  mesh.renderOrder = 5;
  scene.add(mesh);
  impactBursts.push({ mesh, age: 0, life: 0.24 + strength * 0.06 });
}

function updateImpactBursts(dt) {
  for (let i = impactBursts.length - 1; i >= 0; i--) {
    const burst = impactBursts[i];
    burst.age += dt;
    const k = Math.min(1, burst.age / burst.life);
    burst.mesh.scale.setScalar(0.42 + Math.sin(k * Math.PI * 0.72) * 0.9);
    burst.mesh.material.opacity = (1 - k) ** 1.5 * 0.82;
    if (k >= 1) {
      scene.remove(burst.mesh);
      burst.mesh.geometry.dispose();
      burst.mesh.material.dispose();
      impactBursts.splice(i, 1);
    }
  }
}

const iaiAura = new THREE.Group();
const iaiAuraRing = new THREE.Mesh(parryRingGeo, new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
}));
iaiAuraRing.rotation.x = -Math.PI * 0.5;
iaiAuraRing.position.y = 0.05;
iaiAura.add(iaiAuraRing);
iaiAura.visible = false;
player.root.add(iaiAura);

function updateIaiAura() {
  const ready = state.running && !state.over && state.focus >= FOCUS_MAX;
  iaiAura.visible = ready;
  if (!ready) return;
  const breath = Math.sin(state.time * 2.4);
  iaiAuraRing.scale.setScalar(2.18 + breath * 0.05);
  iaiAuraRing.material.opacity = 0.27 + breath * 0.05;
}

function spawnParryRing(position) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(parryRingGeo, mat);
  mesh.name = 'parry-ring';
  mesh.position.copy(position);
  mesh.quaternion.copy(camera.quaternion);
  mesh.renderOrder = 8;
  scene.add(mesh);
  parryRings.push({ mesh, age: 0, life: 0.42 });
}

function updateParryRings(dt) {
  for (let i = parryRings.length - 1; i >= 0; i--) {
    const r = parryRings[i];
    r.age += dt;
    const k = Math.min(1, r.age / r.life);
    r.mesh.scale.setScalar(0.7 + k * 3.8);
    r.mesh.material.opacity = (1 - k) ** 1.7;
    r.mesh.quaternion.copy(camera.quaternion);
    if (k >= 1) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
      parryRings.splice(i, 1);
    }
  }
}

function flowMultiplier() {
  return 1 + Math.min(0.5, Math.floor(state.chain / 4) * 0.1);
}

function addFlow(amount = 1) {
  state.chain += amount;
  state.chainTimer = FLOW_WINDOW;
  state.bestChain = Math.max(state.bestChain, state.chain);
  if (state.chain === 5 || state.chain === 10 || state.chain === 20) {
    showCombatCallout('FLOW', `CHAIN ${state.chain}`);
    audio.taiko(105 + state.chain * 2, 0.32);
  }
  updateHUD();
}

function breakFlow() {
  state.chain = 0;
  state.chainTimer = 0;
  updateHUD();
}

function updateFlow(dt) {
  if (state.chain <= 0) return;
  state.chainTimer -= dt;
  if (state.chainTimer <= 0) breakFlow();
}

// -------------------------------------------------------------------- waves

function waveComposition(n) {
  const list = [];
  const ronin = 2 + Math.floor(n * 0.8);
  const hunters = n >= 2 ? Math.floor(n * 0.7) : 0;
  const yari = n >= 3 ? 1 + Math.floor((n - 3) * 0.4) : 0;
  const brutes = n >= 4 ? Math.floor((n - 2) / 3) : 0;
  for (let i = 0; i < ronin; i++) list.push('ronin');
  for (let i = 0; i < hunters; i++) list.push('hunter');
  for (let i = 0; i < yari; i++) list.push('yari');
  for (let i = 0; i < brutes; i++) list.push('brute');
  if (n % 5 === 0) list.push('oni');
  return list;
}

function spawnEnemy(type, options = {}) {
  const spec = ENEMY_TYPES[type];
  const a = run.rng() * Math.PI * 2;
  const r = 13 + run.rng() * 6;
  const actor = makeEnemy(type);
  actor.baseHipY = actor.hips.position.y;
  actor.root.position.set(
    player.root.position.x + Math.cos(a) * r,
    0,
    player.root.position.z + Math.sin(a) * r,
  );
  scene.add(actor.root);

  // Only the steel and its aura take part in the timing telegraph. The hilt
  // stays dark, which keeps the signal narrow and easy to read.
  const bladeMats = [];
  let bladeGlow = null;
  actor.katana.traverse((o) => {
    if (o.userData.isBlade && o.material.isMeshToonMaterial) bladeMats.push(o.material);
    if (o.userData.isBladeGlow) bladeGlow = o;
  });
  const scale = 1 + state.wave * 0.06;
  enemies.push({
    type, spec, actor, bladeMats, bladeGlow,
    rival: Boolean(options.rival),
    rivalName: options.rivalName || '',
    rivalFollowup: false,
    hp: spec.hp * scale,
    maxHp: spec.hp * scale,
    state: 'approach',
    t: 0,
    phase: Math.random() * 10,
    speed: spec.speed,
    hasSlot: false,
    stagger: 0,
    cooldown: 1 + Math.random() * 1.5,
    circleDir: Math.random() < 0.5 ? 1 : -1,
    circleFor: 0.5 + Math.random() * 0.7,
    lunge: new THREE.Vector3(),
    dead: false,
  });
}

function startWave() {
  state.wave++;
  state.slots = Math.min(4, 2 + Math.floor(state.wave / 4));
  const rivalName = state.wave % 5 === 0 ? rivalNameForWave(state.wave) : '';
  if (rivalName) audio.silenceMusic(0.82, 0.002);
  const composition = waveComposition(state.wave);
  for (const type of composition) {
    spawnEnemy(type, { rival: type === 'oni', rivalName });
  }
  audio.taiko(state.wave % 5 === 0 ? 58 : 82, 0.55);
  showWaveTitle(state.wave);
  // The spearman gets a name the first time it walks on — a new silhouette is
  // worth a beat of attention.
  if (!state.seenYari && composition.includes('yari')) {
    state.seenYari = true;
    setTimeout(() => { if (state.running) showCombatCallout('槍', 'YARI · STRIKES FROM RANGE'); }, 1600);
  }
  updateHUD();
}

const waveTitleEl = document.getElementById('waveTitle');
function showWaveTitle(n) {
  const boss = n % 5 === 0;
  waveTitleEl.innerHTML = boss
    ? `<span class="kanji">鬼</span><span class="latin">${rivalNameForWave(n)}: THE IRON DEMON</span>`
    : `<span class="kanji">${numberKanji(n)}</span><span class="latin">WAVE ${n}</span>`;
  waveTitleEl.classList.remove('show');
  void waveTitleEl.offsetWidth; // restart the animation
  waveTitleEl.classList.add('show');
}

function rivalNameForWave(n) {
  const names = ['KUROGANE', 'AKATSUKI', 'SHIROGANE', 'MURASAME'];
  return names[(Math.floor(n / 5) - 1) % names.length];
}

function numberKanji(n) {
  const d = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return d[n];
  if (n < 20) return n === 10 ? '十' : `十${d[n % 10]}`;
  return `${d[Math.floor(n / 10)]}十${n % 10 ? d[n % 10] : ''}`;
}

const UPGRADE_DEFS = [
  {
    id: 'steelMind', mark: 'MIND', name: 'STEEL MIND',
    describe: (level) => `Perfect-parry timing gains ${level * 35} ms.`,
  },
  {
    id: 'bloodWind', mark: 'WIND', name: 'BLOOD WIND',
    describe: (level) => `Your dash cuts for ${16 + level * 12} damage.`,
  },
  {
    id: 'finalStroke', mark: 'EDGE', name: 'FINAL STROKE',
    describe: (level) => `The third cut deals ${level * 25}% more damage.`,
  },
  {
    id: 'stillWater', mark: 'CALM', name: 'STILL WATER',
    describe: (level) => `Taking a hit removes ${Math.max(0, 18 - level * 6)} focus.`,
  },
  {
    id: 'longShadow', mark: 'REACH', name: 'LONG SHADOW',
    describe: (level) => `Iai reaches ${level * 6} units farther and ${level * 0.6} wider.`,
  },
  {
    id: 'fallingLeaf', mark: 'RISE', name: 'FALLING LEAF',
    describe: () => 'Gain one escape from a fatal strike.',
  },
];

const upgradeOverlayEl = document.getElementById('upgradeOverlay');
const upgradeChoicesEl = document.getElementById('upgradeChoices');
let offeredUpgrades = [];

function chooseUpgradeSet() {
  const available = UPGRADE_DEFS.filter((u) => state.upgrades[u.id] < 3);
  const mastered = UPGRADE_DEFS.filter((u) => state.upgrades[u.id] >= 3);
  const shuffle = (items) => {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(run.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };
  return [...shuffle(available), ...shuffle(mastered)].slice(0, 3);
}

function showUpgradeChoice() {
  state.choosingUpgrade = true;
  input.enabled = false;
  offeredUpgrades = chooseUpgradeSet();
  upgradeChoicesEl.replaceChildren();

  offeredUpgrades.forEach((upgrade, index) => {
    const current = state.upgrades[upgrade.id];
    const next = Math.min(3, current + 1);
    const mastered = current >= 3;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scroll';
    button.innerHTML = `
      <span class="key">${index + 1}</span>
      <span class="sigil">${upgrade.mark}</span>
      <span class="name">${upgrade.name}</span>
      <span class="level">${mastered ? 'MASTERED' : current ? `RANK ${current} → ${next}` : 'NEW DISCIPLINE'}</span>
      <span class="desc">${mastered ? 'Restore 20 life and 20 focus.' : upgrade.describe(next)}</span>
    `;
    button.addEventListener('click', () => takeUpgrade(upgrade));
    upgradeChoicesEl.append(button);
  });

  upgradeOverlayEl.classList.remove('hidden');
  upgradeOverlayEl.setAttribute('aria-hidden', 'false');
  setTimeout(() => upgradeChoicesEl.querySelector('button')?.focus(), 50);
}

function takeUpgrade(upgrade) {
  if (!state.choosingUpgrade) return;
  if (state.upgrades[upgrade.id] >= 3) {
    state.hp = Math.min(PLAYER_MAX_HP, state.hp + 20);
    state.focus = Math.min(FOCUS_MAX, state.focus + 20);
  } else {
    state.upgrades[upgrade.id]++;
    if (upgrade.id === 'fallingLeaf') state.escapeCharges++;
  }
  state.choosingUpgrade = false;
  state.pendingUpgrade = false;
  state.waveBreak = 1.1;
  input.enabled = true;
  upgradeOverlayEl.classList.add('hidden');
  upgradeOverlayEl.setAttribute('aria-hidden', 'true');
  document.activeElement?.blur();
  showCombatCallout(upgrade.name, 'DISCIPLINE LEARNED');
  audio.taiko(92, 0.42);
  updateHUD();
}

addEventListener('keydown', (event) => {
  if (!state.choosingUpgrade) return;
  const index = Number(event.key) - 1;
  if (index >= 0 && index < offeredUpgrades.length) takeUpgrade(offeredUpgrades[index]);
});

function parryDuration() {
  return PARRY_ACTIVE + state.upgrades.steelMind * 0.035;
}

// ------------------------------------------------------------------- combat

function playerAttackHits() {
  const cfg = ATTACK[state.comboIndex];
  const px = player.root.position.x, pz = player.root.position.z;
  const fx = Math.sin(state.facing), fz = Math.cos(state.facing);
  let hitAny = false;

  // The direction a victim is thrown follows the *blade's travel*, not the
  // line from attacker to victim. Cut 1 sweeps right-to-left, cut 2 mirrors
  // it, and the overhead finisher drives straight through. Radial-only
  // knockback is what made hits feel like a shove instead of a cut.
  const mirror = state.comboIndex === 1 ? -1 : 1;
  const tangX = -fz * mirror, tangZ = fx * mirror;
  const overhead = state.comboIndex === 2 ? 1 : 0;

  for (const e of enemies) {
    if (e.dead || state.hitThisSwing.has(e)) continue;
    const dx = e.actor.root.position.x - px;
    const dz = e.actor.root.position.z - pz;
    const dist = Math.hypot(dx, dz);
    const reach = cfg.reach + e.spec.height * 0.4;
    if (dist > reach) continue;
    // Wide forward arc: generous enough for a crowd, not a 360.
    if ((dx * fx + dz * fz) / (dist || 1) < -0.15) continue;

    state.hitThisSwing.add(e);
    hitAny = true;
    let cx = (dx / (dist || 1)) * 0.35 + tangX * (1 - overhead) + fx * (0.3 + overhead);
    let cz = (dz / (dist || 1)) * 0.35 + tangZ * (1 - overhead) + fz * (0.3 + overhead);
    const cl = Math.hypot(cx, cz) || 1;
    const finisherScale = state.comboIndex === 2
      ? 1 + state.upgrades.finalStroke * 0.25
      : 1;
    damageEnemy(e, cfg.damage * finisherScale, cx / cl, cz / cl,
      state.comboIndex === 2 ? 'bisect' : 'limb');
  }

  if (hitAny) {
    const impactStop = [0.055, 0.075, 0.13][state.comboIndex];
    const impactShake = [0.30, 0.43, 0.78][state.comboIndex];
    hitstop(impactStop, state.comboIndex === 2 ? 0.04 : 0.06);
    shake(impactShake);
    // The camera bites forward along the cut — contact should be felt in the
    // frame, not just heard. The two arcs kick sideways in opposite directions;
    // the execution stroke drives straight through and down.
    camPunch.x += fx * (0.42 + overhead * 0.52) + tangX * (state.comboIndex === 2 ? 0 : 0.20);
    camPunch.z += fz * (0.42 + overhead * 0.52) + tangZ * (state.comboIndex === 2 ? 0 : 0.20);
    camPunch.y -= state.comboIndex === 2 ? 0.24 : 0.12;
    if (state.comboIndex === 2) {
      flash(0.18);
      ink.splashScreen(2, 0.34);
    }
    audio.hit(state.comboIndex);
  }
}

function damageEnemy(e, amount, dirX, dirZ, severity = 'limb') {
  e.hp -= amount;
  e.stagger = Math.max(e.stagger, 0.22);
  const p = e.actor.root.position;
  const h = 0.9 * e.spec.height;
  spawnImpactBurst(p, severity === 'bisect' ? 1.35 : 0.72);
  flash(severity === 'bisect' ? 0.28 : 0.09);

  if (e.hp <= 0) {
    if (enemies.filter((enemy) => !enemy.dead).length === 1) audio.silenceMusic(0.72);
    killEnemy(e, dirX, dirZ, severity);
    return;
  }

  // A wound throws ink in the direction of the cut.
  ink.spray(p.x, h, p.z, 9, { dirX, dirZ, force: 1.2, up: 0.6 });
  ink.flick(p.x, p.z, dirX, dirZ, 0.55);
  e.actor.root.position.x += dirX * 0.35;
  e.actor.root.position.z += dirZ * 0.35;
  if (e.hasSlot) { releaseSlot(e); }
  e.state = 'stagger';
  e.t = 0;
}

function killEnemy(e, dirX, dirZ, severity = 'limb') {
  e.dead = true;
  if (e.rival) severity = 'bisect';
  if (e.hasSlot) releaseSlot(e);
  const p = e.actor.root.position;
  const h = 1.0 * e.spec.height;
  const big = e.type === 'oni' || e.type === 'brute';

  ink.spray(p.x, h, p.z, big ? 26 : 14, { dirX, dirZ, force: big ? 1.8 : 1.3 });
  ink.flick(p.x, p.z, dirX, dirZ, big ? 1.4 : 0.9);
  ink.pool(p.x, p.z, big ? 1.1 : 0.55);
  ink.splashScreen(big ? 9 : 4, big ? 1.4 : 0.8);

  hitstop(big ? 0.22 : 0.14, 0.04);
  shake(big ? 1.2 : 0.7);
  flash(big ? 0.4 : 0.18);
  gibs.burst(p.x, h, p.z, severity === 'bisect' ? 26 : 13, dirX, dirZ, big ? 1.5 : 1.0);
  audio.kill();

  state.kills++;
  if (e.rival) {
    state.rivalKills++;
    state.focus = FOCUS_MAX;
    showCombatCallout(e.rivalName, 'RIVAL DEFEATED · FOCUS RESTORED');
    audio.taiko(48, 0.72);
  }
  addFlow();
  state.focus = Math.min(FOCUS_MAX, state.focus + (big ? 20 : 9) * flowMultiplier());

  // Hand the body to the physics: it keeps the pose it died in, and the blow
  // decides how much of it stays attached.
  vCut.set(dirX, 0, dirZ);
  ragdolls.spawn(e.actor, e.spec, vCut, severity);
  enemies = enemies.filter((x) => x !== e);
  updateHUD();
}

// How to name a death on the defeat scroll: who struck, and what the samurai
// was caught doing. A death the player can explain is a death they retry.
function deathCause(source, action) {
  const who = !source ? 'THE FIELD'
    : source.rival && source.rivalName ? source.rivalName
    : ({ ronin: 'A RONIN', hunter: 'A HUNTER', yari: 'A SPEARMAN', brute: 'A BRUTE', oni: 'THE IRON DEMON' })[source.type] || 'A STRAY BLADE';
  const how = ({
    attack: 'CAUGHT MID-SWING',
    dash: 'CAUGHT MID-DASH',
    parry: 'A BREATH TOO SLOW ON THE PARRY',
    iai: 'CAUGHT MID-DRAW',
  })[action] || 'CAUGHT FLAT-FOOTED';
  return `CUT DOWN BY ${who} · ${how}`;
}

function damagePlayer(amount, source = null) {
  if (state.invuln > 0 || state.over) return;
  const actionAtHit = state.action;
  if (amount >= state.hp && state.escapeCharges > 0) {
    state.escapeCharges--;
    state.hp = 1;
    state.invuln = 1.4;
    breakFlow();
    flash(1);
    ink.splashScreen(12, 1.5);
    hitstop(0.22, 0.035);
    shake(1.1);
    showCombatCallout('FALLING LEAF', 'DEATH ESCAPED');
    audio.perfectParry();
    updateHUD();
    return;
  }
  // Last stand: once per run, the blow that would end it is survived instead in
  // a long beat of slow motion. A sudden death becomes a near-miss the player
  // fights on from — the moment that turns a loss into "one more round".
  if (amount >= state.hp && !state.lastStandUsed) {
    state.lastStandUsed = true;
    state.hp = 1;
    state.invuln = 1.5;
    breakFlow();
    hitstop(1.15, 0.3);
    flash(1);
    ink.splashScreen(14, 1.7);
    shake(1.0);
    audio.silenceMusic(1.2, 0.001);
    showCombatCallout('一命', 'LAST STAND');
    audio.perfectParry();
    updateHUD();
    return;
  }
  state.hp -= amount;
  state.invuln = 0.55;
  state.focus = Math.max(0, state.focus - Math.max(0, 18 - state.upgrades.stillWater * 6));
  breakFlow();
  const p = player.root.position;
  ink.spray(p.x, 1.2, p.z, 10, { force: 1.0 });
  ink.pool(p.x, p.z, 0.35);
  ink.splashScreen(7, 1.1);
  shake(0.9);
  hitstop(0.08, 0.1);
  audio.hurt();
  state.action = 'hurt';
  state.actionT = 0.26;
  updateHUD();
  if (state.hp <= 0) {
    state.deathBy = deathCause(source, actionAtHit);
    state.deathInfo = {
      type: source ? source.type : '',
      rival: (source && source.rival && source.rivalName) || '',
      action: actionAtHit,
    };
    gameOver();
  }
}

// Attack slots keep the fight legible: only a couple of enemies may commit at
// once, and the rest circle. Without this a crowd becomes a coin flip.
function requestSlot(e) {
  if (e.hasSlot) return true;
  const used = enemies.reduce((n, x) => n + (x.hasSlot ? 1 : 0), 0);
  if (used >= state.slots) return false;
  e.hasSlot = true;
  return true;
}
function releaseSlot(e) { e.hasSlot = false; }

function playerDashHits() {
  const level = state.upgrades.bloodWind;
  if (level <= 0) return;
  const p = player.root.position;
  const dir = state.dashDir;
  for (const e of [...enemies]) {
    if (e.dead || state.dashHit.has(e)) continue;
    const ep = e.actor.root.position;
    const radius = 0.9 + e.spec.height * 0.45;
    const dx = ep.x - p.x, dz = ep.z - p.z;
    if (dx * dx + dz * dz > radius * radius) continue;
    state.dashHit.add(e);
    damageEnemy(e, 16 + level * 12, dir.x, dir.z, 'limb');
    ink.flick(ep.x, ep.z, dir.x, dir.z, 0.45);
    hitstop(0.035, 0.18);
    shake(0.22);
    audio.hit();
  }
}

function rewardDashRead() {
  let read = false;
  for (const e of enemies) {
    if (e.dead || e.state !== 'strike' || e.resolved) continue;
    const dx = e.actor.root.position.x - player.root.position.x;
    const dz = e.actor.root.position.z - player.root.position.z;
    const reach = e.spec.reach * e.spec.height * 1.45;
    if (dx * dx + dz * dz <= reach * reach) {
      read = true;
      e.resolved = true;
    }
  }
  if (!read) return;
  state.chainTimer = Math.max(state.chainTimer, FLOW_WINDOW);
  state.focus = Math.min(FOCUS_MAX, state.focus + 10 * flowMultiplier());
  showCombatCallout('EVADE', 'ATTACK READ · FLOW HELD');
  audio.parry();
  updateHUD();
}

// ---------------------------------------------------------------------- iai

let iaiT = 0;
const iaiTrail = new SlashTrail(scene, { radius: 5.2, width: 2.7, sweep: 1.2 });
const iaiOrigin = new THREE.Vector3();
const iaiEnd = new THREE.Vector3();
let iaiFacing = 0;
let iaiCutFired = false;

function fireIaiCut() {
  iaiCutFired = true;
  const fx = Math.sin(iaiFacing), fz = Math.cos(iaiFacing);
  const reach = 30 + state.upgrades.longShadow * 6;
  const width = 4.2 + state.upgrades.longShadow * 0.6;

  for (const e of [...enemies]) {
    const dx = e.actor.root.position.x - iaiOrigin.x;
    const dz = e.actor.root.position.z - iaiOrigin.z;
    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * fz - dz * fx);
    if (along > -1 && along < reach && across < width) {
      damageEnemy(e, 9999, fx, fz, 'bisect');
    }
  }

  vTmp.lerpVectors(iaiOrigin, iaiEnd, 0.45); vTmp.y = 0.2;
  iaiTrail.fire(vTmp, iaiFacing, { duration: 0.56, scale: 1.2, style: 2 });
  ink.splashScreen(14, 1.8);
  flash(1);
  hitstop(0.14, 0.08);
  shake(1.1);
  audio.iai();
}

function tryIai() {
  if (!state.running || iaiT > 0) return;
  if (state.focus < FOCUS_MAX) {
    showIaiNotice('IAI NOT READY', 'CHARGE: KILLS + PERFECT PARRIES', 1500);
    return;
  }
  state.focus = 0;
  audio.silenceMusic(0.62, 0.001);
  iaiT = 0.62;
  state.invuln = Math.max(state.invuln, 0.85);
  state.action = 'iai';
  state.actionT = 0;
  iaiFacing = state.facing;
  iaiCutFired = false;
  iaiOrigin.copy(player.root.position);
  const dist = Math.min(9, 4 + enemies.length * 0.3);
  iaiEnd.copy(iaiOrigin);
  iaiEnd.x += Math.sin(iaiFacing) * dist;
  iaiEnd.z += Math.cos(iaiFacing) * dist;
  updateHUD();
}

// ------------------------------------------------------------- player update

function updatePlayer(dt) {
  if (state.action !== 'iai') state.facing = aimYaw();

  if (state.dashCooldown > 0) state.dashCooldown -= dt;
  if (state.parryCooldown > 0) state.parryCooldown -= dt;
  if (state.invuln > 0) state.invuln -= dt;
  if (state.comboTimer > 0) state.comboTimer -= dt;
  else state.comboIndex = 0;

  const moving = input.moveVector(vMove);
  // Rotate raw WASD into the isometric frame: W is up-screen, which under a
  // 45-degree camera is the world diagonal, not the world -Z axis.
  if (moving) {
    const mx = vMove.x, mz = vMove.z;
    const s = Math.sin(ISO_AZIMUTH), c = Math.cos(ISO_AZIMUTH);
    vMove.x = mx * c + mz * s;
    vMove.z = mz * c - mx * s;
  }

  // ---- action transitions
  if (state.action === 'idle') {
    if (input.take('focus')) tryIai();
    else if (input.take('parry') && state.parryCooldown <= 0) {
      state.action = 'parry';
      state.actionT = 0;
      state.parryCooldown = PARRY_COOLDOWN + PARRY_STARTUP + parryDuration() + PARRY_RECOVER;
    } else if (input.take('dash') && state.dashCooldown <= 0) {
      state.action = 'dash';
      state.actionT = 0;
      state.dashCooldown = DASH_TIME + DASH_COOLDOWN;
      state.dashDir.copy(moving ? vMove : vTmp.set(Math.sin(state.facing), 0, Math.cos(state.facing)));
      state.dashHit.clear();
      rewardDashRead();
      audio.dash();
    } else if (input.take('attack')) {
      beginAttack();
    }
  } else if (state.action === 'attack' && state.attackPhase === 'recover') {
    // Chaining is allowed late in the recovery, which is what makes the combo
    // feel like a sequence rather than three separate swings.
    if (input.take('attack') && state.comboIndex < ATTACK.length - 1) {
      state.comboIndex++;
      beginAttack(true);
    } else if (input.take('dash') && state.dashCooldown <= 0) {
      state.action = 'dash';
      state.actionT = 0;
      state.dashCooldown = DASH_TIME + DASH_COOLDOWN;
      state.dashDir.copy(moving ? vMove : vTmp.set(Math.sin(state.facing), 0, Math.cos(state.facing)));
      state.dashHit.clear();
      rewardDashRead();
      audio.dash();
    }
  }

  // ---- movement
  let speed = 0;
  if (state.action === 'dash') {
    state.actionT += dt;
    state.invuln = Math.max(state.invuln, 0.02);
    const k = 1 - state.actionT / DASH_TIME;
    const s = DASH_SPEED * Math.max(0.25, k * k);
    player.root.position.x += state.dashDir.x * s * dt;
    player.root.position.z += state.dashDir.z * s * dt;
    playerDashHits();
    // A dash drags ink off the blade across the paper.
    if (Math.random() < 0.6) {
      ink.addStain(
        player.root.position.x + (Math.random() - 0.5) * 0.8,
        player.root.position.z + (Math.random() - 0.5) * 0.8,
        0.18 + Math.random() * 0.25,
        { alpha: 0.28 },
      );
    }
    if (state.actionT >= DASH_TIME) { state.action = 'idle'; state.actionT = 0; }
  } else if (state.action === 'attack') {
    updateAttack(dt);
    speed = PLAYER_SPEED * 0.22;
    // Root motion: the body drives the cut. A small settle backward during the
    // coil, then a hard step through the active frames — the swing carries the
    // samurai forward instead of the sword waving from a planted figure.
    if (state.action === 'attack') {   // updateAttack may have ended the swing
      const cfg = ATTACK[state.comboIndex];
      const t = state.actionT, wu = cfg.windup, act = cfg.active;
      let drive = 0;
      if (t < wu) {
        drive = -1.3 * (t / wu);
      } else if (t < wu + act) {
        const w = (t - wu) / act;
        drive = (state.comboIndex === 2 ? 15 : 10.5) * Math.pow(1 - w, 1.4);
      }
      player.root.position.x += Math.sin(state.facing) * drive * dt;
      player.root.position.z += Math.cos(state.facing) * drive * dt;
    }
  } else if (state.action === 'parry') {
    state.actionT += dt;
    speed = PLAYER_SPEED * 0.15;
    if (state.actionT >= PARRY_STARTUP + parryDuration() + PARRY_RECOVER) {
      state.action = 'idle'; state.actionT = 0;
    }
  } else if (state.action === 'iai') {
    state.actionT += dt;
    state.invuln = Math.max(state.invuln, 0.08);
    if (!iaiCutFired && state.actionT >= 0.10) fireIaiCut();
    const moveT = THREE.MathUtils.clamp((state.actionT - 0.10) / 0.16, 0, 1);
    const moveEase = moveT * moveT * (3 - 2 * moveT);
    player.root.position.lerpVectors(iaiOrigin, iaiEnd, moveEase);
    if (state.actionT >= 0.54) {
      player.root.position.copy(iaiEnd);
      state.action = 'idle';
      state.actionT = 0;
    }
  } else if (state.action === 'hurt') {
    state.actionT -= dt;
    speed = PLAYER_SPEED * 0.3;
    if (state.actionT <= 0) { state.action = 'idle'; }
  } else {
    speed = PLAYER_SPEED;
  }

  if (moving && speed > 0) {
    player.root.position.x += vMove.x * speed * dt;
    player.root.position.z += vMove.z * speed * dt;
  }

  player.root.rotation.y = state.facing;

  // ---- pose
  const blend = moving && speed > PLAYER_SPEED * 0.5 ? 1 : 0;
  const prevPhase = state.phase;
  state.phase += dt * (blend ? 11 : 2.2);
  // A footfall lands each time the gait swings through half a cycle. Tying it
  // to the same phase that drives the legs keeps sound and animation in step.
  if (blend && Math.floor(state.phase / Math.PI) !== Math.floor(prevPhase / Math.PI)) {
    audio.step();
  }
  animateLocomotion(player, state.phase, blend, state.time);
  poseArms(dt);
}

function beginAttack(chain = false) {
  if (!chain) state.comboIndex = 0;
  state.action = 'attack';
  state.actionT = 0;
  state.attackPhase = 'windup';
  state.hitThisSwing = new Set();
  state.comboTimer = COMBO_WINDOW;
  audio.swing(state.comboIndex);
}

function updateAttack(dt) {
  const cfg = ATTACK[state.comboIndex];
  state.actionT += dt;
  const wu = cfg.windup, act = wu + cfg.active, rec = act + cfg.recover;

  if (state.actionT < wu) {
    state.attackPhase = 'windup';
  } else if (state.actionT < act) {
    if (state.attackPhase !== 'active') {
      state.attackPhase = 'active';
      // The trail belongs to the cut itself. Firing it at wind-up start (as
      // before) painted the stroke while the sword was still drawn back.
      vTmp.copy(player.root.position); vTmp.y = 0.1;
      trail.fire(vTmp, state.facing, {
        mirror: state.comboIndex === 1,
        duration: cfg.active + cfg.recover * 0.8,
        scale: state.comboIndex === 2 ? 1.28 : 1,
        style: state.comboIndex,
      });
    }
    playerAttackHits();
  } else if (state.actionT < rec) {
    state.attackPhase = 'recover';
  } else {
    state.action = 'idle';
    state.attackPhase = '';
    state.actionT = 0;
    state.comboTimer = COMBO_WINDOW;
  }
}

function poseArms(dt) {
  const a = player;
  let armX = 0, armZ = 0, torsoY = 0, torsoZ = 0;
  let katanaRoll = 0;
  let crouch = 0;
  let smear = 0;         // 0..1, peak of the release — stretches the blade
  let twoHanded = false; // left hand joins the tsuka for the swing
  // Attack poses are written directly, not smoothed: a full swing lasts a
  // dozen frames, and the exponential lerp below never got the arm more than
  // partway to its keys before the swing was over — which is why the katana
  // hardly appeared to move.
  let snap = false;

  if (state.action === 'attack') {
    const cfg = ATTACK[state.comboIndex];
    const mirror = state.comboIndex === 1 ? -1 : 1;
    const wu = cfg.windup, act = cfg.active;
    const t = state.actionT;
    snap = true;

    // Torso and arm swing the SAME direction throughout — the torso leads and
    // the arm follows. With opposite signs they cancel and the blade tip
    // barely translates, which is exactly the "katana isn't swinging" bug.
    if (t < wu) {
      // Coil: torso twists toward the sword side, blade cocked past the ear.
      const w = t / wu;
      const e = 1 - Math.pow(1 - w, 2);              // ease-out into the cock
      armX = -0.35 - 2.15 * e;
      armZ = (0.28 + 0.62 * e) * mirror;
      torsoY = 0.7 * e * mirror;
      katanaRoll = -0.6 * e * mirror;
    } else if (t < wu + act) {
      // Release: everything unwinds across the body in a few frames, and the
      // blade rolls so the edge leads the arc.
      const w = (t - wu) / act;
      const e = Math.pow(w, 0.4);                     // violent start, soft end
      armX = -2.5 + 3.6 * e;                          // overhead -> past the hip
      armZ = (0.9 - 2.1 * e) * mirror;                // sweeps across the body
      torsoY = (0.7 - 1.8 * e) * mirror;
      torsoZ = Math.sin(e * Math.PI) * 0.3;
      katanaRoll = (-0.6 + 1.5 * e) * mirror;
      // Smear peaks early in the release, when the blade is fastest.
      smear = Math.sin(Math.min(1, w * 1.6) * Math.PI);
    } else {
      // Follow-through: hold the finish, then ease back toward guard.
      const w = (t - wu - act) / cfg.recover;
      const e = w * w;
      armX = 1.1 - 1.45 * e;
      armZ = (-1.2 + 1.48 * e) * mirror;
      torsoY = (-1.1 + 1.1 * e) * mirror;
      katanaRoll = (0.9 - 0.9 * e) * mirror;
    }
  } else if (state.action === 'parry') {
    // Blade up, held across the body.
    const k = THREE.MathUtils.clamp(state.actionT / (PARRY_STARTUP + parryDuration()), 0, 1);
    armX = -2.5 * Math.min(1, k * 4);
    armZ = 0.9;
    torsoY = 0.35;
  } else if (state.action === 'iai') {
    const t = state.actionT;
    snap = true;
    if (t < 0.10) {
      const k = t / 0.10;
      armX = -0.15 + k * 0.75;
      armZ = 0.25 + k * 0.9;
      torsoY = -0.65 * k;
      torsoZ = 0.16 * k;
      katanaRoll = -0.5 * k;
      crouch = 0.12 * k;
    } else if (t < 0.26) {
      const k = (t - 0.10) / 0.16;
      const e = 1 - (1 - k) ** 3;
      armX = 0.6 - e * 1.7;
      armZ = 1.15 - e * 2.35;
      torsoY = -0.65 + e * 1.7;
      torsoZ = 0.16 - e * 0.3;
      katanaRoll = -0.5 + e * 1.5;
      crouch = 0.12 - e * 0.06;
      smear = Math.sin(k * Math.PI) * 0.72;
    } else {
      const k = THREE.MathUtils.clamp((t - 0.26) / 0.28, 0, 1);
      armX = -1.1 + k * 0.72;
      armZ = -1.2 + k * 1.45;
      torsoY = 1.05 - k * 0.92;
      torsoZ = -0.14 + k * 0.14;
      katanaRoll = 1 - k * 0.88;
      crouch = 0.06 * (1 - k);
    }
  } else if (state.action === 'dash') {
    armX = -0.4;
    torsoZ = 0.2;
  } else {
    // Idle guard: blade low and slightly out, breathing.
    armX = -0.35 + Math.sin(state.time * 1.9) * 0.05;
    armZ = 0.28;
  }

  if (state.action === 'attack') twoHanded = true;

  // Smoothing is for transitions between held stances; the swing itself must
  // hit its keyframes exactly on time.
  const lerp = snap ? 1 : 1 - Math.exp(-26 * dt);
  a.armR.rotation.x += (armX - a.armR.rotation.x) * lerp;
  a.armR.rotation.z += (armZ - a.armR.rotation.z) * lerp;
  a.hips.rotation.y += (torsoY - a.hips.rotation.y) * lerp;
  a.torso.rotation.z += (torsoZ - a.torso.rotation.z) * lerp;
  a.katana.rotation.z += (katanaRoll - a.katana.rotation.z) * lerp;
  a.hips.position.y -= crouch;

  // Off hand: on the tsuka during a swing — both arms driving the same arc is
  // most of what makes a cut look committed — trailing loose otherwise.
  const lArmX = twoHanded ? armX : armX * 0.45;
  const lArmZ = twoHanded ? -armZ * 0.72 : 0;
  a.armL.rotation.x += (lArmX - a.armL.rotation.x) * lerp;
  a.armL.rotation.z += (lArmZ - a.armL.rotation.z) * lerp;

  // Smear: the blade stretches along its length at peak speed and thins edge-on,
  // a hand-drawn motion streak rather than a rigid prop photographed mid-arc.
  const stretch = 1 + smear * 0.85;
  a.katana.scale.set(1 / (1 + smear * 0.25), stretch, 1 / (1 + smear * 0.25));
}

const parryActive = () => state.action === 'parry'
  && state.actionT >= PARRY_STARTUP
  && state.actionT < PARRY_STARTUP + parryDuration();

const ENEMY_STRIKE_TIME = 0.10;

function updateEnemyBladeTelegraph(e) {
  let strength = 0;
  let ready = false;

  if (e.state === 'windup') {
    const progress = THREE.MathUtils.clamp(e.t / e.spec.windup, 0, 1);
    const eta = e.spec.windup - e.t + ENEMY_STRIKE_TIME;
    ready = eta >= PARRY_STARTUP && eta < PARRY_STARTUP + parryDuration();
    strength = 0.06 + progress ** 1.7 * 0.38;
  } else if (e.state === 'strike' && !e.resolved) {
    const eta = ENEMY_STRIKE_TIME - e.t;
    ready = eta >= PARRY_STARTUP && eta < PARRY_STARTUP + parryDuration();
    strength = 0.3;
  }

  const pulse = ready ? 0.88 + Math.sin(state.time * 30) * 0.12 : 1;
  if (ready) strength = 1;
  for (const material of e.bladeMats) {
    material.emissive.setScalar(strength * pulse);
    material.emissiveIntensity = ready ? 2.8 : 0.9;
  }
  if (e.bladeGlow) {
    e.bladeGlow.material.opacity = ready
      ? 0.48 + Math.sin(state.time * 30) * 0.1
      : strength * 0.08;
    e.bladeGlow.scale.setScalar(ready ? 1.14 + Math.sin(state.time * 30) * 0.025 : 1.08);
  }
}

// -------------------------------------------------------------- enemy update

function updateEnemies(dt) {
  const p = player.root.position;

  for (const e of enemies) {
    const pos = e.actor.root.position;

    // The land is endless, so a sprinting player can leave pursuers arbitrarily
    // far behind — and a wave that can never catch up stalls the game. Anyone
    // dropped too far re-emerges from the fog ahead instead.
    {
      const lx = p.x - pos.x, lz = p.z - pos.z;
      if (lx * lx + lz * lz > 45 * 45) {
        const a = Math.atan2(lx, lz) + (Math.random() - 0.5) * 1.2;
        pos.x = p.x + Math.sin(a) * 26;
        pos.z = p.z + Math.cos(a) * 26;
        e.state = 'approach';
        e.t = 0;
      }
    }

    const dx = p.x - pos.x, dz = p.z - pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist, nz = dz / dist;
    const reach = e.spec.reach * e.spec.height;

    e.t += dt;
    if (e.cooldown > 0) e.cooldown -= dt;

    let move = 0, turn = true;

    // The orbit distance must sit *inside* the range at which an attack may be
    // committed, otherwise circling enemies can never satisfy the strike test
    // and the fight deadlocks with everyone walking in circles.
    const orbitRange = reach * 1.0;
    const strikeRange = reach * 1.25;

    switch (e.state) {
      case 'approach': {
        move = e.speed;
        if (dist < strikeRange && e.cooldown <= 0 && requestSlot(e)) {
          e.state = 'windup'; e.t = 0;
        } else if (dist < reach * 1.6) {
          e.state = 'circle'; e.t = 0;
        }
        break;
      }
      case 'circle': {
        // Orbit just inside reach, waiting for an attack slot to free up.
        const radial = (dist - orbitRange) * 1.4;
        vTmp.set(nx * radial, 0, nz * radial);
        vTmp.x += -nz * e.circleDir * e.speed * 0.75;
        vTmp.z += nx * e.circleDir * e.speed * 0.75;
        const len = vTmp.length() || 1;
        vTmp.multiplyScalar(Math.min(e.speed, len) / len);
        pos.x += vTmp.x * dt;
        pos.z += vTmp.z * dt;
        e.phase += dt * 7;
        if (e.t > e.circleFor) {
          e.t = 0;
          e.circleFor = 0.5 + Math.random() * 0.7;
          if (dist < strikeRange && e.cooldown <= 0 && requestSlot(e)) {
            e.state = 'windup';
          } else if (dist > reach * 2.2) {
            e.state = 'approach';
          } else if (Math.random() < 0.3) {
            e.circleDir *= -1;
          }
        }
        break;
      }
      case 'windup': {
        // Telegraph. Blade lit, edging forward, then committing.
        move = e.speed * 0.25;
        if (e.t >= e.spec.windup) {
          e.state = 'strike';
          e.t = 0;
          e.lunge.set(nx, 0, nz);
          vTmp.copy(pos); vTmp.y = 0.1;
          spawnImpactBurst(pos, e.rival ? 1.25 : 0.62);
          flash(e.rival ? 0.18 : 0.06);
          enemyTrail.fire(vTmp, Math.atan2(nx, nz), { duration: 0.3, scale: e.spec.height });
          audio.swing();
        }
        break;
      }
      case 'strike': {
        // Lunge with the cut.
        const k = Math.min(1, e.t / 0.16);
        const s = 9 * e.spec.height * (1 - k) ** 1.5;
        pos.x += e.lunge.x * s * dt;
        pos.z += e.lunge.z * s * dt;
        turn = false;
        if (!e.resolved && e.t >= 0.10) {
          e.resolved = true;
          resolveEnemyStrike(e, dist, nx, nz, reach);
        }
        if (e.t >= 0.34) {
          e.resolved = false;
          e.state = 'recover';
          e.t = 0;
        }
        break;
      }
      case 'recover': {
        turn = false;
        if (e.t >= 0.42) {
          if (e.rival && !e.rivalFollowup && dist < reach * 1.8) {
            e.rivalFollowup = true;
            e.state = 'windup';
            e.t = Math.max(0, e.spec.windup - 0.24);
            e.circleDir *= -1;
          } else {
            e.rivalFollowup = false;
            releaseSlot(e);
            e.cooldown = e.rival ? 0.55 : 0.8 + Math.random() * 1.6;
            e.state = dist > reach * 1.6 ? 'approach' : 'circle';
            e.t = 0;
          }
        }
        break;
      }
      case 'stagger': {
        if (e.t >= 0.3) { e.state = 'circle'; e.t = 0; e.cooldown = Math.max(e.cooldown, 0.4); }
        break;
      }
    }

    updateEnemyBladeTelegraph(e);

    if (move > 0) {
      pos.x += nx * move * dt;
      pos.z += nz * move * dt;
      e.phase += dt * 9 * (move / e.spec.speed);
    }

    if (turn) {
      const want = Math.atan2(nx, nz);
      let diff = want - e.actor.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      e.actor.root.rotation.y += diff * Math.min(1, dt * 7);
    }

    poseEnemy(e, dt);
  }

  separate(dt);

}

function resolveEnemyStrike(e, dist, nx, nz, reach) {
  if (dist > reach * 1.35) return;

  if (parryActive()) {
    // A perfect read is the defensive game's peak reward. Every layer lands
    // on the same frame: enemy recoil, blade ring, silence-to-steel audio,
    // focus, time stop, camera punch, and the calligraphic confirmation.
    e.state = 'stagger';
    e.t = 0;
    e.stagger = 1.0;
    e.cooldown = 1.4;
    releaseSlot(e);
    addFlow();
    state.perfectParries++;
    state.focus = Math.min(FOCUS_MAX, state.focus + 34 * flowMultiplier());
    const pos = e.actor.root.position;
    ink.spray(pos.x, 1.4 * e.spec.height, pos.z, 6, { dirX: -nx, dirZ: -nz, force: 0.7 });
    e.actor.root.position.x -= nx * 1.8;
    e.actor.root.position.z -= nz * 1.8;
    vTmp.set((pos.x + player.root.position.x) * 0.5, 1.25, (pos.z + player.root.position.z) * 0.5);
    spawnParryRing(vTmp);
    spawnImpactBurst(player.root.position, e.rival ? 1.8 : 1.35);
    camPunch.x -= nx * 0.75;
    camPunch.z -= nz * 0.75;
    camPunch.y += 0.12;
    hitstop(0.19, 0.035);
    shake(0.78);
    flash(1);
    ink.splashScreen(3, 0.55);
    showCombatCallout('PERFECT', 'PARRY');
    audio.perfectParry();
    updateHUD();
    return;
  }

  if (state.invuln > 0) return;
  damagePlayer(e.spec.damage, e);
}

// Push overlapping enemies apart so a crowd stays legible instead of merging
// into one blob.
function separate(dt) {
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i].actor.root.position;
    const ra = 0.55 * enemies[i].spec.height;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j].actor.root.position;
      const rb = 0.55 * enemies[j].spec.height;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const min = ra + rb;
      if (d2 > min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      const ux = dx / d, uz = dz / d;
      a.x -= ux * push; a.z -= uz * push;
      b.x += ux * push; b.z += uz * push;
    }
  }
}

function poseEnemy(e, dt) {
  const a = e.actor;
  const walking = e.state === 'approach' || e.state === 'circle';
  animateLocomotion(a, e.phase, walking ? 1 : 0, state.time);

  let armX = -0.3, torsoY = 0;
  if (e.state === 'windup') {
    const k = Math.min(1, e.t / e.spec.windup);
    armX = -0.3 - 2.3 * k;
    torsoY = -0.5 * k;
    a.hips.position.y = a.baseHipY - 0.06 * k;
  } else if (e.state === 'strike') {
    const k = Math.min(1, e.t / 0.2);
    armX = -2.6 + 3.6 * Math.pow(k, 0.4);
    torsoY = -0.5 + 0.9 * Math.pow(k, 0.5);
  } else if (e.state === 'stagger') {
    armX = 0.5;
    torsoY = Math.sin(e.t * 30) * 0.2;
  }

  const lerp = 1 - Math.exp(-22 * dt);
  a.armR.rotation.x += (armX - a.armR.rotation.x) * lerp;
  a.armL.rotation.x += (armX * 0.4 - a.armL.rotation.x) * lerp;
  a.hips.rotation.y += (torsoY - a.hips.rotation.y) * lerp;
}

// ------------------------------------------------------------------- camera

function updateCamera(dt) {
  const p = player.root.position;
  aimPoint(vAim);
  // Bias the frame toward where the player is looking, but only a little —
  // the camera should feel locked off, like a tripod, not chase the cursor.
  vTmp2.set(vAim.x - p.x, 0, vAim.z - p.z);
  const l = vTmp2.length();
  if (l > 0.001) vTmp2.multiplyScalar(Math.min(l, 7) / l * 0.28);

  camTarget.set(p.x + vTmp2.x, 1.2, p.z + vTmp2.z);

  // Crowded fights zoom out instead of pulling back — with an orthographic
  // camera, distance changes nothing; only the frustum (via zoom) does.
  const pressure = Math.min(1, enemies.length / 12);
  const wantZoom = 1 / (1 + pressure * 0.28);
  camera.zoom += (wantZoom - camera.zoom) * (1 - Math.exp(-3 * dt));
  camera.updateProjectionMatrix();

  vTmp.copy(camTarget).add(ISO_OFFSET);
  camera.position.lerp(vTmp, 1 - Math.exp(-5 * dt));

  shakeAmount *= Math.exp(-6 * dt);
  camShake.set(
    (Math.random() - 0.5) * shakeAmount,
    (Math.random() - 0.5) * shakeAmount,
    (Math.random() - 0.5) * shakeAmount * 0.5,
  );
  camera.position.add(camShake);
  // Contact punch: a directed kick into the cut, unlike the undirected shake.
  // Decays on real time so hitstop doesn't freeze it mid-lurch.
  camPunch.multiplyScalar(Math.exp(-9 * dt));
  camera.position.add(camPunch);
  camera.lookAt(camTarget.x, camTarget.y, camTarget.z);

  // Keep the shadow frustum on the action. The light hangs off the camera's
  // LEFT shoulder: lit from behind the camera, every shadow falls directly
  // behind its caster and the frame goes flat — from the side, shadows rake
  // visibly across the paper.
  key.position.set(p.x - 24, 38, p.z + 24);
  key.target.position.set(p.x, 0, p.z);
  key.target.updateMatrixWorld();
}

// ----------------------------------------------------------------------- UI

const hpFillEl = document.getElementById('hpFill');
const hpGaugeEl = document.getElementById('hpGauge');
const iaiFillEl = document.getElementById('iaiFill');
const iaiGaugeEl = document.getElementById('iaiGauge');
const statsEl = document.getElementById('stats');
const flowEl = document.getElementById('flow');
const vitalsEl = document.getElementById('vitals');
const iaiReadyNoticeEl = document.getElementById('iaiReadyNotice');
const iaiNoticeTitleEl = document.getElementById('iaiNoticeTitle');
const iaiNoticeDetailEl = document.getElementById('iaiNoticeDetail');
let iaiWasReady = false;
let iaiNoticeTimer = 0;

function showIaiNotice(title, detail, duration = 1800) {
  clearTimeout(iaiNoticeTimer);
  iaiNoticeTitleEl.textContent = title;
  iaiNoticeDetailEl.textContent = detail;
  iaiReadyNoticeEl.classList.add('show');
  iaiNoticeTimer = setTimeout(() => iaiReadyNoticeEl.classList.remove('show'), duration);
}

function updateHUD() {
  vitalsEl.classList.toggle('active', state.running && !state.over);
  const hpPercent = THREE.MathUtils.clamp(state.hp / PLAYER_MAX_HP, 0, 1);
  hpFillEl.style.transform = `scaleX(${hpPercent})`;
  hpGaugeEl.setAttribute('aria-valuenow', `${Math.round(hpPercent * 100)}`);
  hpGaugeEl.classList.toggle('urgent', hpPercent <= 0.35);
  const focusPercent = THREE.MathUtils.clamp(state.focus / FOCUS_MAX, 0, 1);
  iaiFillEl.style.transform = `scaleX(${focusPercent})`;
  iaiGaugeEl.setAttribute('aria-valuenow', `${Math.round(focusPercent * 100)}`);
  const iaiReady = state.running && !state.over && state.focus >= FOCUS_MAX;
  iaiGaugeEl.classList.toggle('ready', iaiReady);
  if (iaiReady && !iaiWasReady) {
    showIaiNotice('IAI READY', 'PRESS F');
  } else if (!iaiReady && iaiWasReady) {
    clearTimeout(iaiNoticeTimer);
    iaiReadyNoticeEl.classList.remove('show');
  }
  iaiWasReady = iaiReady;
  statsEl.textContent = `KILLS ${state.kills} · WAVE ${state.wave}${state.escapeCharges ? ` · ESCAPE ${state.escapeCharges}` : ''}`;
  flowEl.classList.toggle('active', state.chain > 1);
  flowEl.querySelector('strong').textContent = `FLOW ×${state.chain}`;
  flowEl.querySelector('small').textContent = `FLOW · FOCUS ×${flowMultiplier().toFixed(1)}`;
}

const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('ovTitle');
const ovSub = document.getElementById('ovSub');
const ovText = document.getElementById('ovText');
const ovBtn = document.getElementById('ovBtn');
const ovCause = document.getElementById('ovCause');
const ovPoem = document.getElementById('ovPoem');
const ovPoemText = document.getElementById('ovPoemText');
const ovSeal = document.getElementById('ovSeal');
const ovChase = document.getElementById('ovChase');
const ovDaily = document.getElementById('ovDaily');
const ovShare = document.getElementById('ovShare');
const ledgerEl = document.getElementById('ledger');
const TITLE_LOGO = ovTitle.innerHTML;

function loadRecords() {
  try {
    return { wave: 0, kills: 0, parries: 0, flow: 0, ...JSON.parse(localStorage.getItem('samurai-records') || '{}') };
  } catch {
    return { wave: 0, kills: 0, parries: 0, flow: 0 };
  }
}

function saveRecords(records) {
  try { localStorage.setItem('samurai-records', JSON.stringify(records)); } catch { /* Private storage can fail. */ }
}

// The page's memory across runs: one entry per death, most recent last.
function loadLedger() {
  try { return JSON.parse(localStorage.getItem('samurai-ledger') || '[]'); } catch { return []; }
}
function pushLedger(entry) {
  const list = loadLedger();
  list.push(entry);
  // Keep only what the strip can meaningfully show.
  const trimmed = list.slice(-48);
  try { localStorage.setItem('samurai-ledger', JSON.stringify(trimmed)); } catch { /* ignore */ }
  return trimmed;
}

// Render past runs as dried ink strokes — height scaled to how far each run
// reached, the best run darkest, the most recent one picked out. Every run
// literally adds a mark, so the page fills as you play.
function renderLedger(list) {
  ledgerEl.replaceChildren();
  if (!list.length) return;
  const bestWave = list.reduce((m, e) => Math.max(m, e.wave || 0), 0);
  list.forEach((e, i) => {
    const stroke = document.createElement('i');
    const h = 6 + Math.min(1, (e.wave || 0) / 40) * 26;
    stroke.style.height = `${h}px`;
    stroke.style.setProperty('--tilt', `${((i * 37) % 11) - 5}deg`);
    if ((e.wave || 0) === bestWave && bestWave > 0) stroke.classList.add('best');
    if (i === list.length - 1) stroke.classList.add('latest');
    ledgerEl.append(stroke);
  });
}

function renderTitleScreen() {
  const records = loadRecords();
  const ledger = loadLedger();
  ovTitle.innerHTML = TITLE_LOGO;
  ovSub.textContent = 'THE PAGE REMEMBERS';
  ovCause.hidden = true;
  ovPoem.hidden = true;
  ovSeal.classList.remove('stamp');
  ovText.innerHTML = 'A sheet of paper. A hundred blades.<br />Every wound you open bleeds into the page and stays there.';
  if (records.wave > 0) {
    ovChase.hidden = false;
    ovChase.innerHTML = `BEST · WAVE <b>${records.wave}</b> · ${records.kills} KILLS · ${records.parries} PERFECT PARRIES`;
  } else {
    ovChase.hidden = true;
  }
  renderLedger(ledger);
  ovBtn.textContent = 'BEGIN';
  ovDaily.hidden = false;
  ovShare.hidden = true;
}

// ----------------------------------------------------------- the death poem
// Samurai wrote jisei — a last poem, left where they fell. This one is
// composed from the run's actual facts and seeded by them, so a given death
// always writes the same three lines: the poem belongs to that death, not to
// a dice roll. Deterministic, quiet, no cleverness at runtime.

function numberWord(n) {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen', 'twenty'];
  return n <= 20 ? words[n] : String(n);
}

function composeDeathPoem(record) {
  const info = state.deathInfo || { type: '', rival: '', action: '' };
  const w = state.wave;
  const seed = dateSeed(`${w}|${state.kills}|${state.perfectParries}|${info.type}|${info.action}`);
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // Line one: the span of the run.
  const spans = w <= 2 ? [
    'the brush barely wet',
    'two strokes, then stillness',
    'ink still loose on the bristles',
  ] : w <= 9 ? [
    `${numberWord(w)} waves of ink`,
    `${numberWord(w)} waves, each darker`,
    `the page took ${numberWord(w)} waves from me`,
  ] : [
    `${numberWord(w)} waves deep, the paper heavy`,
    `${numberWord(w)} waves — the page near black`,
    `${numberWord(w)} waves of careful cutting`,
  ];

  // Line two: the death itself, in the killer's shape.
  const who = info.rival ? info.rival.toLowerCase() : '';
  const deaths = {
    ronin: ['a straw hat’s patient answer', 'one plain cut from a plain man'],
    hunter: ['the quick one wrote faster', 'a hunter’s short reply'],
    yari: ['the spear i never saw', 'reach i did not respect'],
    brute: ['the slow blade fell anyway', 'weight enough to close a book'],
    oni: who
      ? [`${who} signed the page for me`, `${who}’s answer was iron`]
      : ['the iron demon signed his name', 'horns against a paper sky'],
  }[info.type] || ['no blade — only my own haste', 'the field itself grew teeth'];
  const caught = {
    dash: 'caught between two footfalls',
    attack: 'my own cut left the door open',
    parry: 'a breath behind the steel',
    iai: 'cut down mid-draw, sword half-born',
  }[info.action];
  if (caught) deaths.push(caught);

  // Line three: what the page keeps.
  const closings = [];
  if (record) closings.push('furthest yet — dry it, turn the sheet', 'a new high-water mark of ink');
  if (state.perfectParries >= 8) closings.push('steel rang like temple bells, then rain');
  if (state.kills >= 30) closings.push('so much ink, and none of it mine to keep');
  if (state.bestChain >= 8) closings.push('the flow broke where the paper folds');
  closings.push(
    'the ink dries lighter, never gone',
    'the page remembers what i forgot',
    'wind over paper, then stillness',
  );

  return [pick(spans), pick(deaths), pick(closings)];
}

let lastPoem = null;

function buildShareText() {
  const tag = run.daily ? `Daily · ${run.dateStr}` : todayStamp();
  const poem = lastPoem ? [``, ...lastPoem.map((l) => `  ${l}`), ``] : [];
  return [
    'ONISOLO — THE PAGE REMEMBERS',
    tag,
    ...poem,
    `Wave ${state.wave} · ${state.kills} kills · ${state.perfectParries} perfect parries · best flow ${state.bestChain}`,
    'https://samurai.theoazriel.com',
  ].join('\n');
}

async function copyResult() {
  const text = buildShareText();
  try {
    await navigator.clipboard.writeText(text);
    ovShare.textContent = 'COPIED';
  } catch {
    ovShare.textContent = 'COPY FAILED';
  }
  setTimeout(() => { ovShare.textContent = 'COPY RESULT'; }, 1600);
}

function gameOver() {
  if (state.over) return;
  state.over = true;
  state.running = false;
  updateHUD();
  ink.splashScreen(20, 2.2);
  // The print ends rather than fading: the final frame holds near-frozen for a
  // long beat — grain, weave and flicker all stop with it — while the music is
  // pulled out and only the wind is left. The overlay waits for the silence.
  hitstop(1.1, 0.02);
  audio.setWind(0.12);
  audio.setMusicIntensity(0);
  audio.silenceMusic(1.3, 0.001);
  const records = loadRecords();      // previous bests, before this run folds in
  const prevBestWave = records.wave;
  const newRecords = {
    wave: Math.max(records.wave, state.wave),
    kills: Math.max(records.kills, state.kills),
    parries: Math.max(records.parries, state.perfectParries),
    flow: Math.max(records.flow, state.bestChain),
  };
  saveRecords(newRecords);
  const ledger = pushLedger({
    wave: state.wave, kills: state.kills, parries: state.perfectParries,
    flow: state.bestChain, daily: run.daily, date: todayStamp(),
  });
  const record = state.wave > records.wave || state.kills > records.kills
    || state.perfectParries > records.parries || state.bestChain > records.flow;

  // The chase line: the single strongest reason to draw again.
  let chase;
  if (state.wave > prevBestWave) chase = `NEW BEST — WAVE <b>${state.wave}</b>`;
  else if (prevBestWave === 0) chase = 'FIRST BLOOD ON THE PAGE';
  else if (state.wave === prevBestWave) chase = `YOU MATCHED YOUR BEST — WAVE <b>${prevBestWave}</b>`;
  else {
    const short = prevBestWave - state.wave;
    chase = `${short} WAVE${short === 1 ? '' : 'S'} SHORT OF YOUR BEST — WAVE <b>${prevBestWave}</b>`;
  }

  lastPoem = composeDeathPoem(record);

  setTimeout(() => {
    ovTitle.textContent = 'DEFEAT';
    ovSub.textContent = record ? 'A NEW RECORD' : run.daily ? `DAILY · ${run.dateStr}` : 'DEATH ON THE PAGE';
    ovCause.hidden = false;
    ovCause.textContent = state.deathBy || 'CUT DOWN';
    ovPoem.hidden = false;
    ovPoemText.innerHTML = lastPoem.join('<br />');
    // The vermilion seal is pressed only on a record — the game's single drop
    // of color, spent when the page gains a new mark.
    ovSeal.classList.remove('stamp');
    if (record) { void ovSeal.offsetWidth; ovSeal.classList.add('stamp'); }
    ovText.innerHTML = `WAVE ${state.wave} · ${state.kills} KILLS<br><b>${state.perfectParries} PERFECT PARRIES · BEST FLOW ${state.bestChain}</b>`;
    ovChase.hidden = false;
    ovChase.innerHTML = chase;
    renderLedger(ledger);
    ovBtn.textContent = 'DRAW AGAIN';
    ovDaily.hidden = true;
    ovShare.hidden = false;
    ovShare.textContent = 'COPY RESULT';
    overlay.classList.remove('hidden');
    input.enabled = false;
  }, 1200);
}

function beginGame(opts = {}) {
  if (state.running) return;
  run.daily = Boolean(opts.daily);
  run.dateStr = todayStamp();
  run.rng = run.daily ? mulberry32(dateSeed(run.dateStr)) : Math.random;
  overlay.classList.add('hidden');
  input.enabled = true;
  audio.start();
  if (state.over) {
    try { sessionStorage.setItem('samurai-restart', run.daily ? 'daily' : 'normal'); } catch { /* ignore */ }
    location.reload();
    return;
  }
  state.running = true;
  state.waveBreak = 1.2;
  updateHUD();
}

ovBtn.addEventListener('click', () => beginGame());
ovDaily.addEventListener('click', () => beginGame({ daily: true }));
ovShare.addEventListener('click', copyResult);
addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !state.running) beginGame();
});

// A fresh run's title screen, and the snappy path back in after a defeat: if
// DRAW AGAIN reloaded the page, drop straight into a new run in the same mode.
renderTitleScreen();
try {
  const restart = sessionStorage.getItem('samurai-restart');
  if (restart) {
    sessionStorage.removeItem('samurai-restart');
    beginGame({ daily: restart === 'daily' });
    // A reload-driven restart has no user gesture, so the audio context comes
    // up suspended. Resume it on the first input so the run isn't silent.
    const resume = () => audio.start();
    addEventListener('pointerdown', resume, { once: true });
    addEventListener('keydown', resume, { once: true });
  }
} catch { /* ignore */ }

// ------------------------------------------------------------------ resizing

let sizedW = 0, sizedH = 0;

function onResize() {
  const { w, h } = film.resize();
  sizedW = w; sizedH = h;
  const aspect = w / h;
  camera.left = -VIEW_HALF * aspect;
  camera.right = VIEW_HALF * aspect;
  camera.top = VIEW_HALF;
  camera.bottom = -VIEW_HALF;
  camera.updateProjectionMatrix();
  ink.resizeScreen();
  applyLetterbox(2.39);
}

// Reconcile every frame rather than trusting the resize event alone. A resize
// that fires while the page is hidden reports 0x0, and nothing guarantees a
// second event when it comes back — which would leave the canvas stuck.
function checkResize() {
  if (innerWidth < 1 || innerHeight < 1) return;
  if (innerWidth !== sizedW || innerHeight !== sizedH) onResize();
}

addEventListener('resize', onResize);
onResize();

// ------------------------------------------------------------------ the loop

let last = performance.now();

// One simulation tick. Separated from the rAF callback so it can be driven at a
// fixed rate for testing, independent of how the browser schedules frames.
function step(dt) {
  // Hitstop runs on real time; everything else runs on scaled time.
  if (state.hitstop > 0) {
    state.hitstop -= dt;
    if (state.hitstop <= 0) state.timeScale = 1;
  } else {
    state.timeScale += (1 - state.timeScale) * Math.min(1, dt * 12);
  }
  const sdt = dt * state.timeScale;

  state.time += sdt;
  timeUniform.value = state.time;

  input.update(dt);
  if (state.running) {
    if (!state.choosingUpgrade) {
      updatePlayer(sdt);
      updateEnemies(sdt);
      updateFlow(sdt);

      if (state.waveBreak > 0) {
        state.waveBreak -= sdt;
        if (state.waveBreak <= 0) {
          if (state.pendingUpgrade) showUpgradeChoice();
          else startWave();
        }
      } else if (enemies.length === 0) {
        state.pendingUpgrade = state.wave > 0;
        state.waveBreak = state.pendingUpgrade ? 2.6 : 1.0;
      }
    }
  } else if (!state.over) {
    // Idle breathing on the title screen.
    animateLocomotion(player, state.phase, 0, state.time);
  }

  if (iaiT > 0) iaiT -= dt;
  iaiTrail.update(sdt);
  trail.update(sdt);
  enemyTrail.update(sdt);
  updateParryRings(dt);
  updateImpactBursts(dt);
  ragdolls.update(sdt);
  gibs.update(sdt, ink);
  ink.update(sdt, camera);
  world.update(player.root.position);
  audio.setRustle(world.ambience.rustle);

  const bossWave = state.running && state.wave % 5 === 0 && enemies.some((e) => e.type === 'oni');
  rain.update(sdt, player.root.position, bossWave ? 1 : 0);
  audio.setWind(bossWave ? 0.13 : 0.05);
  const musicPressure = state.running
    ? Math.min(1, 0.12 + enemies.length * 0.07 + state.chain * 0.025 + (bossWave ? 0.25 : 0))
    : 0;
  audio.setMusicIntensity(musicPressure, bossWave);

  updateCamera(dt);
  updateIaiAura();

  // Film grain gets heavier as the samurai weakens — the print degrades with them.
  const hurtK = 1 - Math.max(0, state.hp) / PLAYER_MAX_HP;
  const flowK = Math.min(1, state.chain / 15);
  // On death the print is crushed rather than faded: contrast and vignette
  // climb on real time while scaled time stands still, so the held final frame
  // visibly hardens into its last image.
  deathCrush += ((state.over ? 1 : 0) - deathCrush) * Math.min(1, dt * 5);
  film.uniforms.uGrain.value = 0.05 + hurtK * 0.06;
  film.uniforms.uVignette.value = 0.32 + hurtK * 0.45 + flowK * 0.05 + deathCrush * 0.3;
  film.uniforms.uContrast.value = 1.42 + hurtK * 0.25 + flowK * 0.10 + deathCrush * 0.55;
  whiteFlash *= Math.exp(-9 * dt);
  film.uniforms.uWhite.value = whiteFlash;
  film.updateFilm(state.time);

  film.render(scene, camera);
}

function frame(now) {
  requestAnimationFrame(frame);
  checkResize();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
}

requestAnimationFrame(frame);

// Exposed for tuning and for driving the simulation from the console:
// `__samurai.step(1/60)`, `__samurai.film.uniforms`, `__samurai.state`.
window.__samurai = {
  version: GAME_VERSION,
  film, scene, camera, state, ink, ragdolls, input, player, step, audio, world,
  trail, enemyTrail, iaiTrail,
  beginGame, startWave, spawnEnemy, gameOver, damagePlayer,
  get enemies() { return enemies; },
};
