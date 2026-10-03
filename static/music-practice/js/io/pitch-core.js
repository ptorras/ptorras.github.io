// Pure DSP for the guitar audio input: a radix-2 FFT, MPM (NSDF) pitch detection with octave guards, spectral-flux
// onset detection, a harmonic-salience score for chord verification, and a monophonic note tracker.
// No DOM or Web Audio here, so the same code runs in node tests and inside the AudioWorklet (pitch-worklet.js).

export const midiToFreq = (m, a4 = 440) => a4 * 2 ** ((m - 69) / 12);
export const freqToMidi = (f, a4 = 440) => 69 + 12 * Math.log2(f / a4);
export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
export const dbToLin = (db) => 10 ** (db / 20);
export const linToDb = (x) => (x > 1e-10 ? 20 * Math.log10(x) : -200);

// ------------------------------------------------------------ FFT

/** In-place iterative radix-2 complex FFT with precomputed twiddles and bit reversal. */
export class FFT {
  constructor(n) {
    if (n & (n - 1)) throw new Error(`FFT size must be a power of 2 (got ${n})`);
    this.n = n;
    this.cos = new Float64Array(n >> 1);
    this.sin = new Float64Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      this.rev[i] = r;
    }
  }

  /** Transform re/im (length n) in place. The inverse is scaled by 1/n. */
  transform(re, im, inverse = false) {
    const { n, cos, sin, rev } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = cos[t];
        const wi = sign * sin[t];
        for (let a = k; a < n; a += size) {
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

const fftCache = new Map();
/** Shared FFT instance per size. */
export function getFFT(n) {
  if (!fftCache.has(n)) fftCache.set(n, new FFT(n));
  return fftCache.get(n);
}

const hannCache = new Map();
/** Hann window of length n (cached). */
export function hann(n) {
  if (!hannCache.has(n)) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return hannCache.get(n);
}

/**
 * Hann-windowed magnitude spectrum of `x` (zero-padded to fftSize). Magnitudes are scaled so a full-scale sine
 * peaks at about 1. Returns Float32Array(fftSize / 2).
 */
export function magnitudeSpectrum(x, fftSize = nextPow2(x.length)) {
  const n = Math.min(x.length, fftSize);
  const w = hann(n);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  let wsum = 0;
  for (let i = 0; i < n; i++) { re[i] = x[i] * w[i]; wsum += w[i]; }
  getFFT(fftSize).transform(re, im);
  const out = new Float32Array(fftSize >> 1);
  const scale = 2 / wsum;
  for (let k = 0; k < out.length; k++) out[k] = Math.hypot(re[k], im[k]) * scale;
  return out;
}

// ------------------------------------------------------------ pitch (MPM / NSDF)

/**
 * McLeod Pitch Method: normalized square difference function computed from an FFT autocorrelation, key-maximum
 * peak picking, parabolic interpolation, and an octave guard that checks the NSDF at 2x and 3x the chosen lag.
 */
export class PitchDetector {
  /** @param opts { sampleRate, size (window length), minFreq, maxFreq, threshold (MPM k) } */
  constructor({ sampleRate, size = 2048, minFreq = 60, maxFreq = 1500, threshold = 0.88 } = {}) {
    this.sampleRate = sampleRate;
    this.size = size;
    this.threshold = threshold;
    this.fftSize = nextPow2(size * 2);
    this.fft = getFFT(this.fftSize);
    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
    this.minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
    this.maxLag = Math.min(Math.ceil(sampleRate / minFreq), size - 64);
    this.nsdf = new Float64Array(this.maxLag + 2);
  }

  /** Detect the pitch of `x` (length >= size; the last `size` samples are used). Returns { freq, clarity }. */
  detect(x) {
    const { size, re, im, nsdf, maxLag } = this;
    const off = x.length - size;
    let mean = 0;
    for (let i = 0; i < size; i++) mean += x[off + i];
    mean /= size;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < size; i++) re[i] = x[off + i] - mean;
    let energy = 0;
    for (let i = 0; i < size; i++) energy += re[i] * re[i];
    if (energy < 1e-9) return { freq: 0, clarity: 0 };
    // Autocorrelation = IFFT(|X|^2). Keep a copy of the signal for the m'(tau) term.
    const sig = this.sig || (this.sig = new Float64Array(size));
    for (let i = 0; i < size; i++) sig[i] = re[i];
    this.fft.transform(re, im);
    for (let k = 0; k < this.fftSize; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
    this.fft.transform(re, im, true);
    let m = 2 * energy;
    nsdf[0] = 1;
    for (let tau = 1; tau <= maxLag + 1; tau++) {
      m -= sig[tau - 1] * sig[tau - 1] + sig[size - tau] * sig[size - tau];
      nsdf[tau] = m > 1e-12 ? (2 * re[tau]) / m : 0;
    }
    // Key maxima: highest point of each positive lobe after the first negative-going zero crossing.
    const peaks = [];
    let tau = 1;
    while (tau <= maxLag && nsdf[tau] > 0) tau++;
    let best = -1;
    let bestVal = -Infinity;
    for (; tau <= maxLag; tau++) {
      if (nsdf[tau] > 0) {
        if (nsdf[tau] > bestVal) { bestVal = nsdf[tau]; best = tau; }
      } else if (best >= 0) {
        peaks.push(best);
        best = -1;
        bestVal = -Infinity;
      }
    }
    if (best >= 0 && best < maxLag) peaks.push(best);
    const usable = peaks.filter((p) => p >= this.minLag);
    if (!usable.length) return { freq: 0, clarity: 0 };
    let nmax = 0;
    for (const p of usable) nmax = Math.max(nmax, nsdf[p]);
    let chosen = usable.find((p) => nsdf[p] >= this.threshold * nmax);
    let [lag, val] = this.#interp(chosen);
    // Octave guard: a true period has no clearly better NSDF value at its multiples. If 2x or 3x the lag scores
    // higher, the chosen lag was a harmonic (typical for low strings with a strong 2nd harmonic).
    for (let iter = 0; iter < 3; iter++) {
      let switched = false;
      for (const mult of [2, 3]) {
        const target = lag * mult;
        if (target > maxLag) continue;
        const p = this.#peakNear(target);
        if (p < 0) continue;
        const [l2, v2] = this.#interp(p);
        if (v2 > val + 0.04 && Math.abs(l2 / mult - lag) < lag * 0.03) {
          lag = l2;
          val = v2;
          chosen = p;
          switched = true;
          break;
        }
      }
      if (!switched) break;
    }
    const freq = this.sampleRate / lag;
    return { freq, clarity: Math.max(0, Math.min(1, val)) };
  }

  #peakNear(target) {
    const r = Math.max(2, Math.round(target * 0.03));
    let best = -1;
    let bv = 0;
    const lo = Math.max(1, Math.round(target) - r);
    const hi = Math.min(this.maxLag, Math.round(target) + r);
    for (let t = lo; t <= hi; t++) {
      if (this.nsdf[t] > bv && this.nsdf[t] >= this.nsdf[t - 1] && this.nsdf[t] >= this.nsdf[t + 1]) { bv = this.nsdf[t]; best = t; }
    }
    return best;
  }

  #interp(t) {
    const a = this.nsdf[t - 1];
    const b = this.nsdf[t];
    const c = this.nsdf[t + 1];
    const d = a - 2 * b + c;
    if (d >= 0) return [t, b];
    const delta = (0.5 * (a - c)) / d;
    return [t + delta, b - 0.25 * (a - c) * delta];
  }
}

// ------------------------------------------------------------ onsets

/**
 * Spectral flux on log-compressed magnitudes (SuperFlux style: the previous frame is max-filtered across
 * frequency so vibrato and bends do not register as onsets).
 */
export class FluxDetector {
  constructor({ sampleRate, size = 1024, maxFreq = 8000, gamma = 1000 } = {}) {
    this.size = size;
    this.fft = getFFT(size);
    this.win = hann(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.bins = Math.min(size >> 1, Math.round((maxFreq / sampleRate) * size));
    this.prev = new Float64Array(this.bins);
    this.cur = new Float64Array(this.bins);
    this.gamma = gamma;
    let wsum = 0;
    for (let i = 0; i < size; i++) wsum += this.win[i];
    this.scale = 2 / wsum;
  }

  /** Flux of the last `size` samples of x relative to the previous call. */
  flux(x) {
    const { size, re, im, win, bins, prev, cur } = this;
    const off = x.length - size;
    for (let i = 0; i < size; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    this.fft.transform(re, im);
    for (let k = 1; k < bins; k++) cur[k] = Math.log1p(this.gamma * this.scale * Math.hypot(re[k], im[k]));
    let sum = 0;
    for (let k = 2; k < bins - 1; k++) {
      const ref = Math.max(prev[k - 1], prev[k], prev[k + 1]);
      const d = cur[k] - ref;
      if (d > 0) sum += d;
    }
    prev.set(cur);
    return sum / bins;
  }
}

// ------------------------------------------------------------ streaming analyzer

/**
 * Streaming front end: push samples, get one frame per hop.
 * frame = { index (sample count at the end of the window), rms, peak, f0, clarity, flux, onset, onsetIndex }
 * Also keeps a ring buffer so spectra for chord checks can be taken at any recent point.
 */
export class Analyzer {
  /**
   * @param opts { sampleRate, hop, pitchSize, onsetSize, minFreq, maxFreq, gateDb, onsetDelta, onsetLambda,
   *               minOnsetGapSec, ringSec }
   */
  constructor(opts) {
    const sr = opts.sampleRate;
    this.sampleRate = sr;
    this.hop = opts.hop || (sr > 64000 ? 512 : 256);
    this.pitchSize = opts.pitchSize || nextPow2(sr * 0.04);
    this.onsetSize = opts.onsetSize || nextPow2(sr * 0.02);
    this.gateDb = opts.gateDb ?? -50;
    this.onsetDelta = opts.onsetDelta ?? 0.06;
    this.onsetLambda = opts.onsetLambda ?? 1.6;
    this.minOnsetGap = Math.round((opts.minOnsetGapSec ?? 0.06) * sr);
    this.pitch = new PitchDetector({ sampleRate: sr, size: this.pitchSize, minFreq: opts.minFreq || 60, maxFreq: opts.maxFreq || 1500 });
    this.flux = new FluxDetector({ sampleRate: sr, size: this.onsetSize });
    this.ringSize = nextPow2(Math.max(this.pitchSize * 4, sr * (opts.ringSec || 0.6)));
    this.ring = new Float32Array(this.ringSize);
    this.count = 0;
    this.win = new Float32Array(this.pitchSize);
    this.onsetWin = new Float32Array(this.onsetSize);
    // 64-sample block energies for sharpening onset times.
    this.block = 64;
    this.blockE = new Float64Array(1024);
    this.blockAcc = 0;
    this.fluxHist = [];
    this.lastOnset = -Infinity;
    this.peakAcc = 0;
    // Strings that keep ringing under a new note: their periods are notched out with comb filters.
    this.stable = { f0: 0, frames: 0 };
    this.heldF0 = 0;
    this.ringing = []; // [{ f0, until (sample index) }]
    this.ringSec = opts.ringingSec ?? 2;
    this.combBuf = new Float32Array(this.pitchSize + 2 * Math.ceil(sr / (opts.minFreq || 60)) + 4);
    this.combOut = new Float32Array(this.pitchSize);
  }

  /** Feed samples; calls onFrame(frame) for every completed hop. */
  push(samples, onFrame) {
    const mask = this.ringSize - 1;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.ring[this.count & mask] = s;
      this.count++;
      this.blockAcc += s * s;
      const a = s < 0 ? -s : s;
      if (a > this.peakAcc) this.peakAcc = a;
      if (this.count % this.block === 0) {
        this.blockE[(this.count / this.block) & 1023] = this.blockAcc / this.block;
        this.blockAcc = 0;
      }
      if (this.count % this.hop === 0 && this.count >= this.pitchSize) onFrame(this.#analyze());
    }
  }

  /** Copy the `n` samples ending at sample index `end` into `out`. Returns false if no longer buffered. */
  read(end, n, out) {
    if (end > this.count || this.count - (end - n) > this.ringSize || end - n < 0) return false;
    const mask = this.ringSize - 1;
    for (let i = 0; i < n; i++) out[i] = this.ring[(end - n + i) & mask];
    return true;
  }

  /** Magnitude spectrum of `length` samples ending at `end`, zero-padded to fftSize (null if not buffered). */
  spectrum(end, length, fftSize = nextPow2(length)) {
    const x = new Float32Array(length);
    if (!this.read(end, length, x)) return null;
    return magnitudeSpectrum(x, fftSize);
  }

  #analyze() {
    const end = this.count;
    this.read(end, this.pitchSize, this.win);
    // Level over the last half window (~20 ms) for gating and the meter.
    let e = 0;
    const half = this.pitchSize >> 1;
    for (let i = this.pitchSize - half; i < this.pitchSize; i++) e += this.win[i] * this.win[i];
    const rms = Math.sqrt(e / half);
    const peak = this.peakAcc;
    this.peakAcc = 0;
    const gate = dbToLin(this.gateDb);
    let f0 = 0;
    let clarity = 0;
    this.ringing = this.ringing.filter((r) => r.until > end);
    if (rms > gate * 0.25) ({ freq: f0, clarity } = this.#pitch(e / half));
    this.#trackStable(f0, clarity);
    this.read(end, this.onsetSize, this.onsetWin);
    const flux = this.flux.flux(this.onsetWin);
    // Peak-pick the previous frame against an adaptive threshold (median of recent flux), one frame look-ahead.
    const h = this.fluxHist;
    h.push(flux);
    if (h.length > 24) h.shift();
    let onset = false;
    let onsetIndex = -1;
    const n = h.length;
    if (n >= 3) {
      const prev = h[n - 2];
      const sorted = h.slice(0, n - 2).sort((a, b) => a - b);
      const med = sorted.length ? sorted[sorted.length >> 1] : 0;
      const thr = this.onsetDelta + this.onsetLambda * med;
      const prevEnd = end - this.hop;
      if (prev > thr && prev > h[n - 3] && prev >= flux && rms > gate && prevEnd - this.lastOnset > this.minOnsetGap) {
        onsetIndex = this.#refineOnset(prevEnd);
        if (onsetIndex >= 0 && onsetIndex - this.lastOnset > this.minOnsetGap) {
          onset = true;
          this.lastOnset = onsetIndex;
          this.#noteRinging();
        }
      }
    }
    return { index: end, rms, peak, f0, clarity, flux, onset, onsetIndex };
  }

  /**
   * Pitch of the current window. While earlier notes may still ring (after an onset), also try the window with
   * their periods cancelled (y[n] = x[n] - x[n - T] per ringing note) and prefer that estimate when the residual
   * carries real energy, i.e. a different note was added on top.
   */
  #pitch(winEnergy) {
    const plain = this.pitch.detect(this.win);
    if (!this.ringing.length) return plain;
    const N = this.pitchSize;
    const periods = this.ringing.map((r) => this.sampleRate / r.f0);
    const extra = Math.ceil(periods.reduce((a, b) => a + b, 0)) + 2;
    const buf = this.combBuf.subarray(0, N + extra);
    if (!this.read(this.count, N + extra, buf)) return plain;
    let src = buf;
    let len = N + extra;
    for (const T of periods) {
      const d = Math.floor(T);
      const fr = T - d;
      const out = new Float32Array(len - d - 1);
      for (let i = 0; i < out.length; i++) {
        const j = i + d + 1;
        out[i] = src[j] - ((1 - fr) * src[j - d] + fr * src[j - d - 1]);
      }
      src = out;
      len = out.length;
    }
    const y = this.combOut;
    y.set(src.subarray(len - N, len));
    let ey = 0;
    for (let i = N >> 1; i < N; i++) ey += y[i] * y[i];
    ey /= N >> 1;
    const ratio = ey / (winEnergy * 2 ** periods.length + 1e-12);
    let res = plain;
    if (ratio >= 0.12) { // else: only the ringing notes (or a re-pick of the same note)
      const alt = this.pitch.detect(y);
      if (alt.clarity >= 0.75) res = alt;
    }
    // A held note that seems to jump back to a still-ringing string is most likely the old string showing through.
    const near = (a, b) => a > 0 && b > 0 && Math.abs(12 * Math.log2(a / b)) < 0.3;
    if (this.heldF0 && !near(res.freq, this.heldF0) && this.ringing.some((r) => near(res.freq, r.f0))) {
      res = { freq: res.freq, clarity: res.clarity * 0.5 };
    }
    return res;
  }

  #trackStable(f0, clarity) {
    const s = this.stable;
    if (f0 > 0 && clarity >= 0.85 && s.f0 > 0 && Math.abs(12 * Math.log2(f0 / s.f0)) < 0.3) {
      s.frames++;
      s.f0 = f0;
    } else {
      s.f0 = clarity >= 0.85 ? f0 : 0;
      s.frames = s.f0 ? 1 : 0;
    }
    if (s.frames >= 3) this.heldF0 = s.f0;
  }

  /** At an onset the last held pitch may keep ringing under the new note. */
  #noteRinging() {
    const f = this.heldF0;
    this.stable = { f0: 0, frames: 0 };
    this.heldF0 = 0;
    if (!f) return;
    const same = (r) => Math.abs(12 * Math.log2(r.f0 / f)) < 0.3;
    this.ringing = [{ f0: f, until: this.count + this.ringSec * this.sampleRate }, ...this.ringing.filter((r) => !same(r))].slice(0, 2);
  }

  /**
   * The flux peak frame ends at `frameEnd`. Find where the energy (3-block means, ~4 ms) first rises clearly above
   * everything in the preceding ~16 ms. Flux peaks without such a rise (a muted string, the click of a note being
   * cut off) are no onset: returns -1.
   */
  #refineOnset(frameEnd) {
    const B = this.block;
    const E = this.blockE;
    const lastBlock = Math.floor(this.count / B) - 2; // last block whose 3-block mean is complete
    const firstBlock = Math.max(15, Math.floor((frameEnd - this.onsetSize - this.hop) / B));
    const mean3 = (b) => (E[b & 1023] + E[(b + 1) & 1023] + E[(b + 2) & 1023]) / 3 + 1e-12;
    const rises = [];
    let maxRise = -Infinity;
    for (let b = firstBlock; b <= Math.min(lastBlock, Math.floor(frameEnd / B) + 1); b++) {
      let before = 0;
      for (let j = b - 12; j < b; j++) before = Math.max(before, E[j & 1023]);
      const rise = 10 * Math.log10(mean3(b) / (before + 1e-12));
      rises.push([b, rise]);
      maxRise = Math.max(maxRise, rise);
    }
    if (!(maxRise >= 1.5)) return -1;
    const [b] = rises.find(([, r]) => r >= Math.max(1.5, maxRise - 6));
    // blockE[b] holds the block that ends at sample b * B.
    return (b - 1) * B;
  }
}

// ------------------------------------------------------------ chord verification

/**
 * Harmonic salience of candidate notes in a magnitude spectrum (as produced by magnitudeSpectrum).
 * Candidates are processed from low to high; each one takes the spectrally smoothed part of the peaks at its
 * harmonics (Klapuri's smoothness principle) and removes it from a residual, so octave and twelfth "ghosts" of
 * lower notes get little credit unless their harmonics stick out above the lower note's envelope.
 * Returns { scores: { midi: 0..1 relative to the strongest candidate }, raw: { midi: absolute salience } }.
 */
export function notePresence(magnitudes, sampleRate, fftSize, midis, { a4 = 440, maxHarmonics = 12, maxFreq = 5000 } = {}) {
  const binHz = sampleRate / fftSize;
  const mags = magnitudes;
  const resid = Float32Array.from(mags);
  const cands = [...new Set(midis)].sort((a, b) => a - b);
  // Largest true spectral peak (local maximum of the original spectrum) near each harmonic. A window that only
  // contains the slope of a neighbouring peak gives 0, so leakage from nearby notes earns no credit.
  const harmonics = (m, maxH = maxHarmonics) => {
    const f0 = midiToFreq(m, a4);
    const H = Math.max(1, Math.min(maxH, Math.floor(Math.min(maxFreq, sampleRate / 2 - 2 * binHz) / f0)));
    const list = [];
    for (let h = 1; h <= H; h++) {
      const fh = h * f0;
      const c = fh / binHz;
      const w = Math.max(1.5, (fh * 0.0175) / binHz);
      const lo = Math.max(1, Math.floor(c - w));
      const hi = Math.min(mags.length - 2, Math.ceil(c + w));
      let pk = -1;
      for (let k = lo; k <= hi; k++) {
        if (mags[k] >= mags[k - 1] && mags[k] >= mags[k + 1] && (pk < 0 || mags[k] > mags[pk])) pk = k;
      }
      const p0 = pk < 0 ? -1 : Math.max(1, pk - Math.ceil(w));
      list.push({ pk, lo: p0, hi: pk < 0 ? -2 : Math.min(mags.length - 1, pk + Math.ceil(w)), orig: pk < 0 ? 0 : mags[pk] });
    }
    return list;
  };
  // Fundamental gate on the original spectrum: a note whose fundamental has no peak (relative to its own
  // harmonics) is a sub-octave "virtual root" of other notes, and must not explain their energy away.
  const analyse = (m, maxH) => {
    const hs = harmonics(m, maxH);
    let ref = 0;
    for (let i = 0; i < Math.min(6, hs.length); i++) ref = Math.max(ref, hs[i].orig);
    const ratio = ref > 0 ? hs[0].orig / ref : 0;
    return { m, hs, gate: Math.min(1, Math.sqrt(ratio / 0.12)) };
  };
  // Smoothed, weighted harmonic sum; with `subtract`, the claimed part is removed from the residual.
  const salience = ({ hs, gate }, src, subtract) => {
    const H = hs.length;
    const amps = hs.map((x) => (x.pk < 0 ? 0 : src[x.pk]));
    let score = 0;
    for (let i = 0; i < H; i++) {
      const nb = [amps[i]];
      if (i > 0) nb.push(amps[i - 1]);
      if (i + 1 < H) nb.push(amps[i + 1]);
      const avg = nb.reduce((s, v) => s + v, 0) / nb.length;
      const s = Math.min(amps[i], avg) * gate;
      // Odd harmonics (incl. the fundamental) are the ones octave ghosts cannot borrow from a lower note.
      score += (s * (i % 2 === 0 ? 1.5 : 1)) / Math.sqrt(i + 1);
      if (subtract && amps[i] > 0) {
        const keep = 1 - s / amps[i];
        for (let k = hs[i].lo; k <= hs[i].hi; k++) resid[k] *= keep;
      }
    }
    return score;
  };
  // Explainers: notes that are not expected but sit an exact harmonic interval below an expected one, with a real
  // fundamental and strong harmonics (e.g. A2 played where E4 = its 3rd harmonic is expected). They take part in
  // the low-to-high explaining-away so the expected note only gets what they leave.
  const infos = new Map(cands.map((m) => [m, analyse(m)]));
  const maxIndep = Math.max(1e-12, ...cands.map((m) => salience(infos.get(m), mags, false)));
  const explainers = new Set();
  for (const m of cands) {
    for (const d of [12, 19, 24, 28, 31, 36]) {
      const e = m - d;
      if (e < 28 || infos.has(e) || explainers.has(e)) continue;
      const inf = analyse(e);
      if (inf.gate >= 0.6 && salience(inf, mags, false) >= 0.3 * maxIndep) {
        explainers.add(e);
        // Cover every harmonic of the expected note it explains (e.g. up to the 36th for a twelfth below).
        infos.set(e, analyse(e, Math.ceil(maxHarmonics * 2 ** (d / 12)) + 1));
      }
    }
  }
  const raw = {};
  let explained = 0;
  for (const m of [...infos.keys()].sort((a, b) => a - b)) {
    const s = salience(infos.get(m), resid, true);
    if (explainers.has(m)) explained = Math.max(explained, s);
    else raw[m] = s;
  }
  // Reference: the strongest expected note, or a stronger pitch left unexplained in the residual (anywhere in the
  // guitar range), so when other notes are played, coincidental harmonics of the expected ones don't look present.
  let reference = Math.max(1e-12, explained, ...Object.values(raw));
  let strongest = null; // unexplained pitch that set the reference
  for (let m = 28; m <= 100 && midiToFreq(m, a4) < maxFreq / 2; m++) {
    if (infos.has(m)) continue;
    const s = salience(analyse(m), resid, false);
    if (s > reference) { reference = s; strongest = m; }
  }
  const scores = {};
  for (const m of cands) scores[m] = raw[m] / reference;
  return { scores, raw, reference, strongest };
}

// ------------------------------------------------------------ note tracking

/**
 * Monophonic note tracker. Consumes analyzer frames (with `time` in seconds) and returns note events:
 * { type: 'noteon', midi, time, velocity } and { type: 'noteoff', midi, time }.
 *  - After an onset, a note starts (at the onset time) once two frames agree on the pitch.
 *  - Without an onset, a pitch held for a few frames at another semitone is a legato change (hammer-on, slide).
 *  - Deviations under ~0.6 semitone (bends, vibrato) keep the note.
 *  - The note ends when the level decays, the pitch disappears, or a new note starts.
 */
export class NoteTracker {
  constructor({ a4 = 440, gateDb = -50, windowSec = 0.043, minMidi = 23, maxMidi = 96, clarity = 0.8 } = {}) {
    Object.assign(this, { a4, gateDb, windowSec, minMidi, maxMidi, clarity });
    this.decayDb = 36; // note off this far below its peak
    this.reset();
  }

  reset() {
    this.cur = null;
    this.attack = null;
    this.cand = null;
    this.floor = 0;
    this.lastTime = 0;
  }

  /** Close any sounding note (stop, device change). */
  flush(time = this.lastTime) {
    const ev = [];
    if (this.cur) ev.push({ type: 'noteoff', midi: this.cur.midi, time });
    this.cur = null;
    this.attack = null;
    this.cand = null;
    return ev;
  }

  push(f) {
    const ev = [];
    this.lastTime = f.time;
    const gate = dbToLin(this.gateDb);
    const mf = f.f0 > 0 ? freqToMidi(f.f0, this.a4) : NaN;
    const n = Math.round(mf);
    const voiced = f.f0 > 0 && f.clarity >= this.clarity && f.rms >= gate * 0.7 && n >= this.minMidi && n <= this.maxMidi;
    const centered = voiced && Math.abs(mf - n) < 0.4;
    const settle = this.windowSec * 0.5;

    if (f.onset) this.attack = { time: f.onsetTime, votes: [], rmsMax: 0 };

    if (this.attack) {
      const a = this.attack;
      a.rmsMax = Math.max(a.rmsMax, f.rms);
      if (f.time - a.time >= settle) {
        a.votes.push(centered ? n : null);
        const v = a.votes;
        const k = v.length;
        if (k >= 2 && v[k - 1] !== null && v[k - 1] === v[k - 2]) {
          if (this.cur) ev.push({ type: 'noteoff', midi: this.cur.midi, time: a.time });
          this.#start(v[k - 1], a.time, a.rmsMax, ev);
          this.attack = null;
          return ev;
        }
      }
      if (f.time - a.time > 0.15) this.attack = null; // pick or string noise without a stable pitch
      if (this.attack && !this.cur) return ev;
    }

    if (this.cur) {
      const c = this.cur;
      c.peak = Math.max(c.peak, f.rms);
      const decayed = f.rms < Math.max(gate * 0.7, c.peak * dbToLin(-this.decayDb));
      if (voiced && Math.abs(mf - c.midi) < 0.6) {
        c.miss = 0;
        c.missTime = 0;
        this.cand = null;
      } else {
        if (!c.miss) c.missTime = f.time;
        c.miss = (c.miss || 0) + 1;
        if (centered && !decayed && !this.attack) {
          // Legato change: another semitone held for a few frames (octave jumps need longer, they are often errors).
          if (this.cand && this.cand.midi === n) this.cand.count++;
          else this.cand = { midi: n, count: 1, time: f.time };
          const iv = Math.abs(n - c.midi);
          const need = iv === 12 || iv === 19 || iv === 24 ? 8 : 3;
          if (this.cand.count >= need) {
            const t = Math.max(c.start + 0.01, this.cand.time - this.windowSec / 2);
            ev.push({ type: 'noteoff', midi: c.midi, time: t });
            this.#start(n, t, f.rms, ev);
            return ev;
          }
        }
      }
      if (decayed && c.miss >= 2) this.#stop(c.missTime || f.time, f.rms, ev);
      else if (!decayed && c.miss >= 10) this.#stop(c.missTime, f.rms, ev);
      return ev;
    }

    // No note and no pending onset: a clearly rising, stable pitch without a detected onset (soft attack, swell).
    this.floor = Math.min(this.floor || f.rms, f.rms);
    if (centered && f.rms > Math.max(gate * 2, this.floor * 4)) {
      if (this.cand && this.cand.midi === n) this.cand.count++;
      else this.cand = { midi: n, count: 1, time: f.time };
      if (this.cand.count >= 4) this.#start(n, this.cand.time - this.windowSec / 2, f.rms, ev);
    } else this.cand = null;
    return ev;
  }

  #start(midi, time, rms, ev) {
    const db = linToDb(rms);
    const velocity = Math.max(1, Math.min(127, Math.round((127 * (db + 60)) / 54)));
    this.cur = { midi, start: time, peak: rms, miss: 0, missTime: 0 };
    this.cand = null;
    ev.push({ type: 'noteon', midi, time, velocity });
  }

  #stop(time, rms, ev) {
    ev.push({ type: 'noteoff', midi: this.cur.midi, time });
    this.cur = null;
    this.cand = null;
    this.floor = rms;
  }
}
