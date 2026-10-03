// Web Audio: metronome with look-ahead scheduling, and a small polyphonic synth
// (for listening to exercises and for sounding notes when the keyboard has no speakers).
// The 'guitar' timbre uses a plucked-string synth (js/io/pluck.js).

const midiFreq = (m) => 440 * 2 ** ((m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = { click: 0.6, synth: 0.35 };
    this.voices = new Map();
    this.timer = null;
    this.timbre = 'piano';
    this.pluck = null;
  }

  /** 'piano' (default synth) or 'guitar' (plucked string). */
  setTimbre(timbre) {
    this.timbre = timbre;
    if (timbre === 'guitar' && !this.pluck) {
      import('./pluck.js').then((m) => { this.pluck = m; }).catch((err) => console.warn('Plucked-string synth unavailable', err));
    }
  }

  #plucked() {
    return this.timbre === 'guitar' && this.pluck?.playPluck;
  }

  /** Must be called from a user gesture the first time (browser autoplay policy). */
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 3500;
      this.filter.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get now() {
    return this.ensure().currentTime;
  }

  // ------------------------------------------------------------ metronome

  click(time, accent = false) {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(this.volume.click * (accent ? 1 : 0.6), time + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  /**
   * Schedule events from an iterator yielding { time (audio seconds), accent, click?, onTime? }.
   * Uses a look-ahead timer so clicks stay sample-accurate even if the main thread is busy.
   */
  startClicks(iterator) {
    this.stopClicks();
    const ctx = this.ensure();
    let next = iterator.next();
    const pump = () => {
      while (!next.done && next.value.time < ctx.currentTime + 0.12) {
        if (next.value.time >= ctx.currentTime - 0.01) {
          if (next.value.click !== false) this.click(next.value.time, next.value.accent);
          next.value.onTime?.(next.value.time);
        }
        next = iterator.next();
      }
      if (next.done) this.stopClicks();
    };
    pump();
    this.timer = setInterval(pump, 25);
  }

  stopClicks() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------ synth

  noteOn(midi, velocity = 90, time = null) {
    const ctx = this.ensure();
    const t = time ?? ctx.currentTime;
    if (this.#plucked()) {
      this.pluck.playPluck(ctx, this.master, midi, t, 2.5, velocity);
      return;
    }
    this.noteOff(midi, t);
    const g = ctx.createGain();
    const amp = this.volume.synth * (0.3 + 0.7 * (velocity / 127));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(amp * 0.35, t + 0.6);
    g.gain.exponentialRampToValueAtTime(amp * 0.05, t + 4);
    const f = midiFreq(midi);
    const oscs = [['triangle', 1, 1], ['sine', 2, 0.25], ['sine', 3, 0.08]].map(([type, mult, level]) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      return o;
    });
    g.connect(this.filter);
    this.voices.set(midi, { g, oscs });
  }

  noteOff(midi, time = null) {
    const v = this.voices.get(midi);
    if (!v) return;
    const t = time ?? this.ctx.currentTime;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setTargetAtTime(0, t, 0.08);
    v.oscs.forEach((o) => o.stop(t + 0.6));
    this.voices.delete(midi);
  }

  /** Fire-and-forget note at a scheduled time. */
  playNote(midi, time, duration, velocity = 80) {
    const ctx = this.ensure();
    if (this.#plucked()) {
      this.pluck.playPluck(ctx, this.master, midi, time, duration, velocity);
      return;
    }
    const g = ctx.createGain();
    const amp = this.volume.synth * (0.3 + 0.7 * (velocity / 127));
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(amp, time + 0.005);
    g.gain.exponentialRampToValueAtTime(amp * 0.35, time + Math.min(0.6, duration));
    g.gain.setTargetAtTime(0, time + duration, 0.08);
    const f = midiFreq(midi);
    for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 2, 0.25]]) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(time);
      o.stop(time + duration + 0.6);
    }
    g.connect(this.filter);
  }

  allNotesOff() {
    for (const m of [...this.voices.keys()]) this.noteOff(m);
  }
}
