const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

export function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

// Frame pacing telemetry is opt-in through ?profile=1. Keeping aggregation in
// a DOM-free module makes the measurement contract testable and lets the game
// publish the same shape locally and in production without a debug bundle.
export class FrameProfiler {
  constructor({ maxSamples = 600, publishEvery = 30 } = {}) {
    this.maxSamples = maxSamples;
    this.publishEvery = publishEvery;
    this.samples = [];
    this.totalSamples = 0;
  }

  record(sample) {
    this.totalSamples++;
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return this.samples.length >= Math.min(60, this.maxSamples)
      && this.totalSamples % this.publishEvery === 0;
  }

  summary(extra = {}) {
    const frames = this.samples.map((sample) => sample.frameMs);
    const costs = this.samples.map((sample) => sample.costMs);
    const steps = this.samples.map((sample) => sample.steps ?? 1);
    const actionFrames = {};
    const positions = [];
    for (const sample of this.samples) {
      if (sample.action) actionFrames[sample.action] = (actionFrames[sample.action] || 0) + 1;
      if (Number.isFinite(sample.playerX) && Number.isFinite(sample.playerZ)) {
        positions.push(sample);
      }
    }
    const movementSpan = positions.length
      ? Math.hypot(
        Math.max(...positions.map((sample) => sample.playerX))
          - Math.min(...positions.map((sample) => sample.playerX)),
        Math.max(...positions.map((sample) => sample.playerZ))
          - Math.min(...positions.map((sample) => sample.playerZ)),
      )
      : 0;
    return {
      samples: this.samples.length,
      frameMean: mean(frames),
      frameP95: percentile(frames, 0.95),
      frameP99: percentile(frames, 0.99),
      frameMax: frames.length ? Math.max(...frames) : 0,
      costMean: mean(costs),
      costP95: percentile(costs, 0.95),
      costP99: percentile(costs, 0.99),
      costMax: costs.length ? Math.max(...costs) : 0,
      over25ms: frames.filter((value) => value > 25).length,
      hitstopFrames: this.samples.filter((sample) => sample.timeScale < 0.2).length,
      minTimeScale: this.samples.length
        ? Math.min(...this.samples.map((sample) => sample.timeScale))
        : 1,
      stepMean: mean(steps),
      stepMax: steps.length ? Math.max(...steps) : 0,
      actionFrames,
      movementSpan,
      ...extra,
    };
  }
}
