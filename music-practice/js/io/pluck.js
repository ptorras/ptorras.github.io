// Plucked-string synth (extended Karplus–Strong) for playing guitar exercises back with a guitar-like sound.
// karplusStrong() is pure (Float32Array out) so the tests use it to synthesize realistic plucks too.

const midiFreq = (m) => 440 * 2 ** ((m - 69) / 12);

/** Small seeded PRNG (mulberry32) so a cached pluck is deterministic. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Karplus–Strong string: noise burst excitation shaped by pick position and brightness, a two-point loss
 * filter, and an all-pass for fractional delay so the pitch is in tune.
 * @param opts { brightness 0..1, pickPos (fraction of string, 0.13 ≈ near bridge), t60 (s, at the fundamental),
 *               seed, amplitude }
 */
export function karplusStrong(sampleRate, freq, duration, opts = {}) {
  const brightness = opts.brightness ?? 0.6;
  const pickPos = opts.pickPos ?? 0.13;
  const t60 = opts.t60 ?? Math.max(0.8, 5 * (82.4 / freq) ** 0.6);
  const rand = rng(opts.seed ?? Math.round(freq * 1000));
  const len = Math.max(1, Math.round(duration * sampleRate));
  const out = new Float32Array(len);
  const p = sampleRate / freq;
  const S = 0.5; // two-point average: exactly half a sample of delay at every frequency
  let N = Math.floor(p - S);
  let d = p - S - N;
  if (d < 0.1) { N -= 1; d += 1; }
  const C = (1 - d) / (1 + d);
  // Per-loop gain so the fundamental decays with the requested T60 (the loss filter already damps cos(pi f / sr)).
  const lossAtF = Math.cos((Math.PI * freq) / sampleRate);
  const g = Math.min(0.99995, 10 ** ((-3 * p) / (t60 * sampleRate)) / lossAtF);
  // Excitation: one period of noise, low-passed by brightness, comb-filtered by pick position.
  const exc = new Float64Array(N);
  const lp = 1 - (0.15 + 0.8 * brightness);
  let y = 0;
  for (let i = 0; i < N; i++) {
    y = (1 - lp) * (rand() * 2 - 1) + lp * y;
    exc[i] = y;
  }
  const pd = Math.max(1, Math.round(pickPos * N));
  const shaped = new Float64Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) { shaped[i] = exc[i] - (i >= pd ? exc[i - pd] : 0); mean += shaped[i]; }
  mean /= N;
  const buf = new Float64Array(N);
  for (let i = 0; i < N; i++) buf[i] = shaped[i] - mean;
  let ptr = 0;
  let prev = 0; // previous delay-line output, for the loss filter
  let apIn = 0;
  let apOut = 0;
  let peak = 0;
  for (let n = 0; n < len; n++) {
    const cur = buf[ptr];
    const lossOut = g * ((1 - S) * cur + S * prev);
    prev = cur;
    const ap = C * lossOut + apIn - C * apOut;
    apIn = lossOut;
    apOut = ap;
    buf[ptr] = ap;
    ptr = ptr + 1 === N ? 0 : ptr + 1;
    out[n] = cur;
    if (Math.abs(cur) > peak) peak = Math.abs(cur);
  }
  // DC blocker plus a short fade-out, then normalize.
  let x1 = 0;
  let y1 = 0;
  const R = 0.995;
  for (let n = 0; n < len; n++) {
    const yy = out[n] - x1 + R * y1;
    x1 = out[n];
    y1 = yy;
    out[n] = yy;
  }
  const fade = Math.min(len, Math.round(0.01 * sampleRate));
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  peak = 0;
  for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(out[n]));
  const amp = (opts.amplitude ?? 0.8) / (peak || 1);
  for (let n = 0; n < len; n++) out[n] *= amp;
  return out;
}

const cache = new WeakMap(); // ctx -> Map(key -> AudioBuffer)

/** AudioBuffer of a plucked note, cached per context, midi and brightness (reused when long enough). */
export function pluckBuffer(ctx, midi, duration, { brightness = 0.6 } = {}) {
  if (!cache.has(ctx)) cache.set(ctx, new Map());
  const map = cache.get(ctx);
  const key = `${midi}:${brightness}`;
  const want = Math.min(8, Math.max(1.5, duration + 0.5));
  const hit = map.get(key);
  if (hit && hit.duration >= want) return hit;
  const len = Math.max(want, hit ? hit.duration : 0, 3);
  const data = karplusStrong(ctx.sampleRate, midiFreq(midi), len, { brightness, seed: midi * 7919 });
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.copyToChannel(data, 0);
  map.set(key, buf);
  return buf;
}

/** Schedule a plucked note at `time` (audio seconds) into `destination`. Returns the source node. */
export function playPluck(ctx, destination, midi, time, duration, velocity = 80) {
  const t = Math.max(time, ctx.currentTime);
  const v = Math.max(0, Math.min(127, velocity)) / 127;
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(ctx, midi, duration, { brightness: 0.35 + 0.5 * v });
  const g = ctx.createGain();
  const amp = 0.15 + 0.85 * v * v;
  g.gain.setValueAtTime(amp, t);
  const end = t + Math.max(0.05, duration);
  g.gain.setValueAtTime(amp, end);
  g.gain.setTargetAtTime(0, end, 0.04); // damped by the fretting hand
  src.connect(g).connect(destination);
  src.start(t);
  src.stop(Math.min(t + src.buffer.duration, end + 0.4));
  return src;
}
