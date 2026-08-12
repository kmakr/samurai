import * as THREE from 'three';
import { FilmRenderer, applyLetterbox } from './render.js';
import { InkSystem } from './ink.js';
import { buildWorld, ARENA, Dust, Rain } from './world.js';
import { makeSamurai, makeEnemy, ENEMY_TYPES, animateLocomotion } from './actors.js';
import { SlashTrail } from './trail.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { RagdollSystem } from './ragdoll.js';

// ---------------------------------------------------------------- constants

const PLAYER_SPEED = 7.6;
const PLAYER_MAX_HP = 100;
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

// ------------------------------------------------------------------- setup

const app = document.getElementById('app');
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
const dust = new Dust(scene);
const rain = new Rain(scene);
const WORLD_BOUND = 1e9;   // the page never ends
const ink = new InkSystem(scene, WORLD_BOUND);
const ragdolls = new RagdollSystem(scene, ink, WORLD_BOUND);
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
  wave: 0,
  focus: 0,
  time: 0,
  timeScale: 1,
  hitstop: 0,
  phase: 0,          // gait phase
  vel: new THREE.Vector3(),
  facing: 0,
  action: 'idle',    // idle | attack | dash | parry | hurt
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
};

let enemies = [];

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
function flash(v) { whiteFlash = Math.max(whiteFlash, v); }

// -------------------------------------------------------------------- waves

function waveComposition(n) {
  const list = [];
  const ronin = 2 + Math.floor(n * 0.9);
  const hunters = n >= 2 ? Math.floor(n * 0.7) : 0;
  const brutes = n >= 4 ? Math.floor((n - 2) / 3) : 0;
  for (let i = 0; i < ronin; i++) list.push('ronin');
  for (let i = 0; i < hunters; i++) list.push('hunter');
  for (let i = 0; i < brutes; i++) list.push('brute');
  if (n % 5 === 0) list.push('oni');
  return list;
}

function spawnEnemy(type) {
  const spec = ENEMY_TYPES[type];
  const a = Math.random() * Math.PI * 2;
  const r = 13 + Math.random() * 6;
  const actor = makeEnemy(type);
  actor.baseHipY = actor.hips.position.y;
  actor.root.position.set(
    player.root.position.x + Math.cos(a) * r,
    0,
    player.root.position.z + Math.sin(a) * r,
  );
  scene.add(actor.root);

  // The blade brightens during a wind-up; that flash is the player's only
  // warning, so it is worth wiring up explicitly.
  const bladeMats = [];
  actor.katana.traverse((o) => { if (o.isMesh && o.material.isMeshToonMaterial) bladeMats.push(o.material); });

  const scale = 1 + state.wave * 0.06;
  enemies.push({
    type, spec, actor, bladeMats,
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
    flashT: 0,
  });
}

function startWave() {
  state.wave++;
  state.slots = Math.min(4, 2 + Math.floor(state.wave / 4));
  for (const type of waveComposition(state.wave)) spawnEnemy(type);
  audio.taiko(state.wave % 5 === 0 ? 58 : 82, 0.55);
  showWaveTitle(state.wave);
  updateHUD();
}

const waveTitleEl = document.getElementById('waveTitle');
function showWaveTitle(n) {
  const boss = n % 5 === 0;
  waveTitleEl.innerHTML = boss
    ? `<span class="kanji">鬼</span><span class="latin">WAVE ${n} — ONI</span>`
    : `<span class="kanji">${numberKanji(n)}</span><span class="latin">WAVE ${n}</span>`;
  waveTitleEl.classList.remove('show');
  void waveTitleEl.offsetWidth; // restart the animation
  waveTitleEl.classList.add('show');
}

function numberKanji(n) {
  const d = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return d[n];
  if (n < 20) return n === 10 ? '十' : `十${d[n % 10]}`;
  return `${d[Math.floor(n / 10)]}十${n % 10 ? d[n % 10] : ''}`;
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
    damageEnemy(e, cfg.damage, cx / cl, cz / cl,
      state.comboIndex === 2 ? 'bisect' : 'limb');
  }

  if (hitAny) {
    hitstop(state.comboIndex === 2 ? 0.12 : 0.06, 0.06);
    shake(state.comboIndex === 2 ? 0.7 : 0.35);
    // The camera bites forward along the cut — contact should be felt in the
    // frame, not just heard.
    camPunch.x += fx * (0.5 + overhead * 0.4);
    camPunch.z += fz * (0.5 + overhead * 0.4);
    camPunch.y -= 0.16;
    audio.hit();
  }
}

function damageEnemy(e, amount, dirX, dirZ, severity = 'limb') {
  e.hp -= amount;
  e.stagger = Math.max(e.stagger, 0.22);
  const p = e.actor.root.position;
  const h = 0.9 * e.spec.height;

  if (e.hp <= 0) {
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
  audio.kill();

  state.kills++;
  state.focus = Math.min(FOCUS_MAX, state.focus + (big ? 20 : 9));

  // Hand the body to the physics: it keeps the pose it died in, and the blow
  // decides how much of it stays attached.
  vCut.set(dirX, 0, dirZ);
  ragdolls.spawn(e.actor, e.spec, vCut, severity);
  enemies = enemies.filter((x) => x !== e);
  updateHUD();
}

function damagePlayer(amount) {
  if (state.invuln > 0 || state.over) return;
  state.hp -= amount;
  state.invuln = 0.55;
  state.focus = Math.max(0, state.focus - 18);
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
  if (state.hp <= 0) gameOver();
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

// ---------------------------------------------------------------------- iai

let iaiT = 0;
const iaiTrail = new SlashTrail(scene, { radius: 6.5, width: 5.0, sweep: 1.5 });

function tryIai() {
  if (state.focus < FOCUS_MAX || iaiT > 0 || !state.running) return;
  state.focus = 0;
  iaiT = 0.9;
  state.invuln = Math.max(state.invuln, 1.0);
  flash(1);
  audio.iai();

  const fx = Math.sin(state.facing), fz = Math.cos(state.facing);
  const px = player.root.position.x, pz = player.root.position.z;

  // Everything in a long corridor ahead is cut down at once.
  for (const e of [...enemies]) {
    const dx = e.actor.root.position.x - px;
    const dz = e.actor.root.position.z - pz;
    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * fz - dz * fx);
    if (along > -1 && along < 30 && across < 4.2) {
      damageEnemy(e, 9999, fx, fz, 'bisect');
    }
  }

  // The flash-step: the samurai finishes the cut well past where they started.
  const dist = Math.min(9, 4 + enemies.length * 0.3);
  player.root.position.x = px + fx * dist;
  player.root.position.z = pz + fz * dist;

  vTmp.copy(player.root.position); vTmp.y = 0.2;
  iaiTrail.fire(vTmp, state.facing + Math.PI * 0.5, { duration: 0.75, scale: 1.4 });
  ink.splashScreen(14, 1.8);
  hitstop(0.22, 0.05);
  shake(1.3);
  updateHUD();
}

// ------------------------------------------------------------- player update

function updatePlayer(dt) {
  state.facing = aimYaw();

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
      state.parryCooldown = PARRY_COOLDOWN + PARRY_STARTUP + PARRY_ACTIVE + PARRY_RECOVER;
    } else if (input.take('dash') && state.dashCooldown <= 0) {
      state.action = 'dash';
      state.actionT = 0;
      state.dashCooldown = DASH_TIME + DASH_COOLDOWN;
      state.dashDir.copy(moving ? vMove : vTmp.set(Math.sin(state.facing), 0, Math.cos(state.facing)));
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
    if (state.actionT >= PARRY_STARTUP + PARRY_ACTIVE + PARRY_RECOVER) {
      state.action = 'idle'; state.actionT = 0;
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
  state.phase += dt * (blend ? 11 : 2.2);
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
  audio.swing();
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
        scale: state.comboIndex === 2 ? 1.25 : 1,
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
    const k = THREE.MathUtils.clamp(state.actionT / (PARRY_STARTUP + PARRY_ACTIVE), 0, 1);
    armX = -2.5 * Math.min(1, k * 4);
    armZ = 0.9;
    torsoY = 0.35;
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
  && state.actionT < PARRY_STARTUP + PARRY_ACTIVE;

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
    if (e.flashT > 0) {
      e.flashT -= dt;
      const v = Math.max(0, e.flashT / 0.12);
      for (const m of e.bladeMats) m.emissive.setScalar(v);
    }

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
          for (const m of e.bladeMats) m.emissive.setScalar(1);
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
            for (const m of e.bladeMats) m.emissive.setScalar(1);
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
          for (const m of e.bladeMats) m.emissive.setScalar(0);
          vTmp.copy(pos); vTmp.y = 0.1;
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
          releaseSlot(e);
          e.cooldown = 0.8 + Math.random() * 1.6;
          e.state = dist > reach * 1.6 ? 'approach' : 'circle';
          e.t = 0;
        }
        break;
      }
      case 'stagger': {
        if (e.t >= 0.3) { e.state = 'circle'; e.t = 0; e.cooldown = Math.max(e.cooldown, 0.4); }
        break;
      }
    }

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
    // Deflection: the whole point of the defensive game.
    e.state = 'stagger';
    e.t = 0;
    e.stagger = 1.0;
    e.cooldown = 1.4;
    releaseSlot(e);
    state.focus = Math.min(FOCUS_MAX, state.focus + 34);
    const pos = e.actor.root.position;
    ink.spray(pos.x, 1.4 * e.spec.height, pos.z, 6, { dirX: -nx, dirZ: -nz, force: 0.7 });
    e.actor.root.position.x -= nx * 1.2;
    e.actor.root.position.z -= nz * 1.2;
    hitstop(0.13, 0.05);
    shake(0.6);
    flash(0.55);
    audio.parry();
    updateHUD();
    return;
  }

  if (state.invuln > 0) return;
  damagePlayer(e.spec.damage);
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
const focusFillEl = document.getElementById('focusFill');
const statsEl = document.getElementById('stats');
const focusWrapEl = document.getElementById('focusWrap');

function updateHUD() {
  hpFillEl.style.transform = `scaleX(${Math.max(0, state.hp) / PLAYER_MAX_HP})`;
  focusFillEl.style.transform = `scaleX(${state.focus / FOCUS_MAX})`;
  focusWrapEl.classList.toggle('ready', state.focus >= FOCUS_MAX);
  statsEl.textContent = `斬 ${state.kills}   波 ${state.wave}`;
}

const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('ovTitle');
const ovText = document.getElementById('ovText');
const ovBtn = document.getElementById('ovBtn');

function gameOver() {
  if (state.over) return;
  state.over = true;
  state.running = false;
  ink.splashScreen(20, 2.2);
  hitstop(0.5, 0.05);
  audio.setWind(0.12);
  setTimeout(() => {
    ovTitle.textContent = '死';
    ovText.innerHTML = `A LIFE ENDS ON THE PAGE<br><b>${state.kills} SLAIN · WAVE ${state.wave}</b>`;
    ovBtn.textContent = 'AGAIN 再び';
    overlay.classList.remove('hidden');
    input.enabled = false;
  }, 900);
}

function beginGame() {
  overlay.classList.add('hidden');
  input.enabled = true;
  audio.start();
  if (state.over) { location.reload(); return; }
  state.running = true;
  state.waveBreak = 1.2;
  updateHUD();
}

ovBtn.addEventListener('click', beginGame);
addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !state.running) beginGame();
});

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
    updatePlayer(sdt);
    updateEnemies(sdt);

    if (state.waveBreak > 0) {
      state.waveBreak -= sdt;
      if (state.waveBreak <= 0) startWave();
    } else if (enemies.length === 0) {
      state.waveBreak = 3.0;
    }
  } else if (!state.over) {
    // Idle breathing on the title screen.
    animateLocomotion(player, state.phase, 0, state.time);
  }

  if (iaiT > 0) iaiT -= dt;
  iaiTrail.update(sdt);
  trail.update(sdt);
  enemyTrail.update(sdt);
  ragdolls.update(sdt);
  ink.update(sdt, camera);
  world.update(player.root.position);
  dust.update(sdt, camera.position);

  const bossWave = state.running && state.wave % 5 === 0 && enemies.some((e) => e.type === 'oni');
  rain.update(sdt, player.root.position, bossWave ? 1 : 0);
  audio.setWind(bossWave ? 0.13 : 0.05);

  updateCamera(dt);

  // Film grain gets heavier as the samurai weakens — the print degrades with them.
  const hurtK = 1 - Math.max(0, state.hp) / PLAYER_MAX_HP;
  film.uniforms.uGrain.value = 0.085 + hurtK * 0.10;
  film.uniforms.uVignette.value = 0.32 + hurtK * 0.45;
  film.uniforms.uContrast.value = 1.42 + hurtK * 0.25;
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
  version: 5,
  world,
  film, scene, camera, state, ink, ragdolls, input, player, step,
  get enemies() { return enemies; },
};
