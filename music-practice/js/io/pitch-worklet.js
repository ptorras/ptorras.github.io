// AudioWorkletProcessor for the guitar input: runs the Analyzer (pitch-core.js) on the input stream and posts one
// compact frame per hop to the main thread, plus a magnitude spectrum shortly after every onset (for chord checks)
// or on request. Times are AudioContext seconds.
//
// main -> worklet: { type: 'params', gateDb?, onsetDelta?, channel? }
//                  { type: 'spectrum', id, at? (context time of the window end; default now), length? (s) }
//                  { type: 'stop' }
// worklet -> main: { type: 'frame', t, rms, peak, f0, clarity, onset, onsetTime }
//                  { type: 'spectrum', id (null when automatic), onsetTime, t, rms, sampleRate, samples }
// The spectrum itself is computed on the main thread so a large FFT never runs on the audio thread.

/* global sampleRate, currentTime */
import { Analyzer } from './pitch-core.js';

class GuitarPitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.channel = o.channel ?? 'mix';
    this.an = new Analyzer({
      sampleRate,
      gateDb: o.gateDb ?? -50,
      onsetDelta: o.onsetDelta,
      minFreq: o.minFreq || 60,
      maxFreq: o.maxFreq || 1500,
      ringSec: 1,
    });
    this.specLen = Math.round((o.chordWindowSec ?? 0.15) * sampleRate);
    this.specDelay = Math.round((o.chordDelaySec ?? 0.015) * sampleRate);
    this.pending = []; // spectra waiting for their window to fill: { end, id, onsetTime, len }
    this.mono = new Float32Array(128);
    this.t0 = null;
    this.running = true;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === 'params') {
      if (m.gateDb !== undefined) this.an.gateDb = m.gateDb;
      if (m.onsetDelta !== undefined) this.an.onsetDelta = m.onsetDelta;
      if (m.channel !== undefined) this.channel = m.channel;
    } else if (m.type === 'spectrum') {
      const len = Math.min(this.an.ringSize >> 1, Math.round((m.length || this.specLen / sampleRate) * sampleRate));
      const end = m.at != null ? Math.round((m.at - this.t0) * sampleRate) : this.an.count;
      this.pending.push({ end: Math.max(end, len), id: m.id ?? null, onsetTime: null, len });
    } else if (m.type === 'stop') {
      this.running = false;
    }
  }

  timeOf(index) {
    return this.t0 + index / sampleRate;
  }

  process(inputs) {
    if (this.t0 === null) this.t0 = currentTime - this.an.count / sampleRate;
    const input = inputs[0];
    const n = input && input.length ? input[0].length : 128;
    if (this.mono.length !== n) this.mono = new Float32Array(n);
    const mono = this.mono;
    if (!input || !input.length) mono.fill(0); // keep the sample clock running
    else if (this.channel === 'mix' || input.length === 1) {
      const chs = input.length;
      mono.set(input[0]);
      for (let c = 1; c < chs; c++) for (let i = 0; i < n; i++) mono[i] += input[c][i];
      if (chs > 1) for (let i = 0; i < n; i++) mono[i] /= chs;
    } else mono.set(input[Math.min(input.length - 1, Number(this.channel) || 0)]);

    this.an.push(mono, (f) => {
      if (f.onset) {
        const end = f.onsetIndex + this.specDelay + this.specLen;
        this.pending.push({ end, id: null, onsetTime: this.timeOf(f.onsetIndex), len: this.specLen });
      }
      this.port.postMessage({
        type: 'frame',
        t: this.timeOf(f.index),
        rms: f.rms,
        peak: f.peak,
        f0: f.f0,
        clarity: f.clarity,
        onset: f.onset,
        onsetTime: f.onset ? this.timeOf(f.onsetIndex) : 0,
      });
    });

    if (this.pending.length) {
      const count = this.an.count;
      this.pending = this.pending.filter((p) => {
        if (p.end > count) return true;
        let samples = new Float32Array(p.len);
        let rms = 0;
        if (this.an.read(p.end, p.len, samples)) {
          for (let i = 0; i < samples.length; i++) rms += samples[i] * samples[i];
          rms = Math.sqrt(rms / samples.length);
        } else samples = null;
        const msg = { type: 'spectrum', id: p.id, onsetTime: p.onsetTime, t: this.timeOf(p.end), rms, sampleRate, samples };
        this.port.postMessage(msg, samples ? [samples.buffer] : []);
        return false;
      });
    }
    return this.running;
  }
}

registerProcessor('guitar-pitch', GuitarPitchProcessor);
