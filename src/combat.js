// Pure combat rules and tuning. This module deliberately knows nothing about
// Three.js, the DOM, audio, or mutable game state, so timings can be verified
// without booting the renderer.

export const PLAYER_SPEED = 7.6;
export const PLAYER_MAX_HP = 100;

export const DASH_DISTANCE = 4.2;
export const DASH_TIME = 0.20;
// Lockout after the dash itself. Keeping this separate makes the total cadence
// explicit at the call site: DASH_TIME + DASH_COOLDOWN.
export const DASH_COOLDOWN = 0.12;

// Attack phases, in seconds. Active windows sit at 7-10 frames so the blade is
// readable, while the heavier nodachi remains a deliberately committed weapon.
export const ATTACK = Object.freeze([
  Object.freeze({ windup: 0.09, active: 0.12, recover: 0.20, damage: 34, reach: 3.1, arc: 0.05 }),
  Object.freeze({ windup: 0.07, active: 0.12, recover: 0.22, damage: 38, reach: 3.2, arc: -0.15 }),
  Object.freeze({ windup: 0.13, active: 0.16, recover: 0.34, damage: 62, reach: 3.6, arc: 0.30 }),
]);

export const THRUST = Object.freeze({
  windup: 0.06, active: 0.12, recover: 0.24, damage: 48, reach: 4.7,
});

export const DASHCUT = Object.freeze({
  windup: 0.04, active: 0.11, recover: 0.20, damage: 40, reach: 3.4,
});

export const NODACHI_COMBO = Object.freeze([
  Object.freeze({ windup: 0.20, active: 0.15, recover: 0.30, damage: 60, reach: 4.8, arc: 0.4 }),
  Object.freeze({ windup: 0.22, active: 0.17, recover: 0.44, damage: 108, reach: 5.2, arc: -0.5 }),
]);

export const COMBO_WINDOW = 0.42;

export const PARRY_STARTUP = 0.03;
export const PARRY_ACTIVE = 0.24;
export const PARRY_RECOVER = 0.26;
export const PARRY_COOLDOWN = 0.5;

export const FOCUS_MAX = 100;
export const FLOW_WINDOW = 5.5;
export const ENEMY_STRIKE_TIME = 0.10;

export function parryDurationFor(steelMindRank = 0) {
  return PARRY_ACTIVE + steelMindRank * 0.035;
}

export function parryWindowActive(action, actionTime, steelMindRank = 0) {
  return action === 'parry'
    && actionTime >= PARRY_STARTUP
    && actionTime < PARRY_STARTUP + parryDurationFor(steelMindRank);
}

export function weaponComboFor(skill) {
  return skill === 'tsunami' ? NODACHI_COMBO : ATTACK;
}

export function attackSpecFor(kind, comboIndex, weaponSkill) {
  if (kind === 'thrust') return THRUST;
  if (kind === 'dashcut') return DASHCUT;
  return weaponComboFor(weaponSkill)[comboIndex];
}

export function dashFollowupFor(dirX, dirZ, facing) {
  const forward = dirX * Math.sin(facing) + dirZ * Math.cos(facing);
  return forward > 0.35 ? 'thrust' : 'dashcut';
}
