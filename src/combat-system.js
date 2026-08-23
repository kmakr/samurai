import { FLOW_WINDOW } from './combat.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

// Owns global combat cadence: hitstop, Flow tiers, expiry, focus multiplier,
// and the presentation events emitted by those state changes.
export class CombatSystem {
  constructor({ state, audio, updateHUD, onZenith, renderFlow }) {
    this.state = state;
    this.audio = audio;
    this.updateHUD = updateHUD;
    this.onZenith = onZenith;
    this.renderFlow = renderFlow;
    this.reset();
  }

  reset() {
    this.warningPlayed = false;
    this.ghostLevel = 0;
    this.renderFlow?.({ target: 0, ghost: 0, expiring: false });
  }

  hitstop(duration, scale = 0.08) {
    this.state.hitstop = Math.max(this.state.hitstop, duration);
    this.state.timeScale = scale;
  }

  getFlowTier(chain = this.state.chain) {
    if (chain >= 12) return 3;
    if (chain >= 8) return 2;
    if (chain >= 4) return 1;
    return 0;
  }

  flowMultiplier() {
    return 1 + Math.min(0.5, Math.floor(this.state.chain / 4) * 0.1);
  }

  addFlow(amount = 1, refreshHUD = true, announce = true) {
    const previousTier = this.getFlowTier();
    this.state.chain += amount;
    this.state.chainTimer = FLOW_WINDOW;
    this.warningPlayed = false;
    this.state.bestChain = Math.max(this.state.bestChain, this.state.chain);
    const nextTier = this.getFlowTier();
    this.audio.setFlowTier(nextTier);
    if (announce && nextTier > previousTier) {
      this.audio.flowTier(nextTier);
      if (nextTier === 3) this.onZenith();
    }
    if (refreshHUD) this.updateHUD();
  }

  breakFlow() {
    if (this.state.chain > 0) this.audio.flowBreak();
    this.state.chain = 0;
    this.state.chainTimer = 0;
    this.warningPlayed = false;
    this.audio.setFlowTier(0);
    this.updateHUD();
  }

  updateFlow(dt) {
    if (this.state.chain > 0) {
      this.state.chainTimer -= dt;
      if (this.state.chainTimer <= 0) this.breakFlow();
    }
    const target = this.state.chain > 0
      ? clamp01(this.state.chainTimer / FLOW_WINDOW)
      : 0;
    if (target > 0.8) this.warningPlayed = false;
    if (this.state.chain > 0 && target <= 0.24 && !this.warningPlayed) {
      this.warningPlayed = true;
      this.audio.flowWarning();
    }
    const followSpeed = target > this.ghostLevel ? 18 : 3.2;
    this.ghostLevel += (target - this.ghostLevel) * Math.min(1, dt * followSpeed);
    this.renderFlow({
      target,
      ghost: this.ghostLevel,
      expiring: this.state.chain > 0 && target <= 0.24,
    });
  }
}
