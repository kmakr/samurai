// Procedural audio, with one exception: the score. Every effect is still
// synthesised, but the music prefers a recorded looping track
// (assets/score.mp3) when it can be fetched, with the procedural engine as
// the immediate opening bars and the fallback when the file is unreachable.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
    this.rustleTarget = -1;
    this.windTarget = -1;
    this.music = null;
    this.scoreSrc = null;
    this.samples = {};
    this.musicTimer = null;
    this.musicStep = 0;
    this.musicNextTime = 0;
    this.musicIntensity = 0;
    this.musicBoss = false;
    this.musicMixIntensity = -1;
    this.musicMixBoss = false;
    this.musicSilenceUntil = 0;
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
    this.startMusic();
    this.loadSample('slash', './assets/sfx-slash.mp3');
    this.loadSample('clash', './assets/sfx-clash.mp3');
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
    if (Math.abs(v - this.rustleTarget) < 0.005) return;
    this.rustleTarget = v;
    this.rustleGain.gain.setTargetAtTime(v * 0.16, this.t, 0.4);
    this.rustleDepth.gain.setTargetAtTime(v * 0.07, this.t, 0.4);
  }

  // Original dusty instrumental hip-hop. The score is scheduled ahead, so the
  // groove stays stable when rendering work gets heavy. It has no samples and
  // does not use a melody from an existing track.
  startMusic() {
    if (!this.ctx || this.musicTimer) return;

    const input = this.ctx.createGain();
    const color = this.ctx.createBiquadFilter();
    const glue = this.ctx.createDynamicsCompressor();
    const output = this.ctx.createGain();
    input.gain.value = 1;
    color.type = 'lowpass';
    color.frequency.value = 3000;
    color.Q.value = 0.45;
    glue.threshold.value = -20;
    glue.knee.value = 18;
    glue.ratio.value = 3;
    glue.attack.value = 0.012;
    glue.release.value = 0.24;
    output.gain.value = 0.22;
    input.connect(color).connect(glue).connect(output).connect(this.master);

    const vinyl = this.ctx.createBufferSource();
    const vinylHigh = this.ctx.createBiquadFilter();
    const vinylLow = this.ctx.createBiquadFilter();
    const vinylGain = this.ctx.createGain();
    vinyl.buffer = this.noiseBuf;
    vinyl.loop = true;
    vinylHigh.type = 'highpass';
    vinylHigh.frequency.value = 1600;
    vinylLow.type = 'lowpass';
    vinylLow.frequency.value = 6800;
    vinylGain.gain.value = 0.022;
    vinyl.connect(vinylHigh).connect(vinylLow).connect(vinylGain).connect(input);
    vinyl.start();

    this.music = { input, color, output, vinyl };
    this.musicStep = 0;
    this.musicNextTime = this.t + 0.08;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 25);
    this.scheduleMusic();
    this.loadScore();
  }

  // Fetch and decode the recorded score, then hand the bus over to it: the
  // procedural engine stops scheduling and the track loops gaplessly through
  // the same color/glue chain, so setMusicIntensity's filter sweeps and
  // silenceMusic's ducks play the recording exactly like they played the
  // synth. On any failure the procedural score simply keeps playing.
  loadScore() {
    fetch('./assets/score.mp3')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((buf) => this.ctx.decodeAudioData(buf))
      .then((audioBuf) => {
        if (!this.music || this.scoreSrc) return;
        clearInterval(this.musicTimer);
        this.musicTimer = null;
        const src = this.ctx.createBufferSource();
        src.buffer = audioBuf;
        src.loop = true;
        // A mastered track runs much hotter than the quiet synth stems; this
        // brings it into the same range before the shared output gain.
        const trim = this.ctx.createGain();
        trim.gain.value = 0.5;
        src.connect(trim).connect(this.music.input);
        src.start();
        this.scoreSrc = src;
      })
      .catch(() => { /* keep the procedural score */ });
  }

  // Recorded one-shots for the sounds that fire hundreds of times a run. Each
  // call jitters playback rate so repetition never reads as a machine gun; if
  // a sample never loads, the synthesized version keeps covering.
  loadSample(name, url) {
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((buf) => this.ctx.decodeAudioData(buf))
      .then((audioBuf) => { this.samples[name] = audioBuf; })
      .catch(() => { /* synth fallback */ });
  }

  playSample(name, { gain = 0.5, rate = 1, delay = 0 } = {}) {
    const buf = this.samples[name];
    if (!buf || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start(this.t + delay);
    return true;
  }

  scheduleMusic() {
    if (!this.ctx || !this.music) return;
    if (this.musicNextTime < this.t - 0.25) this.musicNextTime = this.t + 0.05;
    const sixteenth = 60 / 84 / 4;
    const swing = 0.16;
    while (this.musicNextTime < this.t + 0.16) {
      this.scheduleMusicStep(this.musicStep, this.musicNextTime);
      this.musicNextTime += sixteenth * (this.musicStep % 2 === 0 ? 1 + swing : 1 - swing);
      this.musicStep++;
    }
  }

  scheduleMusicStep(index, at) {
    const step = index % 16;
    const bar = Math.floor(index / 16) % 8;
    const harmony = [
      { notes: [52, 55, 59, 62, 66], root: 40, fifth: 47, next: 36 },
      { notes: [48, 52, 55, 59, 66], root: 36, fifth: 43, next: 43 },
      { notes: [55, 59, 62, 64, 69], root: 43, fifth: 50, next: 35 },
      { notes: [47, 52, 57, 60, 66], root: 35, fifth: 42, next: 40 },
    ];
    const chord = harmony[bar % harmony.length];
    const intensity = this.musicIntensity;

    if (step === 0) this.musicChord(at, chord.notes, bar % 2 ? 0.82 : 1);
    if (step === 10 && bar % 2 === 1) this.musicChord(at, chord.notes.slice(1), 0.32, 0.55);

    if (step === 0) this.musicBass(at, chord.root, 0.52, 1);
    if (step === 7) this.musicBass(at, chord.fifth, 0.30, 0.72);
    if (step === 10) this.musicBass(at, chord.root + 12, 0.36, 0.62);
    if (step === 14) this.musicBass(at, chord.next - 1, 0.20, 0.48);

    const kickPatterns = [
      [0, 7, 10], [0, 6, 11], [0, 7, 10, 14], [0, 5, 10],
      [0, 7, 10], [0, 6, 9, 14], [0, 7, 11], [0, 5, 10, 15],
    ];
    if (kickPatterns[bar].includes(step)) this.musicKick(at, step === 0 ? 1 : 0.76);
    if (step === 4 || step === 12) this.musicSnare(at, step === 12 ? 1 : 0.9);
    if (intensity > 0.52 && (step === 3 || step === 11)) this.musicSnare(at, 0.22);
    if ([2, 6, 10, 14].includes(step)) this.musicHat(at, 0.48 + (step === 14 ? 0.14 : 0));
    if (intensity > 0.32 && step % 2 === 1) this.musicHat(at, 0.20 + intensity * 0.12);
    if ((intensity > 0.7 || this.musicBoss) && step === 15) this.musicHat(at, 0.7, true);

    const phrases = [
      { 9: 71, 13: 74 }, { 3: 78, 11: 74 },
      { 7: 69, 14: 71 }, { 6: 66, 15: 64 },
      { 5: 67, 12: 71 }, { 2: 74, 10: 78 },
      { 8: 69, 13: 67 }, { 6: 66, 14: 64 },
    ];
    const note = phrases[bar][step];
    if (note) this.musicPluck(at, note, intensity > 0.68 ? 0.8 : 0.62);
    if ((index * 17 + bar * 11) % 37 === 0) this.musicCrackle(at + 0.035);
  }

  musicKick(at, velocity) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(135, at);
    o.frequency.exponentialRampToValueAtTime(46, at + 0.16);
    g.gain.setValueAtTime(0.36 * velocity, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.27);
    o.connect(g).connect(this.music.input);
    o.start(at);
    o.stop(at + 0.29);
  }

  musicSnare(at, velocity) {
    const src = this.ctx.createBufferSource();
    const high = this.ctx.createBiquadFilter();
    const band = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    src.buffer = this.noiseBuf;
    high.type = 'highpass';
    high.frequency.value = 900;
    band.type = 'bandpass';
    band.frequency.value = 2100;
    band.Q.value = 0.65;
    g.gain.setValueAtTime(0.15 * velocity, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    src.connect(high).connect(band).connect(g).connect(this.music.input);
    src.start(at, (at * 0.731) % 1.6);
    src.stop(at + 0.18);
    this.musicTone(at, 178, 0.11, 0.065 * velocity, 'triangle');
  }

  musicHat(at, velocity, open = false) {
    const src = this.ctx.createBufferSource();
    const high = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    const dur = open ? 0.20 : 0.045;
    src.buffer = this.noiseBuf;
    high.type = 'highpass';
    high.frequency.value = open ? 5600 : 6800;
    g.gain.setValueAtTime(0.038 * velocity, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(high).connect(g).connect(this.music.input);
    src.start(at, (at * 1.137) % 1.7);
    src.stop(at + dur + 0.02);
  }

  musicChord(at, notes, velocity, dur = 2.15) {
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200 + this.musicIntensity * 1800, at);
    filter.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.026 * velocity, at + 0.018);
    g.gain.exponentialRampToValueAtTime(0.009 * velocity, at + 0.34);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    filter.connect(g).connect(this.music.input);
    for (const midi of notes) {
      const freq = 440 * 2 ** ((midi - 69) / 12);
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = (midi % 3 - 1) * 2.4;
      o.connect(filter);
      o.start(at);
      o.stop(at + dur + 0.03);
    }
  }

  musicBass(at, midi, dur, velocity) {
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, at);
    filter.frequency.exponentialRampToValueAtTime(190, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.17 * velocity, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    filter.connect(g).connect(this.music.input);
    for (const [type, level] of [['sine', 1], ['triangle', 0.32]]) {
      const o = this.ctx.createOscillator();
      const layer = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      layer.gain.value = level;
      o.connect(layer).connect(filter);
      o.start(at);
      o.stop(at + dur + 0.03);
    }
  }

  musicPluck(at, midi, velocity) {
    const freq = 440 * 2 ** ((midi - 69) / 12);
    this.musicTone(at, freq, 0.42, 0.055 * velocity, 'triangle');
    this.musicTone(at, freq * 2, 0.19, 0.016 * velocity, 'sine');
  }

  musicTone(at, freq, dur, gain, type) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.music.input);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  musicCrackle(at) {
    const src = this.ctx.createBufferSource();
    const high = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    src.buffer = this.noiseBuf;
    high.type = 'highpass';
    high.frequency.value = 4200;
    g.gain.setValueAtTime(0.024, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
    src.connect(high).connect(g).connect(this.music.input);
    src.start(at, (at * 0.413) % 1.8);
    src.stop(at + 0.02);
  }

  setMusicIntensity(v, boss = false) {
    this.musicIntensity = Math.max(0, Math.min(1, v));
    this.musicBoss = boss;
    if (!this.music || !this.ctx) return;
    if (this.t < this.musicSilenceUntil) return;
    if (Math.abs(this.musicIntensity - this.musicMixIntensity) < 0.025 && boss === this.musicMixBoss) return;
    this.musicMixIntensity = this.musicIntensity;
    this.musicMixBoss = boss;
    const color = 2500 + this.musicIntensity * 2200 + (boss ? 700 : 0);
    this.music.color.frequency.setTargetAtTime(color, this.t, 0.35);
    this.music.output.gain.setTargetAtTime(0.20 + this.musicIntensity * 0.055, this.t, 0.45);
  }

  silenceMusic(duration = 0.7, floor = 0.004) {
    if (!this.music || !this.ctx) return;
    const now = this.t;
    const until = now + duration;
    this.musicSilenceUntil = Math.max(this.musicSilenceUntil, until);
    const target = 0.20 + this.musicIntensity * 0.055;
    const gain = this.music.output.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(floor, now + 0.045);
    gain.setValueAtTime(floor, this.musicSilenceUntil);
    gain.exponentialRampToValueAtTime(Math.max(0.001, target), this.musicSilenceUntil + 0.22);
  }

  // A footfall on packed earth: a soft low thud plus a faint dry tick, pitch
  // wandering a little so a run never sounds like a loop.
  step() {
    const f = 260 + Math.random() * 90;
    this.noise(0.09, { type: 'lowpass', freq: f, gain: 0.16, sweep: 0.5 });
    this.noise(0.03, { freq: 1900 + Math.random() * 700, q: 2.5, gain: 0.025 });
  }

  swing(style = 0) {
    // The recorded swoosh, pitched per style: quicker for the return cut,
    // heavier for the execution stroke — which keeps its low synth weight
    // underneath, since the sample alone is all air and no mass.
    const rate = (style === 1 ? 1.14 : style === 2 ? 0.85 : 1) * (0.95 + Math.random() * 0.1);
    if (this.playSample('slash', { gain: style === 2 ? 0.7 : 0.45, rate })) {
      if (style === 2) this.tone(118, 0.30, { type: 'triangle', gain: 0.16, to: 48 });
      return;
    }
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

  // A kill is three layers and a hole in the mix: a crack that says it
  // connected, a falling mass that says it ended, and a short wet tail as the
  // ink lands — fired into a momentary duck of the score so it never fights
  // the music. Heavy kills (bisections, the big silhouettes) drop deeper and
  // hold the hole open longer.
  kill(heavy = false) {
    // The crack: the first breath of the slash sample pitched into a snap.
    if (!this.playSample('slash', { gain: 0.5, rate: 1.4 + Math.random() * 0.15 })) {
      this.noise(0.035, { freq: 4200, q: 3, gain: 0.2 });
    }
    // The mass: the falling pitch is the finality.
    this.noise(0.3, { type: 'lowpass', freq: 700, gain: 0.34, sweep: 0.2 });
    this.tone(heavy ? 82 : 96, heavy ? 0.5 : 0.4, {
      type: 'sine', gain: heavy ? 0.4 : 0.3, to: heavy ? 34 : 44,
    });
    if (heavy) this.tone(52, 0.36, { type: 'sine', gain: 0.28, to: 28, delay: 0.02 });
    // The tail: the butcher's layer.
    this.splatter(heavy);
    // The hole: duck the score for a beat so the wind reads underneath.
    this.silenceMusic(heavy ? 0.38 : 0.14, heavy ? 0.01 : 0.05);
  }

  // Dismemberment is not one sound but a scatter: a torn rip right at the
  // blade, then a cluster of short wet bursts staggered over the next beat as
  // the pieces and the ink land — matching the gibs tumbling to the paper.
  // Every burst draws its own filter centre and timing, so no two kills
  // splatter alike.
  splatter(heavy = false) {
    // The tear.
    this.noise(0.14, { type: 'bandpass', freq: 1500, q: 0.7, gain: heavy ? 0.52 : 0.4, sweep: 0.3 });
    // The scatter.
    const drops = heavy ? 8 : 5;
    let at = 0.04 + Math.random() * 0.03;
    for (let i = 0; i < drops; i++) {
      const fade = 1 - (i / drops) * 0.6;
      this.noise(0.035 + Math.random() * 0.04, {
        type: 'bandpass',
        freq: 260 + Math.random() * 520,
        q: 1.6,
        gain: (heavy ? 0.48 : 0.36) * fade,
        sweep: 0.5,
        delay: at,
      });
      at += 0.025 + Math.random() * 0.05;
    }
    // A heavy kill's largest piece lands with its own thud.
    if (heavy) {
      this.noise(0.12, { type: 'lowpass', freq: 320, gain: 0.44, sweep: 0.4, delay: 0.16 + Math.random() * 0.08 });
    }
  }

  // Steel on steel.
  parry() {
    if (this.playSample('clash', { gain: 0.7, rate: 0.97 + Math.random() * 0.06 })) return;
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
    // The strike itself: the recorded clash, slowed a touch so it rings
    // bigger than an ordinary parry, over the same low body tone.
    if (this.samples.clash) {
      this.playSample('clash', { gain: 0.95, rate: 0.87 + Math.random() * 0.05, delay: 0.038 });
      this.tone(96, 0.32, { type: 'sine', gain: 0.34, to: 42, delay: 0.048 });
    } else {
      this.noise(0.38, { freq: 5600, q: 7, gain: 0.38, sweep: 0.42, delay: 0.038 });
      this.tone(2800, 0.34, { type: 'square', gain: 0.055, to: 1250, delay: 0.038 });
      this.tone(4200, 0.26, { type: 'sine', gain: 0.11, to: 2400, delay: 0.038 });
      this.tone(96, 0.32, { type: 'sine', gain: 0.34, to: 42, delay: 0.048 });
    }
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
    if (!this.windGain || Math.abs(v - this.windTarget) < 0.001) return;
    this.windTarget = v;
    this.windGain.gain.setTargetAtTime(v, this.t, 0.5);
  }
}
