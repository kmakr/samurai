export const RUN_START = Object.freeze({
  BLOCKED: 'blocked',
  NEW: 'new',
  RETRY: 'retry',
});

export const EMPTY_UPGRADES = Object.freeze({
  steelMind: 0,
  bloodWind: 0,
  finalStroke: 0,
  stillWater: 0,
  longShadow: 0,
  fallingLeaf: 0,
});

export function resetRunState(state, { maxHp }) {
  Object.assign(state, {
    running: true,
    over: false,
    hp: maxHp,
    kills: 0,
    perfectParries: 0,
    focus: 0,
    time: 0,
    timeScale: 1,
    hitstop: 0,
    slowmo: 0,
    slowmoScale: 1,
    phase: 0,
    facing: 0,
    action: 'idle',
    actionT: 0,
    attackKind: 'arc',
    comboIndex: 0,
    comboTimer: 0,
    attackPhase: '',
    hitThisSwing: null,
    dashCooldown: 0,
    parryCooldown: 0,
    invuln: 0,
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
    upgrades: { ...EMPTY_UPGRADES },
  });
  return state;
}

export class RunFlow {
  constructor(state, run, {
    today,
    random = Math.random,
    dailyRandom = () => random,
    schedule = (callback, delay) => setTimeout(callback, delay),
    onModeChange = () => {},
  }) {
    this.state = state;
    this.run = run;
    this.today = today;
    this.random = random;
    this.dailyRandom = dailyRandom;
    this.schedule = schedule;
    this.onModeChange = onModeChange;
    this.pending = false;
  }

  configure(daily) {
    this.run.generation++;
    this.run.daily = Boolean(daily);
    this.run.dateStr = this.today();
    this.run.rng = this.run.daily ? this.dailyRandom(this.run.dateStr) : this.random;
    this.onModeChange(this.run);
    return this.run;
  }

  finish() {
    if (this.state.over) return false;
    this.state.over = true;
    this.state.running = false;
    this.state.slowmo = 0;
    return true;
  }

  showTitle() {
    this.pending = false;
    this.state.running = false;
    this.state.over = false;
    this.run.daily = false;
    this.run.dateStr = '';
    this.run.rng = this.random;
    this.onModeChange(this.run);
    return this.run;
  }

  begin({ daily = false, instant = false, reducedMotion = false } = {}, {
    restart,
    prepare,
    commit,
    delay = 220,
  }) {
    if (this.state.running || this.pending) return RUN_START.BLOCKED;
    if (this.state.over) {
      restart();
      return RUN_START.RETRY;
    }

    this.configure(daily);
    prepare();
    if (instant || reducedMotion) {
      commit();
    } else {
      this.pending = true;
      this.schedule(() => {
        this.pending = false;
        commit();
      }, delay);
    }
    return RUN_START.NEW;
  }

  prepareRetry() {
    return this.configure(this.run.daily);
  }
}
