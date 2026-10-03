// Audio note input (guitar through an audio interface, or an acoustic/digital piano through a mic or line in):
// runs pitch/onset detection in an AudioWorklet (pitch-worklet.js) and turns it into note events shaped like
// MidiManager's, plus continuous pitch for the tuner and a chord check (verifyNotes) for steps with several notes.
// The instrument profile (setProfile) sets the pitch search band and the playable range.
//
// Events (on(type, fn) returns an unsubscribe function):
//   noteon  { midi, velocity, channel: 0, time (performance.now() ms of the onset), source: 'audio' }
//   noteoff { midi, channel: 0, time, source: 'audio' }
//   pitch   { freq, midi (float), note, cents, clarity, rms, time }
//   level   { rms, peak, db }
//   onset   { time }
//   status  { state: 'off' | 'starting' | 'on' | 'error', message }

import { NoteTracker, notePresence, magnitudeSpectrum, nextPow2, freqToMidi, linToDb } from './pitch-core.js';

const loaded = new WeakSet(); // contexts that already have the worklet module

/** Exact harmonic relations (octave, twelfth, two octaves...): such notes can't be told apart from a lower note. */
const HARMONIC_INTERVALS = new Set([12, 19, 24, 31, 36]);

/** Per-instrument detection settings: pitch search band (Hz) of the worklet and note range for note events. */
export const INPUT_PROFILES = {
  guitar: { label: 'Guitar input', minFreq: 60, maxFreq: 1500, minMidi: 35, maxMidi: 90 },
  // Below G1 a 40 ms window holds too few periods (and piano bass fundamentals are weak), so the range starts there.
  piano: { label: 'Audio input', minFreq: 48, maxFreq: 4300, minMidi: 31, maxMidi: 108 },
};

export class GuitarInput {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.listeners = {};
    this.state = 'off';
    this.message = '';
    this.deviceId = '';
    this.channel = 'mix';
    this.inputLatency = 0.01; // s, from the track settings when available
    this.latencyOverride = null;
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this._sensitivity = 0.5;
    this._a4 = 440;
    this.profile = INPUT_PROFILES.guitar;
    this.tracker = new NoteTracker({ a4: this._a4, gateDb: this.gateDb, minMidi: this.profile.minMidi, maxMidi: this.profile.maxMidi });
    this.lastOnset = null; // { ctxTime, time }
    this.spectrum = null; // last spectrum message from the worklet
    this.waiters = [];
    this.levelAcc = { n: 0, rms: 0, peak: 0 };
    this.reqId = 0;
  }

  on(type, fn) {
    (this.listeners[type] ||= new Set()).add(fn);
    return () => this.listeners[type]?.delete(fn);
  }

  #emit(type, detail) {
    for (const fn of this.listeners[type] || []) {
      try { fn(detail); } catch (err) { console.error(err); }
    }
  }

  #status(state, message = '') {
    this.state = state;
    this.message = message;
    this.#emit('status', { state, message });
  }

  get running() {
    return this.state === 'on';
  }

  /** 0..1, higher picks up quieter playing (gate from -30 dBFS at 0 to -70 dBFS at 1). */
  get sensitivity() { return this._sensitivity; }
  set sensitivity(v) {
    this._sensitivity = Math.max(0, Math.min(1, Number(v)));
    this.tracker.gateDb = this.gateDb;
    this.node?.port.postMessage({ type: 'params', gateDb: this.gateDb, onsetDelta: this.onsetDelta });
  }

  get gateDb() { return -30 - 40 * this._sensitivity; }
  get onsetDelta() { return 0.1 - 0.08 * this._sensitivity; }

  /** Reference pitch for A4 in Hz (default 440). */
  get a4() { return this._a4; }
  set a4(v) {
    this._a4 = Math.max(400, Math.min(480, Number(v) || 440));
    this.tracker.a4 = this._a4;
  }

  /**
   * Estimated latency (ms) from the string to the audio clock: input + base + output latency (these change while
   * running, so it is recomputed). Event times are moved earlier by this much. Assign a number to override,
   * null to go back to the estimate.
   */
  get latencyMs() {
    if (this.latencyOverride !== null) return this.latencyOverride;
    const ctx = this.ctx;
    return Math.round((this.inputLatency + (ctx?.baseLatency || 0) + (ctx?.outputLatency || 0)) * 1000);
  }
  set latencyMs(v) {
    this.latencyOverride = v === null || v === undefined ? null : Number(v);
  }

  /** Playable range for note events (e.g. from the tuning: lowest string - 1 to highest string + 24). */
  setRange(minMidi, maxMidi) {
    this.tracker.minMidi = minMidi;
    this.tracker.maxMidi = maxMidi;
  }

  /**
   * Switch the instrument profile ('guitar' | 'piano'): resets the note range, and restarts a running input since
   * the worklet's pitch band is fixed when it is created. Resolves when done.
   */
  async setProfile(name) {
    const profile = INPUT_PROFILES[name] || INPUT_PROFILES.guitar;
    const changed = profile !== this.profile;
    this.profile = profile;
    this.setRange(profile.minMidi, profile.maxMidi);
    if (changed && this.running) await this.start();
  }

  /** Audio input devices: [{ id, label }]. Labels need permission, so this asks once if they are hidden. */
  async listDevices() {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return [];
    const inputs = async () => (await md.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    let list = await inputs();
    if (list.length && list.every((d) => !d.label) && !this.stream) {
      try {
        const s = await md.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        list = await inputs();
      } catch { /* permission denied: keep generic labels */ }
    }
    return list.map((d, i) => ({ id: d.deviceId, label: d.label || `Audio input ${i + 1}` }));
  }

  /**
   * Open the device and start detection. channel: 'mix' | 0 | 1 (interfaces often put the guitar on input 1 of
   * a stereo stream). Resolves to true on success; on failure the status is 'error' with a message.
   */
  async start(deviceId = this.deviceId, { channel = this.channel } = {}) {
    const run = (this.startChain || Promise.resolve()).then(() => this.#start(deviceId, channel));
    this.startChain = run.catch(() => {});
    return run;
  }

  async #start(deviceId, channel) {
    this.#teardown();
    this.deviceId = deviceId || '';
    this.channel = channel === 'mix' ? 'mix' : Number(channel) || 0;
    this.#status('starting', 'Opening audio input…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Audio input is not supported in this browser.'), { name: 'NotSupported' });
      const ctx = this.audio.ensure();
      this.ctx = ctx;
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      if (!ctx.audioWorklet) throw Object.assign(new Error('AudioWorklet is not supported in this browser.'), { name: 'NotSupported' });
      if (!loaded.has(ctx)) {
        await ctx.audioWorklet.addModule(new URL('./pitch-worklet.js', import.meta.url));
        loaded.add(ctx);
      }
      const audio = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        latency: { ideal: 0.005 },
      };
      if (this.deviceId) audio.deviceId = { exact: this.deviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() || {};
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'guitar-pitch', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers', // mono inputs are copied to both channels, so 0, 1 and 'mix' all work
        processorOptions: {
          channel: this.channel, gateDb: this.gateDb, onsetDelta: this.onsetDelta,
          minFreq: this.profile.minFreq, maxFreq: this.profile.maxFreq,
        },
      });
      // The node must be pulled by the destination to run, but the input must not be monitored: zero gain.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute).connect(ctx.destination);
      node.port.onmessage = (e) => this.#onMessage(e.data);
      Object.assign(this, { node, source, mute, track });
      track.addEventListener('ended', () => {
        if (this.track === track) {
          this.#teardown();
          this.#status('error', 'The audio input was disconnected.');
        }
      });
      this.inputLatency = typeof settings.latency === 'number' ? settings.latency : 0.01;
      this.tracker.reset();
      this.lastOnset = null;
      this.spectrum = null;
      const chLabel = this.channel === 'mix' ? '' : ` (input ${this.channel + 1})`;
      this.#status('on', `${track?.label || 'Audio input'}${chLabel}`);
      return true;
    } catch (err) {
      this.#teardown();
      this.#status('error', friendlyError(err));
      return false;
    }
  }

  /** Stop capturing. Sounding notes get a noteoff. */
  stop() {
    const was = this.state;
    this.#teardown();
    if (was !== 'off') this.#status('off', `${this.profile.label} off.`);
  }

  /** Pick the channel of a stereo input while running: 'mix' | 0 | 1. */
  setChannel(channel) {
    this.channel = channel === 'mix' ? 'mix' : Number(channel) || 0;
    this.node?.port.postMessage({ type: 'params', channel: this.channel });
  }

  #teardown() {
    const now = performance.now();
    for (const e of this.tracker.flush()) this.#emit('noteoff', { midi: e.midi, channel: 0, time: now, source: 'audio' });
    if (this.node) {
      this.node.port.postMessage({ type: 'stop' });
      this.node.port.onmessage = null;
      try { this.source.disconnect(); this.node.disconnect(); this.mute.disconnect(); } catch { /* already gone */ }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = this.source = this.mute = this.stream = this.track = null;
    for (const w of this.waiters.splice(0)) w(null);
  }

  /** Convert an AudioContext time of the input signal to performance.now() ms of when it was played. */
  toPerfTime(ctxTime) {
    const ctx = this.ctx;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
      // The output timestamp says when a context time is heard; the input captured in the same render quantum
      // was played (input + base + output latency) earlier.
      return ts.performanceTime + (ctxTime - ts.contextTime) * 1000 - this.latencyMs;
    }
    return performance.now() - (ctx.currentTime - ctxTime) * 1000 - (this.inputLatency || 0) * 1000;
  }

  #onMessage(m) {
    if (m.type === 'spectrum') {
      this.#onSpectrum(m);
      return;
    }
    if (m.type !== 'frame') return;
    if (m.onset) {
      const time = this.toPerfTime(m.onsetTime);
      this.lastOnset = { ctxTime: m.onsetTime, time };
      this.#emit('onset', { time });
    }
    for (const e of this.tracker.push({ ...m, time: m.t })) {
      const time = this.toPerfTime(e.time);
      if (e.type === 'noteon') this.#emit('noteon', { midi: e.midi, velocity: e.velocity, channel: 0, time, source: 'audio' });
      else this.#emit('noteoff', { midi: e.midi, channel: 0, time, source: 'audio' });
    }
    if (m.f0 > 0 && m.clarity >= 0.6) {
      const midi = freqToMidi(m.f0, this._a4);
      const note = Math.round(midi);
      this.#emit('pitch', { freq: m.f0, midi, note, cents: (midi - note) * 100, clarity: m.clarity, rms: m.rms, time: this.toPerfTime(m.t) });
    }
    const L = this.levelAcc;
    L.n++;
    L.rms = Math.max(L.rms, m.rms);
    L.peak = Math.max(L.peak, m.peak);
    if (L.n >= 3) {
      this.#emit('level', { rms: L.rms, peak: L.peak, db: linToDb(L.peak) });
      L.n = L.rms = L.peak = 0;
    }
  }

  #onSpectrum(m) {
    if (!m.samples) return;
    const fftSize = nextPow2(m.samples.length) * 2;
    const spec = { ...m, fftSize, mags: magnitudeSpectrum(m.samples, fftSize) };
    delete spec.samples;
    if (m.id === null) this.spectrum = spec;
    for (const w of this.waiters.splice(0)) w(spec);
  }

  #nextSpectrum(timeoutMs, accept) {
    return new Promise((resolve) => {
      let done = false;
      const waiter = (spec) => {
        if (done) return;
        if (spec && !accept(spec)) { this.waiters.push(waiter); return; }
        done = true;
        resolve(spec);
      };
      this.waiters.push(waiter);
      setTimeout(() => waiter(null), timeoutMs);
    });
  }

  /**
   * Are these notes sounding? Judged on a spectrum taken just after the most recent onset (150 ms window starting
   * 15 ms after it; available ~170 ms after the onset), or on the latest 150 ms if there was no recent onset.
   * Returns { present, missing, ambiguous, scores, onsetTime }. `ambiguous` lists present notes that are exact
   * octaves/twelfths of another present note: their presence can't really be confirmed from the spectrum.
   * opts: { threshold = 0.15 (score relative to the strongest expected note), timeoutMs = 400 }
   */
  async verifyNotes(midis, { threshold = 0.15, timeoutMs = 400 } = {}) {
    const notes = [...new Set(midis)];
    const none = { present: [], missing: notes, ambiguous: [], scores: {}, onsetTime: null };
    if (!this.running || !notes.length) return none;
    const onset = this.lastOnset;
    let spec = this.spectrum;
    const recent = onset && this.ctx.currentTime - onset.ctxTime < 2;
    if (recent && (!spec || spec.onsetTime !== onset.ctxTime)) {
      spec = await this.#nextSpectrum(timeoutMs, (s) => s.onsetTime === onset.ctxTime);
    } else if (!recent) {
      const id = ++this.reqId;
      this.node.port.postMessage({ type: 'spectrum', id });
      spec = await this.#nextSpectrum(timeoutMs, (s) => s.id === id);
    }
    if (!spec) return none;
    const res = { ...none, onsetTime: onset && spec.onsetTime === onset.ctxTime ? onset.time : null };
    if (spec.rms < 10 ** (this.gateDb / 20)) return res; // silence
    const { scores } = notePresence(spec.mags, spec.sampleRate, spec.fftSize, notes, { a4: this._a4 });
    res.scores = scores;
    res.present = notes.filter((m) => scores[m] >= threshold);
    res.missing = notes.filter((m) => scores[m] < threshold);
    res.ambiguous = res.present.filter((m) => res.present.some((l) => HARMONIC_INTERVALS.has(m - l)));
    return res;
  }
}

function friendlyError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permission to use the audio input was denied. Allow microphone access for this site and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'The selected audio input was not found. Check that the interface is connected.';
    case 'NotReadableError':
      return 'The audio input is busy or could not be opened (another app may be using it).';
    default:
      return err?.message || 'Could not start the audio input.';
  }
}
