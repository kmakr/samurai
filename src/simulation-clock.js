export const FIXED_SIMULATION_DT = 1 / 60;

// Converts browser frame time into deterministic simulation ticks. The frame
// delta and number of catch-up steps are both capped, so a restored/blocked tab
// cannot make the duel sprint through several seconds in one render.
export class FixedStepClock {
  constructor({
    fixedDt = FIXED_SIMULATION_DT,
    maxFrameDt = 0.05,
    maxSteps = 3,
  } = {}) {
    if (!(fixedDt > 0)) throw new RangeError('fixedDt must be greater than zero');
    if (!(maxFrameDt > 0)) throw new RangeError('maxFrameDt must be greater than zero');
    if (!(maxSteps > 0)) throw new RangeError('maxSteps must be greater than zero');
    this.fixedDt = fixedDt;
    this.maxFrameDt = maxFrameDt;
    this.maxSteps = Math.floor(maxSteps);
    this.accumulator = 0;
    this.droppedTime = 0;
  }

  reset() {
    this.accumulator = 0;
    this.droppedTime = 0;
  }

  advance(frameDt, simulate) {
    const safeDt = Number.isFinite(frameDt)
      ? Math.max(0, Math.min(this.maxFrameDt, frameDt))
      : 0;
    this.accumulator += safeDt;

    let steps = 0;
    const epsilon = this.fixedDt * 1e-7;
    while (this.accumulator + epsilon >= this.fixedDt && steps < this.maxSteps) {
      simulate(this.fixedDt);
      this.accumulator = Math.max(0, this.accumulator - this.fixedDt);
      steps++;
    }

    // Discard only whole ticks beyond the catch-up budget, preserving the
    // fractional remainder for a smooth next frame.
    let dropped = 0;
    if (this.accumulator + epsilon >= this.fixedDt) {
      const wholeTicks = Math.floor((this.accumulator + epsilon) / this.fixedDt);
      dropped = wholeTicks * this.fixedDt;
      this.accumulator = Math.max(0, this.accumulator - dropped);
      this.droppedTime += dropped;
    }

    return {
      steps,
      alpha: Math.min(1, this.accumulator / this.fixedDt),
      dropped,
    };
  }
}
