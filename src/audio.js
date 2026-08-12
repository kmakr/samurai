// Procedural audio. No assets — everything is synthesised, which keeps the
// whole game a single folder of text files.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
  }

  // Must be called from a user gesture.
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startWind();
  }

  get t() { return this.ctx.currentTime; }

  noise(dur, { type = 'bandpass', freq = 1200, q = 1, gain = 0.3, sweep = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const start = this.t + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), start + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, to = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const start = this.t + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (to) o.frequency.exponentialRampToValueAtTime(to, start + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  // A low bed of wind that never stops. It does a lot of the atmosphere work.
  startWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    // Slow gusting.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.windGain = g;

    // Bamboo rustle: high, papery noise that only opens up near a grove. Two
    // slow LFOs — one on amplitude, one on filter centre — give it the
    // irregular hiss-and-settle of leaves rather than steady static.
    const rSrc = this.ctx.createBufferSource();
    rSrc.buffer = this.noiseBuf;
    rSrc.loop = true;
    const rF = this.ctx.createBiquadFilter();
    rF.type = 'bandpass';
    rF.frequency.value = 2600;
    rF.Q.value = 0.8;
    const rG = this.ctx.createGain();
    rG.gain.value = 0;
    const ampLfo = this.ctx.createOscillator();
    ampLfo.frequency.value = 0.31;
    const ampDepth = this.ctx.createGain();
    ampDepth.gain.value = 0;                  // scaled with proximity in setRustle
    ampLfo.connect(ampDepth).connect(rG.gain);
    const pitchLfo = this.ctx.createOscillator();
    pitchLfo.frequency.value = 0.13;
    const pitchDepth = this.ctx.createGain();
    pitchDepth.gain.value = 900;
    pitchLfo.connect(pitchDepth).connect(rF.frequency);
    ampLfo.start();
    pitchLfo.start();
    rSrc.connect(rF).connect(rG).connect(this.master);
    rSrc.start();
    this.rustleGain = rG;
    this.rustleDepth = ampDepth;
  }

  // v in 0..1: how deep into bamboo the player stands.
  setRustle(v) {
    if (!this.rustleGain) return;
    this.rustleGain.gain.setTargetAtTime(v * 0.16, this.t, 0.4);
    this.rustleDepth.gain.setTargetAtTime(v * 0.07, this.t, 0.4);
  }

  // A footfall on packed earth: a soft low thud plus a faint dry tick, pitch
  // wandering a little so a run never sounds like a loop.
  step() {
    const f = 260 + Math.random() * 90;
    this.noise(0.09, { type: 'lowpass', freq: f, gain: 0.16, sweep: 0.5 });
    this.noise(0.03, { freq: 1900 + Math.random() * 700, q: 2.5, gain: 0.025 });
  }

  swing(style = 0) {
    if (style === 1) {
      // Return cut: short, high, and fast.
      this.noise(0.17, { freq: 3900, q: 1.7, gain: 0.17, sweep: 0.20 });
      this.tone(520, 0.10, { type: 'triangle', gain: 0.035, to: 260 });
    } else if (style === 2) {
      // Execution stroke: cloth rush above a low blade weight.
      this.noise(0.34, { freq: 1900, q: 0.9, gain: 0.24, sweep: 0.16 });
      this.tone(118, 0.30, { type: 'triangle', gain: 0.16, to: 48 });
    } else {
      this.noise(0.22, { freq: 2700, q: 1.2, gain: 0.16, sweep: 0.25 });
    }
  }

  hit(style = 0) {
    // Three layers on the contact frame: the slice, the body thud, and a low
    // punch that lands under both. The bottom layer carries the weight.
    const second = style === 1;
    const finisher = style === 2;
    this.noise(finisher ? 0.20 : 0.12, {
      freq: second ? 4300 : finisher ? 2700 : 3400,
      q: second ? 3.4 : 2.5,
      gain: finisher ? 0.28 : 0.18,
      sweep: finisher ? 0.18 : 0.3,
    });
    this.noise(finisher ? 0.28 : 0.16, {
      type: 'lowpass', freq: finisher ? 720 : 900, gain: finisher ? 0.46 : 0.34, sweep: 0.3,
    });
    this.tone(finisher ? 112 : second ? 180 : 150, finisher ? 0.28 : 0.16, {
      type: 'triangle', gain: finisher ? 0.32 : 0.24, to: finisher ? 44 : 60,
    });
    this.tone(finisher ? 54 : 72, finisher ? 0.38 : 0.22, {
      type: 'sine', gain: finisher ? 0.42 : 0.32, to: finisher ? 28 : 38,
    });
  }

  kill() {
    this.noise(0.5, { type: 'lowpass', freq: 700, gain: 0.4, sweep: 0.15 });
    this.tone(90, 0.45, { type: 'sine', gain: 0.3, to: 40 });
  }

  // Steel on steel.
  parry() {
    this.noise(0.35, { freq: 5200, q: 6, gain: 0.28, sweep: 0.5 });
    this.tone(2400, 0.3, { type: 'square', gain: 0.06, to: 1400 });
    this.tone(3600, 0.22, { type: 'sine', gain: 0.08, to: 2600 });
  }

  perfectParry() {
    if (!this.ctx) return;
    const now = this.t;
    // Pull the whole soundscape away before the steel lands. The 38 ms gap is
    // short enough to feel immediate and long enough for the strike to cut in.
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.08, now + 0.012);
    this.master.gain.setValueAtTime(0.08, now + 0.038);
    this.master.gain.exponentialRampToValueAtTime(0.55, now + 0.13);
    this.noise(0.38, { freq: 5600, q: 7, gain: 0.38, sweep: 0.42, delay: 0.038 });
    this.tone(2800, 0.34, { type: 'square', gain: 0.055, to: 1250, delay: 0.038 });
    this.tone(4200, 0.26, { type: 'sine', gain: 0.11, to: 2400, delay: 0.038 });
    this.tone(96, 0.32, { type: 'sine', gain: 0.34, to: 42, delay: 0.048 });
  }

  hurt() {
    this.noise(0.3, { type: 'lowpass', freq: 500, gain: 0.35, sweep: 0.4 });
    this.tone(70, 0.3, { type: 'sawtooth', gain: 0.14, to: 40 });
  }

  dash() { this.noise(0.28, { freq: 900, q: 0.8, gain: 0.12, sweep: 0.4 }); }

  // Taiko: wave announcements and the iai release.
  taiko(pitch = 82, gain = 0.5) {
    this.tone(pitch, 0.5, { type: 'sine', gain, to: pitch * 0.45 });
    this.noise(0.09, { type: 'lowpass', freq: 1400, gain: 0.25, sweep: 0.2 });
  }

  iai() {
    this.taiko(58, 0.6);
    this.noise(0.9, { freq: 3200, q: 2, gain: 0.3, sweep: 0.15 });
  }

  setWind(v) {
    if (this.windGain) this.windGain.gain.setTargetAtTime(v, this.t, 0.5);
  }
}
