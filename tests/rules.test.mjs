import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACK,
  DASHCUT,
  NODACHI_COMBO,
  PARRY_STARTUP,
  THRUST,
  attackSpecFor,
  dashFollowupFor,
  parryDurationFor,
  parryWindowActive,
  weaponComboFor,
} from '../src/combat.js';
import {
  MAX_WAVE_ENEMIES,
  attackSlotsForWave,
  enemyScalingForWave,
  isRivalWave,
  waveComposition,
} from '../src/waves.js';
import {
  WAVE_EVENT,
  WaveDirector,
  buildWavePlan,
  rivalNameForWave,
  shuffleWithRng,
} from '../src/wave-director.js';
import { FrameProfiler, percentile } from '../src/profiler.js';
import { PlayerController } from '../src/player-controller.js';
import { CombatSystem } from '../src/combat-system.js';
import { EnemyDirector } from '../src/enemy-director.js';
import { FixedStepClock } from '../src/simulation-clock.js';
import {
  DEFAULT_GIB_POOL,
  INK_LIMITS,
  RAGDOLL_LIMITS,
  TRANSIENT_EFFECT_LIMITS,
  pushBounded,
} from '../src/bounded-pool.js';
import {
  EMPTY_RECORDS,
  RunRecordsStore,
  mergeRecords,
  normalizeRecords,
} from '../src/run-records.js';
import {
  isSkinUnlocked,
  isWeaponUnlocked,
  newlyUnlockedSkins,
  nextLockedSkin,
} from '../src/unlocks.js';
import { RUN_START, RunFlow, resetRunState } from '../src/run-flow.js';

const counts = (entries) => entries.reduce((result, type) => {
  result[type] = (result[type] || 0) + 1;
  return result;
}, {});

test('early waves introduce silhouettes in their authored order', () => {
  assert.deepEqual(counts(waveComposition(1)), { ronin: 2 });
  assert.deepEqual(counts(waveComposition(3)), { ronin: 3, hunter: 1, yari: 1 });
  assert.deepEqual(counts(waveComposition(4)), { ronin: 4, hunter: 2, yari: 1, brute: 1 });
  assert.deepEqual(counts(waveComposition(5)), {
    ronin: 5, hunter: 2, yari: 1, brute: 1, oni: 1,
  });
});

test('late waves stay within the field budget and retain rivals', () => {
  for (let wave = 1; wave <= 500; wave++) {
    const composition = waveComposition(wave);
    assert.ok(composition.length <= MAX_WAVE_ENEMIES, `wave ${wave} exceeded the cap`);
    assert.equal(composition.includes('oni'), isRivalWave(wave));
  }
});

test('pressure and scaling curves retain their caps', () => {
  assert.equal(attackSlotsForWave(1), 1);
  assert.equal(attackSlotsForWave(2), 2);
  assert.equal(attackSlotsForWave(9), 5);
  assert.equal(attackSlotsForWave(500), 5);
  assert.deepEqual(enemyScalingForWave(10), { hp: 1.5, damage: 1.4 });
});

test('weapon and dash attack selection stays deterministic', () => {
  assert.equal(weaponComboFor('iai'), ATTACK);
  assert.equal(weaponComboFor('tsunami'), NODACHI_COMBO);
  assert.equal(attackSpecFor('thrust', 0, 'iai'), THRUST);
  assert.equal(attackSpecFor('dashcut', 0, 'iai'), DASHCUT);
  assert.equal(attackSpecFor('arc', 2, 'iai'), ATTACK[2]);
  assert.equal(dashFollowupFor(0, 1, 0), 'thrust');
  assert.equal(dashFollowupFor(1, 0, 0), 'dashcut');
});

test('parry window includes startup boundary and excludes its end', () => {
  const duration = parryDurationFor(3);
  assert.equal(duration, 0.345);
  assert.equal(parryWindowActive('idle', PARRY_STARTUP, 3), false);
  assert.equal(parryWindowActive('parry', PARRY_STARTUP - 0.001, 3), false);
  assert.equal(parryWindowActive('parry', PARRY_STARTUP, 3), true);
  assert.equal(parryWindowActive('parry', PARRY_STARTUP + duration, 3), false);
});

test('wave plans own rival metadata and seeded spawn layout', () => {
  const sequence = (...values) => {
    let index = 0;
    return () => values[index++ % values.length];
  };
  const values = [0.1, 0.2, 0.3, 0.4];
  const first = buildWavePlan(5, {
    rng: sequence(...values), grudgeName: rivalNameForWave(5),
  });
  const again = buildWavePlan(5, {
    rng: sequence(...values), grudgeName: rivalNameForWave(5),
  });

  assert.deepEqual(first, again);
  assert.equal(first.rivalName, 'KUROGANE');
  assert.equal(first.grudge, true);
  assert.equal(first.enemies.at(-1).type, 'oni');
  assert.equal(first.enemies.at(-1).delay, 0.08);
  assert.ok(first.enemies.every((enemy) => enemy.radius >= 13 && enemy.radius <= 19));
  assert.deepEqual(
    shuffleWithRng(['mind', 'wind', 'edge'], sequence(...values)),
    shuffleWithRng(['mind', 'wind', 'edge'], sequence(...values)),
  );
});

test('wave director owns clear, upgrade, and next-wave transitions', () => {
  const state = {
    wave: 0, waveBreak: 0, slots: 2,
    pendingUpgrade: false, choosingUpgrade: false,
  };
  const director = new WaveDirector(state, { rng: () => 0.5 });
  director.reset();

  assert.equal(director.tick(0.6, 0), null);
  assert.equal(director.tick(0.6, 0), WAVE_EVENT.START);
  assert.equal(director.startNextWave().wave, 1);
  assert.equal(state.slots, 1);

  assert.equal(director.tick(0.1, 0), null);
  assert.equal(state.pendingUpgrade, true);
  assert.equal(state.waveBreak, 2.6);
  assert.equal(director.tick(2.6, 0), WAVE_EVENT.UPGRADE);

  director.beginUpgrade();
  assert.equal(director.tick(10, 0), null);
  director.finishUpgrade();
  assert.equal(director.tick(1.1, 0), WAVE_EVENT.START);
  assert.equal(director.startNextWave().wave, 2);
  assert.equal(state.slots, 2);
});

test('frame profiler reports stable pacing and simulation statistics', () => {
  const profiler = new FrameProfiler({ maxSamples: 3, publishEvery: 1 });
  profiler.record({ frameMs: 16, costMs: 2, timeScale: 1, steps: 1, action: 'idle', playerX: 0, playerZ: 0 });
  profiler.record({ frameMs: 18, costMs: 3, timeScale: 0.1, steps: 2, action: 'dash', playerX: 1, playerZ: 0 });
  profiler.record({ frameMs: 30, costMs: 7, timeScale: 1, steps: 1, action: 'attack', playerX: 2, playerZ: 0 });
  profiler.record({ frameMs: 20, costMs: 4, timeScale: 1, steps: 1, action: 'idle', playerX: 3, playerZ: 4 });
  assert.equal(profiler.totalSamples, 4);

  assert.equal(percentile([30, 16, 20], 0.5), 20);
  assert.deepEqual(profiler.summary({ enemies: 4 }), {
    samples: 3,
    frameMean: 68 / 3,
    frameP95: 30,
    frameP99: 30,
    frameMax: 30,
    costMean: 14 / 3,
    costP95: 7,
    costP99: 7,
    costMax: 7,
    over25ms: 1,
    hitstopFrames: 1,
    minTimeScale: 0.1,
    stepMean: 4 / 3,
    stepMax: 2,
    actionFrames: { dash: 1, attack: 1, idle: 1 },
    movementSpan: Math.sqrt(20),
    enemies: 4,
  });
});

test('fixed-step clock produces deterministic ticks and caps catch-up', () => {
  const clock = new FixedStepClock({ fixedDt: 0.01, maxFrameDt: 0.05, maxSteps: 3 });
  const ticks = [];

  assert.deepEqual(clock.advance(0.006, (dt) => ticks.push(dt)), {
    steps: 0, alpha: 0.6, dropped: 0,
  });
  const second = clock.advance(0.024, (dt) => ticks.push(dt));
  assert.equal(second.steps, 3);
  assert.ok(second.alpha < 1e-9);
  assert.equal(second.dropped, 0);
  assert.deepEqual(ticks, [0.01, 0.01, 0.01]);

  const blocked = clock.advance(1, (dt) => ticks.push(dt));
  assert.equal(blocked.steps, 3);
  assert.ok(Math.abs(blocked.dropped - 0.02) < 1e-9);
  assert.ok(blocked.alpha < 1e-9);
  assert.ok(Math.abs(clock.droppedTime - 0.02) < 1e-9);

  clock.reset();
  assert.equal(clock.accumulator, 0);
  assert.equal(clock.droppedTime, 0);
});

test('effect and object pools have explicit bounds and evict oldest entries', () => {
  const pool = [];
  const evicted = [];
  for (let value = 0; value < 8; value++) {
    pushBounded(pool, value, 3, (oldest) => evicted.push(oldest));
  }

  assert.deepEqual(pool, [5, 6, 7]);
  assert.deepEqual(evicted, [0, 1, 2, 3, 4]);
  assert.throws(() => pushBounded([], 1, 0), RangeError);
  assert.deepEqual(TRANSIENT_EFFECT_LIMITS, {
    parryRings: 12, impactBursts: 24, dashWakes: 12,
  });
  assert.deepEqual(INK_LIMITS, {
    stains: 620, drops: 420, jets: 64, screenMarks: 120, slashes: 6,
  });
  assert.deepEqual(RAGDOLL_LIMITS, { bodies: 48, debris: 60 });
  assert.equal(DEFAULT_GIB_POOL, 320);
});

test('player controller owns attack phases and dash initialization', () => {
  const vector = (x = 0, y = 0, z = 0) => ({
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; return this; },
  });
  const state = {
    action: 'idle', actionT: 0, attackKind: 'arc', attackPhase: '',
    comboIndex: 0, comboTimer: 0, facing: 0,
    dashCooldown: 0, dashDir: vector(), dashHit: new Set(),
    upgrades: { steelMind: 0 },
  };
  const events = [];
  const controller = new PlayerController({
    state,
    player: { root: { position: vector(), rotation: { y: 0 } } },
    input: {},
    audio: {
      swing: () => events.push('swing'),
      heavyWindup: () => events.push('heavy'),
      dash: () => events.push('dash'),
    },
    ink: {},
    trail: { fire: () => events.push('trail') },
    move: vector(1, 0, 0),
    tmp: vector(),
    animateLocomotion: () => {},
    isoAzimuth: Math.PI / 4,
    getEnemies: () => [],
    getActiveWeapon: () => ({ skill: 'iai' }),
    getFlowTier: () => 0,
    aimYaw: () => 0,
    trySignature: () => {},
    rewardDashRead: () => events.push('read'),
    spawnDashWake: () => events.push('wake'),
    spawnImpactBurst: () => events.push('burst'),
    dashCameraPunch: () => events.push('punch'),
    shake: () => events.push('shake'),
    showCombatCallout: () => {},
    playerDashHits: () => {},
    playerAttackHits: () => events.push('hit-check'),
    updateSignatureAction: () => {},
    pose: () => {},
  });

  controller.beginAttack();
  assert.equal(state.action, 'attack');
  assert.equal(state.attackPhase, 'windup');
  controller.updateAttack(0.10);
  assert.equal(state.attackPhase, 'active');
  assert.deepEqual(events.slice(0, 3), ['swing', 'trail', 'hit-check']);
  controller.updateAttack(0.5);
  assert.equal(state.action, 'idle');

  controller.beginDash(true);
  assert.equal(state.action, 'dash');
  assert.deepEqual([state.dashDir.x, state.dashDir.z], [1, 0]);
  assert.deepEqual(events.slice(-6), ['read', 'wake', 'burst', 'punch', 'shake', 'dash']);
});

test('combat system owns hitstop and the full Flow lifecycle', () => {
  const state = {
    hitstop: 0, timeScale: 1,
    chain: 0, chainTimer: 0, bestChain: 0,
  };
  const events = [];
  const renders = [];
  const system = new CombatSystem({
    state,
    audio: {
      setFlowTier: (tier) => events.push(`tier:${tier}`),
      flowTier: (tier) => events.push(`rise:${tier}`),
      flowBreak: () => events.push('break'),
      flowWarning: () => events.push('warning'),
    },
    updateHUD: () => events.push('hud'),
    onZenith: () => events.push('zenith'),
    renderFlow: (value) => renders.push(value),
  });

  system.hitstop(0.2, 0.04);
  assert.deepEqual([state.hitstop, state.timeScale], [0.2, 0.04]);
  system.addFlow(12);
  assert.equal(system.getFlowTier(), 3);
  assert.equal(system.flowMultiplier(), 1.3);
  assert.ok(events.includes('zenith'));

  system.updateFlow(4.3);
  assert.ok(events.includes('warning'));
  assert.equal(renders.at(-1).expiring, true);
  system.updateFlow(2);
  assert.equal(state.chain, 0);
  assert.ok(events.includes('break'));
});

test('enemy director owns attack slots and deterministic crowd separation', () => {
  const position = (x, z) => ({ x, y: 0, z });
  const first = {
    dead: false, state: 'circle', hasSlot: false,
    spec: { height: 1 }, actor: { root: { position: position(2, 0) } },
  };
  const second = {
    dead: false, state: 'circle', hasSlot: false,
    spec: { height: 1 }, actor: { root: { position: position(2, 0) } },
  };
  const enemies = [first, second];
  const director = new EnemyDirector({
    state: { slots: 1 },
    player: { root: { position: position(0, 0) } },
    getEnemies: () => enemies,
  });

  assert.equal(director.requestSlot(first), true);
  assert.equal(director.requestSlot(second), false);
  director.releaseSlot(first);
  assert.equal(director.requestSlot(second), true);

  director.separate();
  const dx = second.actor.root.position.x - first.actor.root.position.x;
  const dz = second.actor.root.position.z - first.actor.root.position.z;
  assert.ok(Math.hypot(dx, dz) >= 1.099);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('run records reject corrupt and invalid stored values', () => {
  assert.deepEqual(normalizeRecords(null), EMPTY_RECORDS);
  assert.deepEqual(normalizeRecords({ wave: -3, kills: '7.9', parries: 'bad', flow: Infinity }), {
    wave: 0, kills: 7, parries: 0, flow: 0,
  });

  const corrupt = new RunRecordsStore(memoryStorage({ 'samurai-records': '{bad json' }));
  assert.deepEqual(corrupt.loadRecords(), EMPTY_RECORDS);
  assert.deepEqual(mergeRecords(
    { wave: 8, kills: 3, parries: 2, flow: 4 },
    { wave: 5, kills: 9, parries: 1, flow: 6 },
  ), { wave: 8, kills: 9, parries: 2, flow: 6 });
});

test('QA record isolation calculates outcomes without changing storage', () => {
  const storage = memoryStorage({
    'samurai-records': JSON.stringify({ wave: 4, kills: 8, parries: 1, flow: 3 }),
    'samurai-ledger': JSON.stringify([{ wave: 4, kills: 8 }]),
    'samurai-grudge': 'KUROGANE',
  });
  const store = new RunRecordsStore(storage, { writeEnabled: false });
  const outcome = store.recordRun(
    { wave: 10, kills: 20, parries: 4, flow: 12 },
    { wave: 10, kills: 20, parries: 4, flow: 12, daily: false, date: '2026-09-04' },
  );

  assert.equal(outcome.isRecord, true);
  assert.equal(outcome.records.wave, 10);
  assert.equal(outcome.ledger.length, 2);
  assert.equal(store.loadRecords().wave, 4);
  store.saveGrudge('AKATSUKI');
  store.clearGrudge();
  assert.equal(store.loadGrudge(), 'KUROGANE');
});

test('unlock rules hold their exact boundaries and report new rewards', () => {
  assert.equal(isSkinUnlocked('hitokiri', { wave: 4 }), false);
  assert.equal(isSkinUnlocked('hitokiri', { wave: 5 }), true);
  assert.equal(isSkinUnlocked('mibu', { flow: 19 }), false);
  assert.equal(isSkinUnlocked('mibu', { flow: 20 }), true);
  assert.equal(isWeaponUnlocked('nodachi', { wave: 7 }), false);
  assert.equal(isWeaponUnlocked('nodachi', { wave: 8 }), true);

  const skins = [
    { id: 'musashi', name: 'MUSASHI' },
    { id: 'hitokiri', name: 'HITOKIRI' },
    { id: 'masamune', name: 'MASAMUNE' },
    { id: 'mibu', name: 'MIBU WOLF' },
  ];
  assert.equal(nextLockedSkin(skins, { wave: 4, flow: 2 }).id, 'hitokiri');
  assert.deepEqual(
    newlyUnlockedSkins(skins, { wave: 4, flow: 0 }, { wave: 10, flow: 0 }).map((skin) => skin.id),
    ['hitokiri', 'masamune'],
  );
});

test('run flow owns delayed start, defeat, and in-place retry decisions', () => {
  const state = { running: false, over: false, slowmo: 1 };
  const run = { daily: false, dateStr: '', rng: null, generation: 0 };
  const scheduled = [];
  const events = [];
  const flow = new RunFlow(state, run, {
    today: () => '2026-09-04',
    random: () => 0.25,
    dailyRandom: (date) => () => date === '2026-09-04' ? 0.75 : 0,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
    onModeChange: () => events.push('mode'),
  });

  const callbacks = {
    restart: () => events.push('restart'),
    prepare: () => events.push('prepare'),
    commit: () => { state.running = true; events.push('commit'); },
  };
  assert.equal(flow.begin({ daily: true }, callbacks), RUN_START.NEW);
  assert.equal(flow.pending, true);
  assert.equal(run.daily, true);
  assert.equal(run.rng(), 0.75);
  assert.equal(scheduled[0].delay, 220);
  assert.equal(flow.begin({}, callbacks), RUN_START.BLOCKED);
  scheduled[0].callback();
  assert.deepEqual(events, ['mode', 'prepare', 'commit']);

  assert.equal(flow.finish(), true);
  assert.deepEqual([state.running, state.over, state.slowmo], [false, true, 0]);
  assert.equal(flow.begin({}, callbacks), RUN_START.RETRY);
  assert.equal(events.at(-1), 'restart');
  flow.showTitle();
  assert.deepEqual([state.running, state.over, run.daily, run.dateStr], [false, false, false, '']);
});

test('retry state reset clears combat progress and creates fresh upgrades', () => {
  const state = {
    running: false, over: true, hp: 0, kills: 12, chain: 9,
    upgrades: { steelMind: 3 },
  };
  const previousUpgrades = state.upgrades;
  resetRunState(state, { maxHp: 100 });
  assert.equal(state.running, true);
  assert.equal(state.over, false);
  assert.equal(state.hp, 100);
  assert.equal(state.kills, 0);
  assert.equal(state.chain, 0);
  assert.deepEqual(state.upgrades, {
    steelMind: 0, bloodWind: 0, finalStroke: 0,
    stillWater: 0, longShadow: 0, fallingLeaf: 0,
  });
  assert.notEqual(state.upgrades, previousUpgrades);
});
