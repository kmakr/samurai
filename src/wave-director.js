import { attackSlotsForWave, isRivalWave, waveComposition } from './waves.js';

export const WAVE_EVENT = Object.freeze({
  START: 'start-wave',
  UPGRADE: 'offer-upgrade',
});

export function rivalNameForWave(wave) {
  const names = ['KUROGANE', 'AKATSUKI', 'SHIROGANE', 'MURASAME'];
  return names[(Math.floor(wave / 5) - 1) % names.length];
}

export function spawnDelayFor(wave, type, index, rivalName = '') {
  if (wave === 1) return 0.08 + index * 0.72;
  if (type === 'oni') return 0.08;
  if (rivalName) return 0.72 + Math.min(index * 0.04, 0.5);
  return 0.08 + Math.min(index * 0.055, 0.58);
}

export function shuffleWithRng(items, rng = Math.random) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Build the complete structural plan before anything touches the scene. The
// supplied RNG owns only run structure (spawn layout); AI and cosmetic timing
// remain on Math.random in the runtime so Daily Trials still feel alive.
export function buildWavePlan(wave, { rng = Math.random, grudgeName = '' } = {}) {
  const rivalName = isRivalWave(wave) ? rivalNameForWave(wave) : '';
  const grudge = Boolean(rivalName) && grudgeName === rivalName;
  const composition = waveComposition(wave);
  const enemies = composition.map((type, index) => ({
    type,
    delay: spawnDelayFor(wave, type, index, rivalName),
    rival: type === 'oni',
    rivalName,
    grudge: type === 'oni' && grudge,
    angle: rng() * Math.PI * 2,
    radius: 13 + rng() * 6,
  }));

  return {
    wave,
    slots: attackSlotsForWave(wave),
    rivalName,
    grudge,
    composition,
    enemies,
  };
}

// Owns the progression clock while leaving presentation to main.js. The state
// object remains shared for HUD compatibility, but all lifecycle mutations are
// routed through this boundary.
export class WaveDirector {
  constructor(state, { rng = Math.random } = {}) {
    this.state = state;
    this.rng = rng;
  }

  setRng(rng = Math.random) {
    this.rng = rng;
  }

  nextRandom() {
    return this.rng();
  }

  shuffle(items) {
    return shuffleWithRng(items, this.rng);
  }

  reset({ firstWave = 1, delay = firstWave > 1 ? 0.05 : 1.2 } = {}) {
    this.state.wave = Math.max(0, firstWave - 1);
    this.state.waveBreak = delay;
    this.state.slots = 2;
    this.state.pendingUpgrade = false;
    this.state.choosingUpgrade = false;
  }

  tick(dt, enemyCount) {
    if (this.state.choosingUpgrade) return null;

    if (this.state.waveBreak > 0) {
      this.state.waveBreak = Math.max(0, this.state.waveBreak - dt);
      if (this.state.waveBreak > 0) return null;
      return this.state.pendingUpgrade ? WAVE_EVENT.UPGRADE : WAVE_EVENT.START;
    }

    if (enemyCount === 0) {
      this.state.pendingUpgrade = this.state.wave > 0;
      this.state.waveBreak = this.state.pendingUpgrade ? 2.6 : 1.0;
    }

    return null;
  }

  startNextWave({ grudgeName = '' } = {}) {
    this.state.wave++;
    this.state.waveBreak = 0;
    this.state.pendingUpgrade = false;
    const plan = buildWavePlan(this.state.wave, { rng: this.rng, grudgeName });
    this.state.slots = plan.slots;
    return plan;
  }

  beginUpgrade() {
    this.state.choosingUpgrade = true;
  }

  finishUpgrade() {
    this.state.choosingUpgrade = false;
    this.state.pendingUpgrade = false;
    this.state.waveBreak = 1.1;
  }
}
