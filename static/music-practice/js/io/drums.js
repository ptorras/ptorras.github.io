// Small synthesized drum kit for the rhythm panel: kick, snares, clap, side stick, hi-hats, toms and cymbals,
// built from oscillators and filtered noise (no samples, so it works offline and loads instantly).
//
// playDrum(ctx, destination, sound, time, velocity)   sound: one of DRUM_SOUNDS

const noiseBuffers = new WeakMap();

/** Two seconds of white noise, shared by every hit on this audio context. */
function noise(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

/** Gain node with a fast attack and an exponential decay to silence after `decay` seconds. */
function envelope(ctx, dest, time, peak, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  g.connect(dest);
  return g;
}

function noiseBurst(ctx, dest, time, { peak, decay, type = 'highpass', freq = 1000, q = 0.7 }) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(envelope(ctx, dest, time, peak, decay));
  src.start(time, Math.random() * 1.5);
  src.stop(time + decay + 0.05);
}

function tone(ctx, dest, time, { type = 'sine', from, to = from, glide = 0.1, peak, decay }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, time);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, time + glide);
  o.connect(envelope(ctx, dest, time, peak, decay));
  o.start(time);
  o.stop(time + decay + 0.05);
}

/** Metallic cymbal/hat body: six detuned square waves (the classic analogue-drum recipe) through filters. */
function metal(ctx, dest, time, { peak, decay, freq = 8000, base = 40 }) {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = freq * 0.7;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 0.8;
  const env = envelope(ctx, dest, time, peak, decay);
  bp.connect(hp).connect(env);
  for (const ratio of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = base * ratio;
    o.connect(bp);
    o.start(time);
    o.stop(time + decay + 0.05);
  }
}

const tom = (from) => (ctx, dest, t, v) => {
  tone(ctx, dest, t, { from, to: from * 0.62, glide: 0.25, peak: 0.9 * v, decay: 0.45 });
  noiseBurst(ctx, dest, t, { peak: 0.12 * v, decay: 0.05, type: 'lowpass', freq: 3000 });
};

const SOUNDS = {
  kick(ctx, dest, t, v) {
    tone(ctx, dest, t, { from: 160, to: 42, glide: 0.11, peak: 1.2 * v, decay: 0.42 });
    noiseBurst(ctx, dest, t, { peak: 0.25 * v, decay: 0.012, type: 'lowpass', freq: 2500 });
  },
  snare(ctx, dest, t, v) {
    tone(ctx, dest, t, { type: 'triangle', from: 220, to: 160, glide: 0.06, peak: 0.55 * v, decay: 0.11 });
    noiseBurst(ctx, dest, t, { peak: 0.75 * v, decay: 0.2, type: 'highpass', freq: 1400 });
  },
  snare2(ctx, dest, t, v) {
    tone(ctx, dest, t, { type: 'triangle', from: 300, to: 190, glide: 0.04, peak: 0.45 * v, decay: 0.08 });
    noiseBurst(ctx, dest, t, { peak: 0.7 * v, decay: 0.14, type: 'bandpass', freq: 3200, q: 0.6 });
  },
  rim(ctx, dest, t, v) {
    tone(ctx, dest, t, { type: 'triangle', from: 1700, peak: 0.5 * v, decay: 0.035 });
    noiseBurst(ctx, dest, t, { peak: 0.35 * v, decay: 0.03, type: 'bandpass', freq: 2600, q: 3 });
  },
  clap(ctx, dest, t, v) {
    for (const d of [0, 0.011, 0.022]) noiseBurst(ctx, dest, t + d, { peak: 0.6 * v, decay: 0.03, type: 'bandpass', freq: 1300, q: 1.2 });
    noiseBurst(ctx, dest, t + 0.03, { peak: 0.5 * v, decay: 0.18, type: 'bandpass', freq: 1200, q: 1 });
  },
  hhClosed(ctx, dest, t, v) { metal(ctx, dest, t, { peak: 0.35 * v, decay: 0.05 }); },
  hhPedal(ctx, dest, t, v) { metal(ctx, dest, t, { peak: 0.25 * v, decay: 0.07, freq: 6500 }); },
  hhOpen(ctx, dest, t, v) { metal(ctx, dest, t, { peak: 0.3 * v, decay: 0.45 }); },
  crash(ctx, dest, t, v) {
    metal(ctx, dest, t, { peak: 0.28 * v, decay: 1.6, freq: 6000, base: 47 });
    noiseBurst(ctx, dest, t, { peak: 0.3 * v, decay: 1.3, type: 'highpass', freq: 4500 });
  },
  ride(ctx, dest, t, v) {
    metal(ctx, dest, t, { peak: 0.16 * v, decay: 0.9, freq: 9500, base: 63 });
    tone(ctx, dest, t, { from: 3100, peak: 0.08 * v, decay: 0.6 });
  },
  tomFloorLow: tom(82),
  tomFloor: tom(98),
  tomLow: tom(118),
  tomMid: tom(140),
  tomHiMid: tom(165),
  tomHigh: tom(195),
};

export const DRUM_SOUNDS = Object.keys(SOUNDS);

/** Play one drum hit at an audio-clock time; velocity 1–127 scales the level. */
export function playDrum(ctx, dest, sound, time, velocity = 100) {
  const fn = SOUNDS[sound];
  if (!fn) return;
  const v = 0.25 + 0.75 * Math.max(0, Math.min(127, velocity)) / 127;
  fn(ctx, dest, Math.max(time, ctx.currentTime), v * 0.8);
}
