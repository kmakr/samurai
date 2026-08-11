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

  noise(dur, { type = 'bandpass', freq = 1200, q = 1, gain = 0.3, sweep = 0 } = {}) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, this.t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), this.t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(this.t + dur + 0.02);
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, to = null } = {}) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, this.t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, this.t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.t + dur + 0.02);
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
  }

  swing() { this.noise(0.22, { freq: 2600, q: 1.2, gain: 0.16, sweep: 0.25 }); }

  hit() {
    // Three layers on the contact frame: the slice, the body thud, and a low
    // punch that lands under both. The bottom layer carries the weight.
    this.noise(0.12, { freq: 3400, q: 2.5, gain: 0.18, sweep: 0.3 });
    this.noise(0.16, { type: 'lowpass', freq: 900, gain: 0.34, sweep: 0.3 });
    this.tone(150, 0.16, { type: 'triangle', gain: 0.24, to: 60 });
    this.tone(72, 0.22, { type: 'sine', gain: 0.32, to: 38 });
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
