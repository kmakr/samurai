import * as THREE from 'three';
import { FilmRenderer, applyLetterbox, viewportSize } from './render.js';
import { DISCIPLINE_ART, HUD_LIFE, HUD_IAI, MASTERY_SEAL, POEM_FLOURISH } from './glyphs.js';
import { InkSystem } from './ink.js';
import { buildWorld, ARENA, Rain } from './world.js';
import {
  makeSamurai, makeEnemy, ENEMY_TYPES, animateLocomotion,
  SAMURAI_SKINS, applySamuraiSkin,
} from './actors.js';
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
const DASH_DISTANCE = 4.2;
const DASH_TIME = 0.20;
// Short cooldown so dashes chain — the dash is the connective tissue of the
// flow, not a rationed escape. Lockout between dashes is DASH_TIME + this.
const DASH_COOLDOWN = 0.12;

// Attack phases, in seconds. Short wind-up, brief active window, longer
// recovery — committing to a swing should feel like a decision.
// Active windows sit at 7-10 frames: shorter and the swing arc is over before
// the eye registers it, which reads as the katana not moving at all.
const ATTACK = [
  { windup: 0.09, active: 0.12, recover: 0.20, damage: 34, reach: 3.1, arc: 0.05 },
  { windup: 0.07, active: 0.12, recover: 0.22, damage: 38, reach: 3.2, arc: -0.15 },
  { windup: 0.13, active: 0.16, recover: 0.34, damage: 62, reach: 3.6, arc: 0.30 },
];
// Dash-cancel strikes turn the evade into an opening: attack out of a dash and
// the direction of the dash decides the cut. Driving forward yields a piercing
// thrust that closes the gap; a side or back dash whips a fast cross cut.
// Neither chains — each is one committed read spent from a dash.
const THRUST  = { windup: 0.06, active: 0.12, recover: 0.24, damage: 48, reach: 4.7 };
const DASHCUT = { windup: 0.04, active: 0.11, recover: 0.20, damage: 40, reach: 3.4 };
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

// Brush marks on the chrome, injected from glyphs.js so every piece of ink in
// the game has one source: a drop of ink for life, the drawn blade for iai,
// and the trailing stroke that sits above the death poem.
const vitalLabels = document.querySelectorAll('#vitals .vitalLabel');
vitalLabels[0].innerHTML = `${HUD_LIFE}<span>HP</span>`;
vitalLabels[1].innerHTML = `${HUD_IAI}<span>IAI</span>`;
document.getElementById('ovPoem')
  .insertAdjacentHTML('afterbegin', `<span class="poemFlourish">${POEM_FLOURISH}</span>`);
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

// Touch controls: shown once we know the device is touch-first (coarse pointer
// at load) or the moment a real touch arrives. The stick and buttons feed the
// same action buffers as the keyboard, so the game logic never knows.
function enableTouchUI() {
  if (document.body.classList.contains('touch')) return;
  document.body.classList.add('touch');
  input.touchActive = true;
}
input.bindStick(
  document.getElementById('stickZone'),
  document.getElementById('stickRing'),
  document.getElementById('stickNub'),
);
input.bindButton(document.getElementById('touchCut'), 'attack');
input.bindButton(document.getElementById('touchDash'), 'dash');
input.bindButton(document.getElementById('touchParry'), 'parry');
input.bindButton(document.getElementById('touchIai'), 'focus');
if (matchMedia('(pointer: coarse)').matches) enableTouchUI();
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enableTouchUI(); });
// Belt and suspenders for Safari: even with touch-action set, kill the
// double-tap and pinch zoom gestures at the event level.
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
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

const SKIN_STORAGE_KEY = 'samurai-skin';
const LEGACY_SKIN_IDS = {
  sumi: 'musashi', akane: 'hitokiri', ai: 'masamune', shiro: 'mibu',
};
let selectedSkinId = 'musashi';
try { selectedSkinId = localStorage.getItem(SKIN_STORAGE_KEY) || selectedSkinId; } catch { /* private storage can fail */ }
selectedSkinId = LEGACY_SKIN_IDS[selectedSkinId] || selectedSkinId;
selectedSkinId = applySamuraiSkin(player, selectedSkinId).id;
document.documentElement.dataset.skin = selectedSkinId;

// Zenith Flow gives the player a thin white edge. Each shell is attached to
// its source mesh, so it inherits the combat pose without a second animation
// pass. The shells stay hidden outside tier 3 and add no normal-frame draws.
const flowOutlineMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  side: THREE.BackSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const flowOutlineMeshes = [];
const flowOutlineSources = [];
player.root.traverse((object) => {
  if (object.isMesh && !object.userData.isBladeGlow) flowOutlineSources.push(object);
});
for (const source of flowOutlineSources) {
  const shell = new THREE.Mesh(source.geometry, flowOutlineMaterial);
  shell.scale.setScalar(1.055);
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.renderOrder = 8;
  shell.visible = false;
  shell.userData.isFlowOutline = true;
  source.add(shell);
  flowOutlineMeshes.push(shell);
}
let flowOutlineOpacity = 0;

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
  slowmo: 0,          // seconds of sustained slow-motion remaining
  slowmoScale: 1,     // time scale held while slowmo runs
  phase: 0,          // gait phase
  vel: new THREE.Vector3(),
  facing: 0,
  action: 'idle',    // idle | attack | dash | parry | iai | hurt
  actionT: 0,
  attackKind: 'arc', // arc (the combo) | thrust | dashcut
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
  seenYumi: false,
  seenFierce: false,
  seenDashCut: false,
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
  pointer.set((input.mouse.x / sizedW) * 2 - 1, -(input.mouse.y / sizedH) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, out)) {
    out.copy(player.root.position).add(vTmp.set(0, 0, -1));
  }
  return out;
}

function nearestEnemyYaw(range) {
  let best = null;
  let bestD = range * range;
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.actor.root.position.x - player.root.position.x;
    const dz = e.actor.root.position.z - player.root.position.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = Math.atan2(dx, dz); }
  }
  return best;
}

function aimYaw() {
  // Touch has no cursor, so the aim model changes: mid-cut (or with a cut
  // queued) the blade seeks the nearest man; on the move the samurai faces
  // his feet; standing idle he squares up to the closest threat.
  if (input.touchActive) {
    const target = nearestEnemyYaw(9);
    const attacking = state.action === 'attack'
      || input.buffers.attack > 0 || input.buffers.focus > 0;
    if (attacking && target !== null) return target;
    if (input.moveVector(vTmp)) return Math.atan2(vTmp.x, vTmp.z);
    if (target !== null) return target;
    return state.facing;
  }
  aimPoint(vAim);
  const dx = vAim.x - player.root.position.x;
  const dz = vAim.z - player.root.position.z;
  if (dx * dx + dz * dz < 0.02) return state.facing;
  return Math.atan2(dx, dz);
}

// ------------------------------------------------------------------ effects

// Player-facing settings, persisted to localStorage. `reduceShake` also turns
// itself on the first visit under the OS "reduce motion" preference. It feeds
// `juiceScale`, which damps the camera's undirected shake, the directed
// contact punch, and the white flash at the moment they reach the frame — so
// the read stays intact while the violence of the motion comes down.
const settings = { muted: false, reduceShake: false };
let juiceScale = 1;
function applyJuice() { juiceScale = settings.reduceShake ? 0.32 : 1; }

function loadSettings() {
  let raw = null;
  try { raw = localStorage.getItem('samurai-settings'); } catch { /* private storage can fail */ }
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (typeof s.muted === 'boolean') settings.muted = s.muted;
      if (typeof s.reduceShake === 'boolean') settings.reduceShake = s.reduceShake;
    } catch { /* corrupt value: keep defaults */ }
  } else if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settings.reduceShake = true;   // first visit honours the OS preference
  }
  applyJuice();
}
function saveSettings() {
  try { localStorage.setItem('samurai-settings', JSON.stringify(settings)); } catch { /* ignore */ }
}

let shakeAmount = 0;
function shake(v) { shakeAmount = Math.min(1.4, shakeAmount + v); }

function hitstop(duration, scale = 0.08) {
  state.hitstop = Math.max(state.hitstop, duration);
  state.timeScale = scale;
}

let whiteFlash = 0;
let deathCrush = 0;
function flash(v) { whiteFlash = Math.max(whiteFlash, v); }

// The parry's flash frame: the whole print inverts for a few frames. It runs
// on real time, so it stays visible through the parry's hitstop instead of
// being frozen away with everything else.
let invertT = 0;
function parryFlash() { invertT = 0.09; }

const combatCalloutEl = document.getElementById('combatCallout');
const boonNoticeEl = document.getElementById('boonNotice');
const damageFlashEl = document.getElementById('damageFlash');
function showCombatCallout(mark, meaning) {
  combatCalloutEl.querySelector('.mark').textContent = mark;
  combatCalloutEl.querySelector('.meaning').textContent = meaning;
  combatCalloutEl.classList.remove('show');
  void combatCalloutEl.offsetWidth;
  combatCalloutEl.classList.add('show');
}

function showBoonNotice(upgrade, rank, effect, mastered = false) {
  boonNoticeEl.querySelector('.sigil').innerHTML = DISCIPLINE_ART[upgrade.id] || '';
  boonNoticeEl.querySelector('.eyebrow').textContent = mastered ? 'MASTERY REWARD' : `DISCIPLINE ACTIVE · RANK ${rank}`;
  boonNoticeEl.querySelector('.name').textContent = upgrade.name;
  boonNoticeEl.querySelector('.effect').textContent = effect;
  boonNoticeEl.classList.remove('show');
  void boonNoticeEl.offsetWidth;
  boonNoticeEl.classList.add('show');
}

function showDamageFlash() {
  damageFlashEl.classList.remove('show');
  void damageFlashEl.offsetWidth;
  damageFlashEl.classList.add('show');
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
const dashWakes = [];

function makeDashWakeGeometry() {
  const positions = [];
  // Three uneven dry-brush lanes. The mesh grows along local +Z with the
  // samurai, so the mark is written by the dash instead of appearing ahead.
  for (const [offset, startWidth, endWidth, start, end] of [
    [-0.24, 0.18, 0.025, 0.00, 0.82],
    [0.02, 0.25, 0.055, 0.04, 1.00],
    [0.28, 0.11, 0.018, 0.13, 0.72],
  ]) {
    positions.push(
      offset - startWidth, 0, start, offset + startWidth, 0, start, offset + endWidth, 0, end,
      offset - startWidth, 0, start, offset + endWidth, 0, end, offset - endWidth, 0, end,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

const dashWakeGeo = makeDashWakeGeometry();

function spawnDashWake(position, direction) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x07070a,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(dashWakeGeo, material);
  mesh.position.set(position.x, 0.078, position.z);
  mesh.rotation.y = Math.atan2(direction.x, direction.z);
  mesh.scale.set(1, 1, 0.02);
  mesh.renderOrder = 5;
  scene.add(mesh);
  dashWakes.push({ mesh, age: 0, life: DASH_TIME + 0.24 });
}

function updateDashWakes(dt) {
  for (let i = dashWakes.length - 1; i >= 0; i--) {
    const wake = dashWakes[i];
    wake.age += dt;
    const written = THREE.MathUtils.clamp(wake.age / DASH_TIME, 0, 1);
    wake.mesh.scale.z = Math.max(0.02, DASH_DISTANCE * written);
    if (wake.age > DASH_TIME) {
      const fade = (wake.age - DASH_TIME) / (wake.life - DASH_TIME);
      wake.mesh.material.opacity = 0.76 * (1 - THREE.MathUtils.clamp(fade, 0, 1)) ** 1.6;
    }
    if (wake.age >= wake.life) {
      scene.remove(wake.mesh);
      wake.mesh.material.dispose();
      dashWakes.splice(i, 1);
    }
  }
}

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

function updateFlowOutline(dt) {
  const zenith = state.running && !state.over && getFlowTier() === 3;
  const target = zenith ? 0.24 + Math.sin(state.time * 5.2) * 0.045 : 0;
  flowOutlineOpacity += (target - flowOutlineOpacity) * (1 - Math.exp(-12 * dt));
  flowOutlineMaterial.opacity = Math.max(0, flowOutlineOpacity);
  const visible = flowOutlineOpacity > 0.006;
  for (const shell of flowOutlineMeshes) shell.visible = visible;
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

function getFlowTier(chain = state.chain) {
  if (chain >= 12) return 3;
  if (chain >= 8) return 2;
  if (chain >= 4) return 1;
  return 0;
}

let flowWarningPlayed = false;

function addFlow(amount = 1) {
  const previousTier = getFlowTier();
  state.chain += amount;
  state.chainTimer = FLOW_WINDOW;
  flowWarningPlayed = false;
  state.bestChain = Math.max(state.bestChain, state.chain);
  const nextTier = getFlowTier();
  audio.setFlowTier(nextTier);
  if (nextTier > previousTier) {
    audio.flowTier(nextTier);
    if (nextTier === 3) {
      flash(0.42);
      shake(0.62);
    }
  }
  updateHUD();
}

function breakFlow() {
  if (state.chain > 0) audio.flowBreak();
  state.chain = 0;
  state.chainTimer = 0;
  flowWarningPlayed = false;
  audio.setFlowTier(0);
  updateHUD();
}

function updateFlow(dt) {
  if (state.chain > 0) {
    state.chainTimer -= dt;
    if (state.chainTimer <= 0) breakFlow();
  }
  const target = state.chain > 0 ? THREE.MathUtils.clamp(state.chainTimer / FLOW_WINDOW, 0, 1) : 0;
  if (target > 0.8) flowWarningPlayed = false;
  if (state.chain > 0 && target <= 0.24 && !flowWarningPlayed) {
    flowWarningPlayed = true;
    audio.flowWarning();
  }
  flowEl.classList.toggle('expiring', state.chain > 0 && target <= 0.24);
  flowChargeEl.style.transform = `scaleX(${target})`;
  const followSpeed = target > flowGhostLevel ? 18 : 3.2;
  flowGhostLevel += (target - flowGhostLevel) * Math.min(1, dt * followSpeed);
  flowGhostEl.style.transform = `scaleX(${flowGhostLevel})`;
}

// -------------------------------------------------------------------- waves

function waveComposition(n) {
  const list = [];
  // Every count is capped so the field plateaus around two dozen instead of
  // ballooning past forty — a clear frame, not a slog. Chaff (ronin, hunters)
  // is capped hardest so late waves become a denser mix of real threats rather
  // than a sea of the weakest enemy. Escalation past the caps comes from the
  // HP/damage scaling and the rising attack-slot count, not from headcount.
  const ronin = Math.min(7, 2 + Math.floor(n * 0.6));
  const hunters = n >= 2 ? Math.min(6, Math.floor(n * 0.5)) : 0;
  const yari = n >= 3 ? Math.min(4, 1 + Math.floor((n - 3) * 0.35)) : 0;
  const brutes = n >= 4 ? Math.min(4, Math.floor((n - 2) / 3)) : 0;
  const yumi = n >= 6 ? Math.min(3, 1 + Math.floor((n - 6) / 4)) : 0;
  for (let i = 0; i < ronin; i++) list.push('ronin');
  for (let i = 0; i < hunters; i++) list.push('hunter');
  for (let i = 0; i < yari; i++) list.push('yari');
  for (let i = 0; i < brutes; i++) list.push('brute');
  for (let i = 0; i < yumi; i++) list.push('yumi');
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
  // Archers telegraph along the ground: a thin additive line from bow to the
  // locked firing direction. One mesh per archer, shown only while aiming.
  let aimLine = null;
  if (spec.bow) {
    aimLine = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    aimLine.renderOrder = 6;
    scene.add(aimLine);
  }

  // Late-game difficulty comes from threat, not tedium: HP scales gently so
  // kills stay snappy, while damage scales so a missed read stays lethal — the
  // whole point of the parry/dash game is that a hit should cost you more as
  // the waves climb, not less.
  const hpScale = 1 + state.wave * 0.05;
  const dmgScale = 1 + state.wave * 0.04;
  enemies.push({
    type, spec, actor, bladeMats, bladeGlow,
    aimLine,
    aimDir: new THREE.Vector3(),
    rival: Boolean(options.rival),
    rivalName: options.rivalName || '',
    grudge: Boolean(options.grudge),
    rivalFollowup: false,
    hp: spec.hp * hpScale,
    maxHp: spec.hp * hpScale,
    damage: spec.damage * dmgScale,
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
    fierce: false,
    dead: false,
  });
}

// A fierce strike cannot be answered with steel — only with distance. The
// heavy commits them by habit; the demon mixes them in. Their long wind-ups
// are the fair warning, and the vermilion tell tells you *this* one is coming.
function rollFierce(e) {
  if (e.spec.bow) return false;
  if (e.type === 'brute') return run.rng() < 0.75;
  if (e.type === 'oni') return run.rng() < 0.5;
  return false;
}

// Decide a strike's kind as its wind-up begins, and sound the unblockable's
// warning the instant it commits so the ear has the whole wind-up to react.
function commitStrike(e) {
  e.fierce = rollFierce(e);
  if (e.fierce) audio.fierce();
}

function startWave() {
  state.wave++;
  // How many enemies may commit an attack at once. Climbs past the old cap of
  // 4 so the pressure keeps rising after the crowd size has plateaued —
  // intensity from simultaneity, not from a bigger pool of idle bodies.
  state.slots = Math.min(5, 2 + Math.floor(state.wave / 3));
  const rivalName = state.wave % 5 === 0 ? rivalNameForWave(state.wave) : '';
  if (rivalName) audio.silenceMusic(0.82, 0.002);
  const grudge = Boolean(rivalName) && loadGrudge() === rivalName;
  const composition = waveComposition(state.wave);
  for (const type of composition) {
    spawnEnemy(type, { rival: type === 'oni', rivalName, grudge: type === 'oni' && grudge });
  }
  audio.taiko(state.wave % 5 === 0 ? 58 : 82, 0.55);
  showWaveTitle(state.wave);
  // The spearman gets a name the first time it walks on — a new silhouette is
  // worth a beat of attention.
  if (!state.seenYari && composition.includes('yari')) {
    state.seenYari = true;
    setTimeout(() => { if (state.running) showCombatCallout('槍', 'YARI · STRIKES FROM RANGE'); }, 1600);
  }
  if (!state.seenYumi && composition.includes('yumi')) {
    state.seenYumi = true;
    setTimeout(() => { if (state.running) showCombatCallout('弓', 'YUMI · MOVE OFF THE LINE'); }, 1600);
  }
  updateHUD();
}

const waveTitleEl = document.getElementById('waveTitle');
function showWaveTitle(n) {
  const boss = n % 5 === 0;
  // A remembering rival trades the demon's 鬼 for 怨 — the grudge — and the
  // introduction stops being about the rival and starts being about you.
  const grudge = boss && loadGrudge() === rivalNameForWave(n);
  waveTitleEl.innerHTML = boss
    ? grudge
      ? `<span class="kanji">怨</span><span class="latin">${rivalNameForWave(n)} REMEMBERS YOU</span>`
      : `<span class="kanji">鬼</span><span class="latin">${rivalNameForWave(n)}: THE IRON DEMON</span>`
    : (n - 1) % 5 === 0
      ? `<span class="kanji">${numberKanji(n)}</span><span class="latin">ACT ${['I', 'II', 'III', 'IV', 'V'][actIndex()]} · ${currentAct().name}</span>`
      : `<span class="kanji">${numberKanji(n)}</span><span class="latin">WAVE ${n}</span>`;
  waveTitleEl.classList.remove('show');
  void waveTitleEl.offsetWidth; // restart the animation
  waveTitleEl.classList.add('show');
}

function rivalNameForWave(n) {
  const names = ['KUROGANE', 'AKATSUKI', 'SHIROGANE', 'MURASAME'];
  return names[(Math.floor(n / 5) - 1) % names.length];
}

// Every five waves is an act: a name for the title, and a slightly different
// print — the film hardens as the run travels toward the black page. The last
// act holds; an endless run does not cycle back to morning.
const ACT_DEFS = [
  { name: 'MORNING PAPER', grain: 0, vig: 0, con: 0, rain: 0, wind: 0 },
  { name: 'THE CROWS', grain: 0.012, vig: 0.04, con: 0.05, rain: 0, wind: 0.01 },
  { name: 'NIGHTFALL', grain: 0.022, vig: 0.1, con: 0.1, rain: 0, wind: 0.02 },
  { name: 'THE LONG RAIN', grain: 0.015, vig: 0.06, con: 0.06, rain: 0.55, wind: 0.05 },
  { name: 'THE BLACK PAGE', grain: 0.03, vig: 0.14, con: 0.13, rain: 0.3, wind: 0.04 },
];

function actIndex() {
  return Math.min(ACT_DEFS.length - 1, Math.floor(Math.max(0, state.wave - 1) / 5));
}
function currentAct() { return ACT_DEFS[actIndex()]; }

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
      <span class="sigil">${DISCIPLINE_ART[upgrade.id] || upgrade.mark}</span>
      <span class="name">${upgrade.name}</span>
      <span class="level">${mastered ? `${MASTERY_SEAL} MASTERED` : current ? `RANK ${current} → ${next}` : 'NEW DISCIPLINE'}</span>
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
  const current = state.upgrades[upgrade.id];
  const mastered = current >= 3;
  const next = Math.min(3, current + 1);
  const effect = mastered ? 'Restored 20 life and 20 focus.' : upgrade.describe(next);
  if (mastered) {
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
  showBoonNotice(upgrade, next, effect, mastered);
  audio.boon();
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

// The spec for the swing in flight. The arc combo indexes ATTACK by combo
// position; the dash-cancel strikes are single fixed specs.
function activeAttack() {
  if (state.attackKind === 'thrust') return THRUST;
  if (state.attackKind === 'dashcut') return DASHCUT;
  return ATTACK[state.comboIndex];
}

function playerAttackHits() {
  const kind = state.attackKind;
  const cfg = activeAttack();
  const px = player.root.position.x, pz = player.root.position.z;
  const fx = Math.sin(state.facing), fz = Math.cos(state.facing);
  let hitAny = false;

  const isFinisher = kind === 'arc' && state.comboIndex === 2;
  const isThrust = kind === 'thrust';
  // The direction a victim is thrown follows the *blade's travel*, not the
  // line from attacker to victim. Cut 1 and the dash-cut sweep right-to-left,
  // cut 2 mirrors back; the overhead finisher and the thrust drive straight
  // through. Radial-only knockback made hits feel like a shove, not a cut.
  const mirror = (kind === 'arc' && state.comboIndex === 1) || kind === 'dashcut' ? -1 : 1;
  const tangX = -fz * mirror, tangZ = fx * mirror;
  const straight = isFinisher || isThrust ? 1 : 0;

  for (const e of enemies) {
    if (e.dead || state.hitThisSwing.has(e)) continue;
    const dx = e.actor.root.position.x - px;
    const dz = e.actor.root.position.z - pz;
    const dist = Math.hypot(dx, dz);
    const reach = cfg.reach + e.spec.height * 0.4;
    if (dist > reach) continue;
    // A thrust is a narrow line — only what's dead ahead is pierced. The
    // sweeps take a wide forward arc: generous for a crowd, not a 360.
    if ((dx * fx + dz * fz) / (dist || 1) < (isThrust ? 0.6 : -0.15)) continue;

    state.hitThisSwing.add(e);
    hitAny = true;
    let cx = (dx / (dist || 1)) * 0.35 + tangX * (1 - straight) + fx * (0.3 + straight);
    let cz = (dz / (dist || 1)) * 0.35 + tangZ * (1 - straight) + fz * (0.3 + straight);
    const cl = Math.hypot(cx, cz) || 1;
    const dmgScale = isFinisher ? 1 + state.upgrades.finalStroke * 0.25 : 1;
    damageEnemy(e, cfg.damage * dmgScale, cx / cl, cz / cl,
      isFinisher ? 'bisect' : 'limb');
  }

  if (hitAny) {
    const zenithFinisher = getFlowTier() === 3 && isFinisher;
    // Per-kind contact weight: the thrust lands like the execution stroke, the
    // dash-cut between a light and the finisher.
    // Contact freeze is kept light on the bread-and-butter cuts so the combo
    // flows; the execution finisher keeps its heavy freeze as a weighty peak.
    let impactStop, impactShake, overhead;
    if (isThrust) { impactStop = 0.06; impactShake = 0.5; overhead = 1; }
    else if (kind === 'dashcut') { impactStop = 0.035; impactShake = 0.42; overhead = 0; }
    else {
      impactStop = [0.02, 0.03, 0.12][state.comboIndex] * (zenithFinisher ? 1.18 : 1);
      impactShake = [0.30, 0.43, 0.78][state.comboIndex] * (zenithFinisher ? 1.28 : 1);
      overhead = isFinisher ? 1 : 0;
    }
    hitstop(impactStop, isFinisher ? 0.04 : 0.06);
    shake(impactShake);
    // The camera bites forward along the cut — contact should be felt in the
    // frame, not just heard. The two arcs kick sideways in opposite directions;
    // the straight strokes drive through and down.
    camPunch.x += fx * (0.42 + overhead * 0.52) + tangX * (straight ? 0 : 0.20);
    camPunch.z += fz * (0.42 + overhead * 0.52) + tangZ * (straight ? 0 : 0.20);
    camPunch.y -= isFinisher ? 0.24 : 0.12;
    if (isFinisher) {
      flash(zenithFinisher ? 0.36 : 0.18);
      ink.splashScreen(zenithFinisher ? 4 : 2, zenithFinisher ? 0.52 : 0.34);
      if (zenithFinisher) audio.taiko(62, 0.34);
    } else if (isThrust) {
      flash(0.16);
      ink.splashScreen(2, 0.3);
    }
    audio.hit(isThrust ? 2 : kind === 'dashcut' ? 1 : state.comboIndex);
  }
}

function damageEnemy(e, amount, dirX, dirZ, severity = 'limb') {
  e.hp -= amount;
  const tier = getFlowTier();
  e.stagger = Math.max(e.stagger, 0.22 + tier * 0.035);
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
  const reaction = 0.35 * (1 + tier * 0.12);
  e.actor.root.position.x += dirX * reaction;
  e.actor.root.position.z += dirZ * reaction;
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
  audio.kill(severity === 'bisect' || big);

  state.kills++;
  if (e.rival) {
    state.rivalKills++;
    state.focus = FOCUS_MAX;
    if (e.grudge) {
      clearGrudge();
      showCombatCallout(e.rivalName, 'THE GRUDGE IS SETTLED · FOCUS RESTORED');
    } else {
      showCombatCallout(e.rivalName, 'RIVAL DEFEATED · FOCUS RESTORED');
    }
    audio.taiko(48, 0.72);
  }
  addFlow();
  state.focus = Math.min(FOCUS_MAX, state.focus + (big ? 20 : 9) * flowMultiplier());

  // A dead archer's aim line goes with it.
  if (e.aimLine) {
    scene.remove(e.aimLine);
    e.aimLine.geometry.dispose();
    e.aimLine.material.dispose();
  }

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
    : ({ ronin: 'A RONIN', hunter: 'A HUNTER', yari: 'A SPEARMAN', yumi: 'A BOWMAN', brute: 'A BRUTE', oni: 'THE IRON DEMON' })[source.type] || 'A STRAY BLADE';
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
  showDamageFlash();
  shake(0.9);
  hitstop(0.08, 0.1);
  audio.hurt(1 - Math.max(0, state.hp) / PLAYER_MAX_HP);
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
const iaiScreenA = new THREE.Vector3();
const iaiScreenB = new THREE.Vector3();
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

  // The cut, drawn across the page itself. Project the world stroke to the
  // screen so the wipe leans the way the blade actually travelled.
  iaiScreenA.copy(iaiOrigin).project(camera);
  iaiScreenB.copy(iaiEnd).project(camera);
  const wipeAngle = Math.atan2(-(iaiScreenB.y - iaiScreenA.y), iaiScreenB.x - iaiScreenA.x);
  ink.slashWipe(wipeAngle);

  ink.splashScreen(16, 1.8);
  flash(1);
  invertT = Math.max(invertT, 0.11);   // the sheet flips negative on impact
  state.slowmo = 0;                     // release the held breath...
  hitstop(0.16, 0.02);                  // ...into a hard freeze, then full speed
  shake(1.2);
  audio.iai();
}

function tryIai() {
  if (!state.running || iaiT > 0) return;
  if (state.focus < FOCUS_MAX) {
    showIaiNotice('IAI NOT READY', 'CHARGE: KILLS + PERFECT PARRIES', 1500);
    audio.denied();
    return;
  }
  state.focus = 0;
  audio.silenceMusic(0.62, 0.001);
  // A held breath: time dilates through the draw, then fireIaiCut releases it
  // into a hard freeze and back to full speed as the stroke lands.
  state.slowmo = 0.55;
  state.slowmoScale = 0.32;
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

function beginDash(moving) {
  state.action = 'dash';
  state.actionT = 0;
  state.dashCooldown = DASH_TIME + DASH_COOLDOWN;
  state.dashDir.copy(moving ? vMove : vTmp.set(Math.sin(state.facing), 0, Math.cos(state.facing)));
  state.dashHit.clear();
  rewardDashRead();
  spawnDashWake(player.root.position, state.dashDir);
  spawnImpactBurst(player.root.position, 0.42);
  camPunch.x += state.dashDir.x * 0.2;
  camPunch.z += state.dashDir.z * 0.2;
  shake(0.14);
  audio.dash();
}

// ------------------------------------------------------------- player update

// Idle sheathing: stand truly still with no blade near, and the samurai puts
// the sword away. The first input draws it again with a cut of sound.
let idleFor = 0;
let sheathK = 0;
let sheathed = false;

function updatePlayer(dt) {
  if (state.action !== 'iai') state.facing = aimYaw();

  if (state.dashCooldown > 0) state.dashCooldown -= dt;
  if (state.parryCooldown > 0) state.parryCooldown -= dt;
  if (state.invuln > 0) state.invuln -= dt;
  if (state.comboTimer > 0) state.comboTimer -= dt;
  else state.comboIndex = 0;

  const moving = input.moveVector(vMove);

  if (state.action === 'idle' && !moving) idleFor += dt; else idleFor = 0;
  let calm = idleFor > 3;
  if (calm) {
    for (const e of enemies) {
      if (e.dead) continue;
      const ex = e.actor.root.position.x - player.root.position.x;
      const ez = e.actor.root.position.z - player.root.position.z;
      if (ex * ex + ez * ez < 81) { calm = false; break; }
    }
  }
  if (sheathed && !calm && sheathK > 0.5) audio.swing(1);   // the redraw
  sheathed = calm;
  sheathK += ((sheathed ? 1 : 0) - sheathK) * Math.min(1, dt * (sheathed ? 3 : 18));

  // Rotate raw WASD into the isometric frame: W is up-screen, which under a
  // 45-degree camera is the world diagonal, not the world -Z axis.
  if (moving) {
    const mx = vMove.x, mz = vMove.z;
    const s = Math.sin(ISO_AZIMUTH), c = Math.cos(ISO_AZIMUTH);
    vMove.x = mx * c + mz * s;
    vMove.z = mz * c - mx * s;
  }

  // ---- action transitions
  // Dash is the universal cancel: it breaks out of an attack (any phase) or a
  // parry the instant it is pressed, so recovery never traps you — the core of
  // the fluid feel. The committed iai and the hurt stagger are the exceptions.
  const dashCancellable = state.action === 'idle' || state.action === 'attack' || state.action === 'parry';
  // A landed hit lets the combo chain immediately, without waiting for the
  // recovery window — kills flow straight into the next cut.
  const hitConfirmed = state.action === 'attack'
    && state.hitThisSwing && state.hitThisSwing.size > 0;
  const canChain = state.action === 'attack'
    && (state.attackPhase === 'recover' || (state.attackPhase === 'active' && hitConfirmed));

  if (dashCancellable && state.dashCooldown <= 0 && input.take('dash')) {
    beginDash(moving);
  } else if (state.action === 'idle') {
    if (input.take('focus')) tryIai();
    else if (input.take('parry') && state.parryCooldown <= 0) {
      state.action = 'parry';
      state.actionT = 0;
      state.parryCooldown = PARRY_COOLDOWN + PARRY_STARTUP + parryDuration() + PARRY_RECOVER;
    } else if (input.take('attack')) {
      beginAttack();
    }
  } else if (canChain) {
    // Chaining late in recovery (or the moment a hit confirms) is what makes the
    // combo feel like one sequence rather than three separate swings.
    if (input.take('attack') && state.comboIndex < ATTACK.length - 1) {
      state.comboIndex++;
      beginAttack(true);
    }
  } else if (state.action === 'dash') {
    // Dash-cancel: attack out of the evade. The dash direction relative to the
    // aim decides the cut — driving in skewers with a thrust, cutting away or
    // across whips a dash-cut. The dash has already spent its i-frames, so this
    // is the aggressive continuation, not a second escape.
    if (state.actionT > 0.02 && input.take('attack')) {
      const fwd = state.dashDir.x * Math.sin(state.facing) + state.dashDir.z * Math.cos(state.facing);
      const kind = fwd > 0.35 ? 'thrust' : 'dashcut';
      beginAttack(false, kind);
      if (!state.seenDashCut) {
        state.seenDashCut = true;
        showCombatCallout('抜', kind === 'thrust' ? 'DASH THRUST' : 'DASH CUT');
      }
    }
  }

  // ---- movement
  let speed = 0;
  if (state.action === 'dash') {
    // Cover a fixed distance regardless of frame cadence. The old quadratic
    // slowdown travelled only ~2 units — barely farther than normal running
    // over the same 0.2 s — so the dash looked and felt like it did nothing.
    const dashDt = Math.min(dt, Math.max(0, DASH_TIME - state.actionT));
    state.actionT += dt;
    state.invuln = Math.max(state.invuln, 0.02);
    const travel = DASH_DISTANCE * (dashDt / DASH_TIME);
    player.root.position.x += state.dashDir.x * travel;
    player.root.position.z += state.dashDir.z * travel;
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
    // Keep most of your footwork through a swing so you flow while cutting
    // instead of planting — except the execution finisher, which stays
    // committed and weighty (one of the peaks worth keeping).
    speed = PLAYER_SPEED * (state.attackKind === 'arc' && state.comboIndex === 2 ? 0.25 : 0.45);
    // Root motion: the body drives the cut. A small settle backward during the
    // coil, then a hard step through the active frames — the swing carries the
    // samurai forward instead of the sword waving from a planted figure.
    if (state.action === 'attack') {   // updateAttack may have ended the swing
      const cfg = activeAttack();
      const t = state.actionT, wu = cfg.windup, act = cfg.active;
      let drive = 0;
      if (t < wu) {
        drive = -1.3 * (t / wu);
      } else if (t < wu + act) {
        const w = (t - wu) / act;
        // The thrust launches the body forward far harder than a sweep — that
        // lunge is the whole point of it as a gap-closer.
        const peak = state.attackKind === 'thrust' ? 27
          : state.attackKind === 'dashcut' ? 15
          : state.comboIndex === 2 ? 15 : 10.5;
        drive = peak * Math.pow(1 - w, 1.4);
      }
      player.root.position.x += Math.sin(state.facing) * drive * dt;
      player.root.position.z += Math.cos(state.facing) * drive * dt;
    }
  } else if (state.action === 'parry') {
    state.actionT += dt;
    speed = PLAYER_SPEED * 0.25;
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

function beginAttack(chain = false, kind = 'arc') {
  state.attackKind = kind;
  if (kind !== 'arc' || !chain) state.comboIndex = 0;
  state.action = 'attack';
  state.actionT = 0;
  state.attackPhase = 'windup';
  state.hitThisSwing = new Set();
  state.comboTimer = COMBO_WINDOW;
  audio.swing(kind === 'thrust' ? 2 : state.comboIndex);
}

function updateAttack(dt) {
  const kind = state.attackKind;
  const cfg = activeAttack();
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
      const tier = getFlowTier();
      const baseScale = kind === 'thrust' ? 1.12 : state.comboIndex === 2 ? 1.28 : 1;
      trail.fire(vTmp, state.facing, {
        mirror: kind === 'dashcut' || (kind === 'arc' && state.comboIndex === 1),
        duration: cfg.active + cfg.recover * 0.8 + tier * 0.018,
        scale: baseScale * (1 + tier * 0.06),
        style: kind === 'thrust' ? 2 : kind === 'dashcut' ? 0 : state.comboIndex,
        energy: tier,
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

  if (state.action === 'attack' && state.attackKind === 'thrust') {
    // A stab, not a sweep: the blade levels edge-out and drives straight from
    // the hip on a locked line, both hands behind the point. The forward body
    // lunge (root motion) does most of the work; the arm just seats the line.
    const cfg = activeAttack();
    const wu = cfg.windup, act = cfg.active;
    const t = state.actionT;
    snap = true;
    twoHanded = true;
    if (t < wu) {
      const w = t / wu;
      armX = -0.2 - 0.55 * w;      // cock the point back by the hip
      armZ = 0.24 - 0.1 * w;
      torsoY = 0.3 * w;
      katanaRoll = 1.5;            // rolled flat, edge leading the point
    } else if (t < wu + act) {
      const w = (t - wu) / act;
      const e = Math.pow(w, 0.35);  // explode out, decelerate onto the line
      armX = -0.75 + 1.55 * e;      // punch level and slightly down
      armZ = 0.14 - 0.14 * e;
      torsoY = 0.3 - 0.62 * e;
      torsoZ = Math.sin(e * Math.PI) * 0.12;
      katanaRoll = 1.5;
      smear = Math.sin(Math.min(1, w * 1.7) * Math.PI);
    } else {
      const w = (t - wu - act) / cfg.recover;
      const e = w * w;
      armX = 0.8 - 1.0 * e;         // recover the point back to guard
      armZ = 0.0 + 0.24 * e;
      torsoY = -0.32 + 0.32 * e;
      katanaRoll = 1.5 - 0.5 * e;
    }
  } else if (state.action === 'attack') {
    const cfg = activeAttack();
    // The dash-cut is a mirrored cross-slash; the arc combo alternates sides.
    const mirror = state.attackKind === 'dashcut' || state.comboIndex === 1 ? -1 : 1;
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
    // The burst reads as speed, not a slide: the body drops and leans into the
    // dash while the arms trail, and the blade smears with the motion — a cheap
    // motion-streak that peaks mid-dash and eases out.
    const rush = Math.sin(THREE.MathUtils.clamp(state.actionT / DASH_TIME, 0, 1) * Math.PI);
    snap = true;
    armX = -0.4 - 0.55 * rush;
    armZ = 0.2 * rush;
    torsoZ = 0.2 + 0.28 * rush;
    crouch = 0.12 * rush;
    smear = rush * 0.5;
  } else {
    // Idle guard: blade low and slightly out, breathing — or, when the field
    // has been quiet long enough, at rest: arm dropped, blade rolled back.
    const breath = Math.sin(state.time * 1.9) * 0.05;
    armX = (-0.35 + breath) * (1 - sheathK) + 0.14 * sheathK;
    armZ = 0.28 * (1 - sheathK) + 0.04 * sheathK;
    katanaRoll = 2.3 * sheathK;
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
  const winding = e.state === 'windup' || (e.state === 'strike' && !e.resolved);

  if (e.state === 'windup') {
    const progress = THREE.MathUtils.clamp(e.t / e.spec.windup, 0, 1);
    const eta = e.spec.windup - e.t + ENEMY_STRIKE_TIME;
    // A fierce strike never offers the white parry-ready flash — there is no
    // frame to meet it on.
    ready = !e.fierce && eta >= PARRY_STARTUP && eta < PARRY_STARTUP + parryDuration();
    strength = 0.06 + progress ** 1.7 * 0.38;
  } else if (e.state === 'strike' && !e.resolved) {
    const eta = ENEMY_STRIKE_TIME - e.t;
    ready = !e.fierce && eta >= PARRY_STARTUP && eta < PARRY_STARTUP + parryDuration();
    strength = 0.3;
  }

  if (e.fierce && winding) {
    // Unblockable: the steel burns vermilion — the game's one danger colour —
    // and beats hard. The read is "leave", not "meet it".
    const puls = 0.72 + Math.sin(state.time * 22) * 0.28;
    const lit = (0.5 + strength) * puls;
    for (const material of e.bladeMats) {
      material.emissive.setRGB(0.9 * lit, 0.1 * lit, 0.05 * lit);
      material.emissiveIntensity = 2.6;
    }
    if (e.bladeGlow) {
      e.bladeGlow.material.color.setRGB(0.95, 0.13, 0.07);
      e.bladeGlow.material.opacity = 0.34 + strength * 0.5 + Math.sin(state.time * 22) * 0.12;
      e.bladeGlow.scale.setScalar(1.16 + Math.sin(state.time * 22) * 0.03);
    }
    if (!state.seenFierce) {
      state.seenFierce = true;
      showCombatCallout('避', 'UNBLOCKABLE · DASH THROUGH IT');
    }
    return;
  }

  const pulse = ready ? 0.88 + Math.sin(state.time * 30) * 0.12 : 1;
  if (ready) strength = 1;
  for (const material of e.bladeMats) {
    material.emissive.setScalar(strength * pulse);
    material.emissiveIntensity = ready ? 2.8 : 0.9;
  }
  if (e.bladeGlow) {
    e.bladeGlow.material.color.setRGB(1, 1, 1);   // reset after any fierce frame
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
    // and the fight deadlocks with everyone walking in circles. Archers orbit
    // at their firing range instead, far outside the melee crowd.
    const orbitRange = e.spec.bow ? e.spec.range : reach * 1.0;
    const strikeRange = reach * 1.25;

    // An archer's line is invisible except while it aims or fires.
    if (e.aimLine && e.state !== 'aim' && e.state !== 'loose') e.aimLine.material.opacity = 0;

    switch (e.state) {
      case 'approach': {
        move = e.speed;
        if (e.spec.bow) {
          if (dist < e.spec.range * 1.25) { e.state = 'circle'; e.t = 0; }
          break;
        }
        if (dist < strikeRange && e.cooldown <= 0 && requestSlot(e)) {
          e.state = 'windup'; e.t = 0; commitStrike(e);
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
          if (e.spec.bow) {
            // One arrow in the air at a time keeps the pressure legible.
            const anyAiming = enemies.some((x) => !x.dead && x.spec.bow
              && (x.state === 'aim' || x.state === 'loose'));
            if (!anyAiming && e.cooldown <= 0 && dist > 4.5 && dist < e.spec.range * 1.5) {
              e.state = 'aim';
              e.aimDir.set(nx, 0, nz);
            } else if (Math.random() < 0.3) {
              e.circleDir *= -1;
            }
          } else if (dist < strikeRange && e.cooldown <= 0 && requestSlot(e)) {
            e.state = 'windup'; commitStrike(e);
          } else if (dist > reach * 2.2) {
            e.state = 'approach';
          } else if (Math.random() < 0.3) {
            e.circleDir *= -1;
          }
        }
        break;
      }
      case 'aim': {
        // The draw: the line tracks the player, then locks with time to move
        // off it. Dodging the arrow is positional, not a parry read — though a
        // parry held on release still turns it away.
        turn = false;
        const k = Math.min(1, e.t / e.spec.windup);
        const locked = k >= 0.55;
        if (!locked) { e.aimDir.set(nx, 0, nz); turn = true; }
        const L = 17;
        const line = e.aimLine;
        line.position.set(pos.x + e.aimDir.x * L / 2, 0.06, pos.z + e.aimDir.z * L / 2);
        line.rotation.set(-Math.PI / 2, 0, Math.atan2(-e.aimDir.z, e.aimDir.x));
        line.scale.set(L, locked ? 0.16 : 0.34, 1);
        line.material.opacity = locked
          ? 0.42 + Math.sin(state.time * 26) * 0.16
          : 0.05 + k * 0.1;
        if (e.t >= e.spec.windup) {
          e.state = 'loose';
          e.t = 0;
          audio.swing(1);
          const px = p.x - pos.x, pz = p.z - pos.z;
          const along = px * e.aimDir.x + pz * e.aimDir.z;
          const across = Math.abs(px * e.aimDir.z - pz * e.aimDir.x);
          if (along > 0 && along < L && across < 0.6) {
            if (parryActive()) {
              // Deflected: rewarded like a read, not a perfect parry — but it
              // must LOOK like a win, so it gets the flash frame too.
              state.chainTimer = Math.max(state.chainTimer, FLOW_WINDOW);
              state.focus = Math.min(FOCUS_MAX, state.focus + 12 * flowMultiplier());
              vTmp.set(p.x, 1.2, p.z);
              spawnParryRing(vTmp);
              parryFlash();
              flash(0.7);
              hitstop(0.1, 0.1);
              shake(0.5);
              showCombatCallout('返', 'ARROW TURNED');
              audio.parry();
              updateHUD();
            } else if (state.invuln <= 0) {
              damagePlayer(e.damage, e);
            }
          }
        }
        break;
      }
      case 'loose': {
        // The release: the line flares to a tracer, then the archer resets.
        turn = false;
        const fade = Math.max(0, 1 - e.t / 0.14);
        e.aimLine.material.opacity = fade * 0.85;
        e.aimLine.scale.set(17, 0.1 + (1 - fade) * 0.22, 1);
        if (e.t >= 0.3) {
          e.state = 'circle';
          e.t = 0;
          e.cooldown = 2.6 + Math.random() * 1.6;
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
            commitStrike(e);
            // A grudge shortens the pause before the follow-up: the rival that
            // remembers you presses where a first meeting would breathe.
            e.t = Math.max(0, e.spec.windup - (e.grudge ? 0.32 : 0.24));
            e.circleDir *= -1;
          } else {
            e.rivalFollowup = false;
            releaseSlot(e);
            e.cooldown = e.rival ? (e.grudge ? 0.4 : 0.55) : 0.8 + Math.random() * 1.6;
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

  if (e.fierce) {
    // No parry answers this — a dash's i-frames are the only clean out. Meeting
    // vermilion with steel does not stop it; the parry attempt just eats the
    // hit, and the punish teaches the read.
    if (state.invuln > 0) {
      // Read and slipped it: the reward the parry cannot give against a fierce
      // strike. Cheaper than a perfect parry, but it keeps the aggression fed.
      state.focus = Math.min(FOCUS_MAX, state.focus + 12 * flowMultiplier());
      showCombatCallout('見切', 'READ · SLIPPED');
      updateHUD();
    } else {
      damagePlayer(e.damage, e);
    }
    return;
  }

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
    vTmp.y += 0.34;
    spawnParryRing(vTmp);
    spawnImpactBurst(player.root.position, e.rival ? 1.8 : 1.35);
    camPunch.x -= nx * 0.75;
    camPunch.z -= nz * 0.75;
    camPunch.y += 0.12;
    hitstop(0.19, 0.035);
    shake(0.78);
    flash(1);
    parryFlash();
    ink.splashScreen(3, 0.55);
    showCombatCallout('PERFECT', 'PARRY');
    audio.perfectParry();
    updateHUD();
    return;
  }

  if (state.invuln > 0) return;
  damagePlayer(e.damage, e);
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
  } else if (e.state === 'aim') {
    // The draw: bow raised, body turning side-on behind it.
    const k = Math.min(1, e.t / e.spec.windup);
    armX = -0.3 - 1.3 * k;
    torsoY = -0.4 * k;
  } else if (e.state === 'loose') {
    armX = -1.6 + Math.min(1, e.t / 0.2) * 1.2;
    torsoY = -0.4;
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
  // Without a cursor the frame biases toward where the samurai faces.
  if (input.touchActive) {
    vAim.set(p.x + Math.sin(state.facing) * 4, 0, p.z + Math.cos(state.facing) * 4);
  } else {
    aimPoint(vAim);
  }
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
    (Math.random() - 0.5) * shakeAmount * juiceScale,
    (Math.random() - 0.5) * shakeAmount * juiceScale,
    (Math.random() - 0.5) * shakeAmount * 0.5 * juiceScale,
  );
  camera.position.add(camShake);
  // Contact punch: a directed kick into the cut, unlike the undirected shake.
  // Decays on real time so hitstop doesn't freeze it mid-lurch.
  camPunch.multiplyScalar(Math.exp(-9 * dt));
  camera.position.addScaledVector(camPunch, juiceScale);
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
const combatStatusEl = document.getElementById('combatStatus');
const killsValueEl = document.getElementById('killsValue');
const waveValueEl = document.getElementById('waveValue');
const escapeStatEl = document.getElementById('escapeStat');
const escapeValueEl = document.getElementById('escapeValue');
const flowEl = document.getElementById('flow');
const flowValueEl = document.getElementById('flowValue');
const focusRateValueEl = document.getElementById('focusRateValue');
const flowChargeEl = document.getElementById('flowCharge');
const flowGhostEl = document.getElementById('flowGhost');
const flowPulseEl = document.getElementById('flowPulse');
const vitalsEl = document.getElementById('vitals');
const iaiReadyNoticeEl = document.getElementById('iaiReadyNotice');
const iaiNoticeTitleEl = document.getElementById('iaiNoticeTitle');
const iaiNoticeDetailEl = document.getElementById('iaiNoticeDetail');
let iaiWasReady = false;
let iaiNoticeTimer = 0;
let shownFlowChain = 0;
let flowGhostLevel = 0;

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
    audio.ready();
  } else if (!iaiReady && iaiWasReady) {
    clearTimeout(iaiNoticeTimer);
    iaiReadyNoticeEl.classList.remove('show');
  }
  iaiWasReady = iaiReady;
  killsValueEl.textContent = `${state.kills}`;
  waveValueEl.textContent = `${state.wave}`;
  escapeStatEl.hidden = !state.escapeCharges;
  escapeValueEl.textContent = `${state.escapeCharges}`;
  combatStatusEl.setAttribute('aria-label', `Wave ${state.wave}, ${state.kills} kills${state.escapeCharges ? `, ${state.escapeCharges} escapes` : ''}`);
  flowEl.classList.toggle('active', state.chain > 0);
  const tier = getFlowTier();
  for (let level = 1; level <= 3; level++) flowEl.classList.toggle(`tier-${level}`, tier === level);
  audio.setFlowTier(tier);
  const focusRate = flowMultiplier().toFixed(1);
  flowEl.classList.toggle('boosted', Number(focusRate) > 1);
  const previousShownTier = getFlowTier(shownFlowChain);
  if (state.chain > shownFlowChain) {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    flowPulseEl.getAnimations().forEach((animation) => animation.cancel());
    flowPulseEl.animate(
      reducedMotion
        ? [{ opacity: 0.72 }, { opacity: 0 }]
        : [
            { opacity: 0, transform: 'scaleX(0.25)' },
            { opacity: 0.9, transform: 'scaleX(1)' },
            { opacity: 0, transform: 'scaleX(1.2)' },
          ],
      { duration: reducedMotion ? 120 : 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
    if (tier > previousShownTier) {
      focusRateValueEl.getAnimations().forEach((animation) => animation.cancel());
      focusRateValueEl.animate(
        reducedMotion
          ? [{ opacity: 0.45 }, { opacity: 1 }]
          : [
              { opacity: 0.55, transform: 'scale(0.94)' },
              { opacity: 1, transform: 'scale(1.08)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
        { duration: reducedMotion ? 120 : 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      );
    }
  }
  shownFlowChain = state.chain;
  flowValueEl.textContent = `×${state.chain}`;
  focusRateValueEl.textContent = `×${focusRate}`;
  if (state.chain > 0) flowChargeEl.style.transform = `scaleX(${THREE.MathUtils.clamp(state.chainTimer / FLOW_WINDOW, 0, 1)})`;
  flowEl.setAttribute('aria-label', `Flow ${state.chain}, focus rate ${focusRate}`);
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
const skinPickerEl = document.getElementById('skinPicker');
const skinCurrentEl = document.getElementById('skinCurrent');
const skinButtons = [...document.querySelectorAll('.skinOption')];
const TITLE_LOGO = ovTitle.innerHTML;

// Legends beyond the wandering sword are earned, not chosen. Each is gated on a
// lifetime best the page already keeps, so no separate save is needed: cross
// the mark and the legend answers. MUSASHI is the blade you start with.
const SKIN_UNLOCKS = {
  hitokiri: { metric: 'wave', need: 5, label: 'REACH WAVE 5' },
  masamune: { metric: 'wave', need: 10, label: 'REACH WAVE 10' },
  mibu: { metric: 'flow', need: 20, label: 'HOLD A FLOW OF 20' },
};
const SKIN_META = Object.fromEntries(SAMURAI_SKINS.map((s) => [s.id, s]));

function isSkinUnlocked(id, records) {
  const req = SKIN_UNLOCKS[id];
  return !req || (records[req.metric] || 0) >= req.need;
}

// The nearest legend still to earn, chosen by how close it stands — the
// strongest "one more run" pull the page can show.
function nextLockedSkin(records) {
  let best = null, bestRatio = -1;
  for (const skin of SAMURAI_SKINS) {
    const req = SKIN_UNLOCKS[skin.id];
    if (!req || (records[req.metric] || 0) >= req.need) continue;
    const ratio = (records[req.metric] || 0) / req.need;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { id: skin.id, name: skin.name, label: req.label };
    }
  }
  return best;
}

// Grey and seal every legend not yet earned, and wear its requirement where its
// epithet would sit. Called whenever the picker is shown, from current records.
function renderSkinLocks(records) {
  for (const button of skinButtons) {
    const id = button.dataset.skin;
    const unlocked = isSkinUnlocked(id, records);
    button.classList.toggle('locked', !unlocked);
    button.disabled = !unlocked;
    button.setAttribute('aria-disabled', `${!unlocked}`);
    const small = button.querySelector('.skinCopy small');
    if (small) small.textContent = unlocked ? SKIN_META[id].epithet : SKIN_UNLOCKS[id].label;
  }
}

function selectSkin(skinId, { persist = true } = {}) {
  if (!isSkinUnlocked(skinId, loadRecords())) skinId = selectedSkinId || 'musashi';
  const skin = applySamuraiSkin(player, skinId);
  selectedSkinId = skin.id;
  document.documentElement.dataset.skin = skin.id;
  skinCurrentEl.textContent = `${skin.name} · ${skin.epithet}`;
  for (const button of skinButtons) {
    const selected = button.dataset.skin === skin.id;
    button.setAttribute('aria-pressed', `${selected}`);
    button.tabIndex = selected ? 0 : -1;
  }
  if (persist) {
    try { localStorage.setItem(SKIN_STORAGE_KEY, skin.id); } catch { /* private storage can fail */ }
  }
  return skin;
}

for (const button of skinButtons) {
  button.addEventListener('click', () => selectSkin(button.dataset.skin));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    // Arrow through earned legends only; sealed ones are skipped, not landed on.
    const usable = skinButtons.filter((b) => isSkinUnlocked(b.dataset.skin, loadRecords()));
    const current = usable.indexOf(button);
    if (current === -1) return;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? usable.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + usable.length) % usable.length;
    selectSkin(usable[next].dataset.skin);
    usable[next].focus();
  });
}
// A persisted choice can outlive its unlock (records cleared, or an old save):
// fall back to the starting blade so the samurai never wears a sealed legend.
if (!isSkinUnlocked(selectedSkinId, loadRecords())) selectedSkinId = 'musashi';
selectSkin(selectedSkinId, { persist: false });

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

// The grudge: when a named rival kills the samurai, the page remembers the
// debt across runs. The next time that name walks on, its introduction — and
// its temper — are different, until the debt is settled with its death.
function loadGrudge() {
  try { return localStorage.getItem('samurai-grudge') || ''; } catch { return ''; }
}
function saveGrudge(name) {
  try { localStorage.setItem('samurai-grudge', name); } catch { /* ignore */ }
}
function clearGrudge() {
  try { localStorage.removeItem('samurai-grudge'); } catch { /* ignore */ }
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
  ovText.innerHTML = 'One blade against a page that remembers every wound.<br />Read the white steel. Break the line. Leave only ink.';
  const chaseLines = [];
  if (records.wave > 0) {
    chaseLines.push(`BEST · WAVE <b>${records.wave}</b> · ${records.kills} KILLS · ${records.parries} PERFECT PARRIES`);
  }
  // A standing grudge fires the hook before the run starts, not five waves in.
  const grudge = loadGrudge();
  if (grudge) {
    const names = ['KUROGANE', 'AKATSUKI', 'SHIROGANE', 'MURASAME'];
    const wave = (names.indexOf(grudge) + 1) * 5;
    chaseLines.push(`GRUDGE · <b>${grudge}</b> WAITS AT WAVE ${wave}`);
  }
  // The next legend to earn: shown before the run so the goal is already in mind.
  const nextSkin = nextLockedSkin(records);
  if (nextSkin) chaseLines.push(`NEXT LEGEND · <b>${nextSkin.name}</b> — ${nextSkin.label}`);
  ovChase.hidden = chaseLines.length === 0;
  ovChase.innerHTML = chaseLines.join('<br />');
  renderLedger(ledger);
  renderSkinLocks(records);
  skinPickerEl.hidden = false;
  ovBtn.textContent = 'DRAW THE BLADE';
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
    `${numberWord(w)} waves, the page near black`,
    `${numberWord(w)} waves of careful cutting`,
  ];

  // Line two: the death itself, in the killer's shape.
  const who = info.rival ? info.rival.toLowerCase() : '';
  const deaths = {
    ronin: ['a straw hat’s patient answer', 'one plain cut from a plain man'],
    hunter: ['the quick one wrote faster', 'a hunter’s short reply'],
    yari: ['the spear i never saw', 'reach i did not respect'],
    yumi: ['the arrow i heard too late', 'a string sang once, far off'],
    brute: ['the slow blade fell anyway', 'weight enough to close a book'],
    oni: who
      ? [`${who} signed the page for me`, `${who}’s answer was iron`]
      : ['the iron demon signed his name', 'horns against a paper sky'],
  }[info.type] || ['no blade, only my own haste', 'the field itself grew teeth'];
  const caught = {
    dash: 'caught between two footfalls',
    attack: 'my own cut left the door open',
    parry: 'a breath behind the steel',
    iai: 'cut down mid-draw, sword half-born',
  }[info.action];
  if (caught) deaths.push(caught);
  if (who && loadGrudge() === info.rival) deaths.push(`twice now, ${who}`);

  // Line three: what the page keeps.
  const closings = [];
  if (record) closings.push('furthest yet, dry it, turn the sheet', 'a new high-water mark of ink');
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
    'ONISOLO: THE PAGE REMEMBERS',
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
  state.slowmo = 0;   // never carry an in-progress iai slow-mo into the death freeze
  updateHUD();
  ink.splashScreen(20, 2.2);
  // The print ends rather than fading: the final frame holds near-frozen for a
  // long beat — grain, weave and flicker all stop with it — while the music is
  // pulled out and only the wind is left. The overlay waits for the silence.
  hitstop(1.1, 0.02);
  audio.setWind(0.12);
  audio.setMusicIntensity(0);
  audio.silenceMusic(1.3, 0.001);
  audio.defeat();
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
  if (state.wave > prevBestWave) chase = `NEW BEST: WAVE <b>${state.wave}</b>`;
  else if (prevBestWave === 0) chase = 'FIRST BLOOD ON THE PAGE';
  else if (state.wave === prevBestWave) chase = `YOU MATCHED YOUR BEST: WAVE <b>${prevBestWave}</b>`;
  else {
    const short = prevBestWave - state.wave;
    chase = `${short} WAVE${short === 1 ? '' : 'S'} SHORT OF YOUR BEST: WAVE <b>${prevBestWave}</b>`;
  }

  // Legends earned this run, or the nearest one still sealed — the second hook
  // under the chase line. A newly-earned legend is the loudest reason to return.
  const chaseLines = [chase];
  const earned = SAMURAI_SKINS.filter(
    (s) => isSkinUnlocked(s.id, newRecords) && !isSkinUnlocked(s.id, records),
  );
  if (earned.length) {
    chaseLines.push(`NEW LEGEND · <b>${earned.map((s) => s.name).join(' · ')}</b> ANSWERS THE PAGE`);
  } else {
    const nextSkin = nextLockedSkin(newRecords);
    if (nextSkin) chaseLines.push(`NEXT LEGEND · <b>${nextSkin.name}</b> — ${nextSkin.label}`);
  }

  // Compose the poem before recording the new grudge, so a repeat killing by
  // the same rival can read as one ("twice now") — then the debt is written.
  lastPoem = composeDeathPoem(record);
  if (state.deathInfo && state.deathInfo.rival) saveGrudge(state.deathInfo.rival);

  setTimeout(() => {
    overlay.classList.remove('intro');
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
    ovChase.innerHTML = chaseLines.join('<br />');
    renderLedger(ledger);
    skinPickerEl.hidden = true;
    ovBtn.textContent = 'DRAW AGAIN';
    ovDaily.hidden = true;
    ovShare.hidden = false;
    ovShare.textContent = 'COPY RESULT';
    overlay.classList.remove('hidden');
    input.enabled = false;
  }, 1200);
}

let beginPending = false;
function beginGame(opts = {}) {
  if (state.running || beginPending) return;
  run.daily = Boolean(opts.daily);
  run.dateStr = todayStamp();
  run.rng = run.daily ? mulberry32(dateSeed(run.dateStr)) : Math.random;
  audio.start();
  audio.begin();

  const commit = () => {
    beginPending = false;
    overlay.classList.remove('leaving');
    overlay.classList.add('hidden');
    input.enabled = true;
    if (state.over) {
      try { sessionStorage.setItem('samurai-restart', run.daily ? 'daily' : 'normal'); } catch { /* ignore */ }
      location.reload();
      return;
    }
    state.running = true;
    state.waveBreak = 1.2;
    updateHUD();
  };

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (opts.instant || reduceMotion) {
    commit();
    return;
  }
  beginPending = true;
  overlay.classList.add('leaving');
  setTimeout(commit, 220);
}

ovBtn.addEventListener('click', () => beginGame());
ovDaily.addEventListener('click', () => beginGame({ daily: true }));
ovShare.addEventListener('click', copyResult);
addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !state.running) beginGame({ instant: true });
});

// ------------------------------------------------------------- pause & settings

const muteBtn = document.getElementById('muteBtn');
const pauseBtn = document.getElementById('pauseBtn');
const pauseScreen = document.getElementById('pauseScreen');
const pauseResume = document.getElementById('pauseResume');
const pauseMute = document.getElementById('pauseMute');
const pauseShake = document.getElementById('pauseShake');
const pauseQuit = document.getElementById('pauseQuit');

let paused = false;

function canPause() {
  return state.running && !state.over && !state.choosingUpgrade;
}

function setPaused(p) {
  if (p === paused || (p && !canPause())) return;
  paused = p;
  pauseScreen.classList.toggle('show', p);
  pauseScreen.setAttribute('aria-hidden', p ? 'false' : 'true');
  document.body.classList.toggle('paused', p);
  audio.setPaused(p);
  input.enabled = !p;          // pointer actions ignore input while paused
  input.keys.clear();
  for (const k in input.buffers) input.buffers[k] = 0;   // nothing queued fires on resume
}
function togglePause() { setPaused(!paused); }

function applyMuteUI() {
  muteBtn.classList.toggle('muted', settings.muted);
  muteBtn.setAttribute('aria-pressed', String(settings.muted));
  muteBtn.setAttribute('aria-label', settings.muted ? 'Unmute' : 'Mute');
  pauseMute.setAttribute('aria-pressed', String(settings.muted));
  pauseMute.querySelector('.optState').textContent = settings.muted ? 'MUTED' : 'ON';
}
function applyShakeUI() {
  pauseShake.setAttribute('aria-pressed', String(settings.reduceShake));
  pauseShake.querySelector('.optState').textContent = settings.reduceShake ? 'REDUCED' : 'FULL';
}
function toggleMute() {
  settings.muted = !settings.muted;
  audio.setMuted(settings.muted);
  saveSettings();
  applyMuteUI();
}
function toggleReduceShake() {
  settings.reduceShake = !settings.reduceShake;
  applyJuice();
  saveSettings();
  applyShakeUI();
}

muteBtn.addEventListener('click', toggleMute);
pauseBtn.addEventListener('click', togglePause);
pauseMute.addEventListener('click', toggleMute);
pauseShake.addEventListener('click', toggleReduceShake);
pauseResume.addEventListener('click', () => setPaused(false));
pauseQuit.addEventListener('click', () => { setPaused(false); location.reload(); });

addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (paused || canPause()) { e.preventDefault(); togglePause(); }
  }
});
// Coming back to a hidden tab mid-fight should find the duel held, not lost.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && canPause()) setPaused(true);
});

loadSettings();
audio.setMuted(settings.muted);   // stored now; applied when the context starts
applyMuteUI();
applyShakeUI();

// A fresh run's title screen, and the snappy path back in after a defeat: if
// DRAW AGAIN reloaded the page, drop straight into a new run in the same mode.
// The installed game keeps working offline. Skipped on localhost so the dev
// loop never fights a cache; deploy.mjs stamps the worker per build.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* optional */ });
  });
}

renderTitleScreen();
try {
  const restart = sessionStorage.getItem('samurai-restart');
  if (restart) {
    sessionStorage.removeItem('samurai-restart');
    beginGame({ daily: restart === 'daily', instant: true });
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
// second event when it comes back — which would leave the canvas stuck. On
// phones this same loop absorbs rotation: the browser reports dimensions late
// and in several steps, and the frame after they settle repairs the layout.
function checkResize() {
  const { w, h } = viewportSize();
  if (w < 2 || h < 2) return;
  if (w !== sizedW || h !== sizedH) onResize();
}

addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 120));
if (window.visualViewport) visualViewport.addEventListener('resize', onResize);
onResize();

// ------------------------------------------------------------------ the loop

let last = performance.now();

// One simulation tick. Separated from the rAF callback so it can be driven at a
// fixed rate for testing, independent of how the browser schedules frames.
function step(dt) {
  // Hitstop runs on real time; everything else runs on scaled time. A hard
  // freeze (hitstop) pins the scale for its whole duration; outside it, time
  // eases toward the current target — 1, or the slowmo scale while a sustained
  // slow-motion beat is running (the iai draw holds its breath this way).
  if (state.slowmo > 0) state.slowmo -= dt;
  const timeTarget = state.slowmo > 0 ? state.slowmoScale : 1;
  if (state.hitstop > 0) {
    state.hitstop -= dt;
    // A freeze that releases straight into slow-motion should land on the
    // slowmo scale, not snap to full speed and then re-slow.
    if (state.hitstop <= 0) state.timeScale = timeTarget;
  } else {
    state.timeScale += (timeTarget - state.timeScale) * Math.min(1, dt * 12);
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
  updateDashWakes(dt);
  ragdolls.update(sdt);
  gibs.update(sdt, ink);
  ink.update(sdt, camera, dt);
  world.update(player.root.position);
  audio.setRustle(world.ambience.rustle);

  const bossWave = state.running && state.wave % 5 === 0 && enemies.some((e) => e.type === 'oni');
  const act = currentAct();
  rain.update(sdt, player.root.position, Math.max(bossWave ? 1 : 0, state.running ? act.rain : 0));
  audio.setWind(bossWave ? 0.13 : 0.05 + (state.running ? act.wind : 0));
  const musicPressure = state.running
    ? Math.min(1, 0.12 + enemies.length * 0.07 + state.chain * 0.025 + (bossWave ? 0.25 : 0))
    : 0;
  audio.setMusicIntensity(musicPressure, bossWave);

  updateCamera(dt);
  updateIaiAura();
  updateFlowOutline(dt);

  // Film grain gets heavier as the samurai weakens — the print degrades with them.
  const hurtK = 1 - Math.max(0, state.hp) / PLAYER_MAX_HP;
  const flowK = Math.min(1, state.chain / 15);
  // On death the print is crushed rather than faded: contrast and vignette
  // climb on real time while scaled time stands still, so the held final frame
  // visibly hardens into its last image.
  deathCrush += ((state.over ? 1 : 0) - deathCrush) * Math.min(1, dt * 5);
  film.uniforms.uGrain.value = 0.05 + hurtK * 0.06 + act.grain;
  film.uniforms.uVignette.value = 0.32 + hurtK * 0.45 + flowK * 0.05 + deathCrush * 0.3 + act.vig;
  film.uniforms.uContrast.value = 1.42 + hurtK * 0.25 + flowK * 0.10 + deathCrush * 0.55 + act.con;
  whiteFlash *= Math.exp(-9 * dt);
  film.uniforms.uWhite.value = whiteFlash * (settings.reduceShake ? 0.6 : 1);
  invertT = Math.max(0, invertT - dt);
  film.uniforms.uInvert.value = invertT > 0 ? 1 : 0;
  film.updateFilm(state.time);

  film.render(scene, camera);
}

function frame(now) {
  requestAnimationFrame(frame);
  checkResize();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) return;   // hold the last frame under the pause screen
  step(dt);
}

requestAnimationFrame(frame);

// Exposed for tuning and for driving the simulation from the console:
// `__samurai.step(1/60)`, `__samurai.film.uniforms`, `__samurai.state`.
window.__samurai = {
  version: GAME_VERSION,
  film, scene, camera, state, ink, ragdolls, input, player, step, audio, world,
  trail, enemyTrail, iaiTrail,
  getFlowTier, addFlow, breakFlow, SAMURAI_SKINS, selectSkin,
  get selectedSkin() { return selectedSkinId; },
  beginGame, startWave, spawnEnemy, gameOver, damagePlayer, killEnemy,
  setPaused, togglePause, toggleMute, toggleReduceShake, settings,
  get paused() { return paused; },
  get juiceScale() { return juiceScale; },
  get enemies() { return enemies; },
};
