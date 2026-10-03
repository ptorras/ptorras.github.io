// Pure logic of the rhythm panel (drum pads): the pad kit, meters, pattern generators, the level ladder of the
// course, run timing (count-in, repeats, tempo ramps) and scoring helpers. No DOM, so it runs in node.
//
// Pattern:
//   { kind, title?, bars: [{ meter, start, len }], length, notes: [Note], lanes: [pad], anyPad?, accents? }
//   Note: { tick, pad, accent?, soft?, ghost?, demo?, hidden? }
//     accent / soft: with dynamics on, hit hard / softly (notes with neither may be played either way)
//     demo:   played by the app, not by you (the "call" bar of call and response)
//     hidden: expected, but not shown until it has been played or missed (the "response" bar)
//   Times are in ticks (TPQ per quarter note), from the start of the pattern.

export const TPQ = 12; // ticks per quarter: 16ths are 3, eighth triplets 4

// ---------------------------------------------------------------- the pad kit

// Pad i sends note 36 + i by default (Akai MPK pads, bank A), which is also the General MIDI drum map.
export const KICK = 0, RIM = 1, SNARE = 2, CLAP = 3, SNARE2 = 4, TOM_FLOOR_LOW = 5, HH_CLOSED = 6, TOM_FLOOR = 7;
export const HH_PEDAL = 8, TOM_LOW = 9, HH_OPEN = 10, TOM_MID = 11, TOM_HIMID = 12, CRASH = 13, TOM_HIGH = 14, RIDE = 15;

export const PADS = [
  { name: 'Kick', short: 'Kick', sound: 'kick', group: 'kick' },
  { name: 'Side stick', short: 'Stick', sound: 'rim', group: 'snare' },
  { name: 'Snare', short: 'Snare', sound: 'snare', group: 'snare' },
  { name: 'Clap', short: 'Clap', sound: 'clap', group: 'snare' },
  { name: 'Snare 2', short: 'Snr 2', sound: 'snare2', group: 'snare' },
  { name: 'Low floor tom', short: 'Floor 2', sound: 'tomFloorLow', group: 'tom' },
  { name: 'Closed hi-hat', short: 'HH', sound: 'hhClosed', group: 'hat' },
  { name: 'Floor tom', short: 'Floor', sound: 'tomFloor', group: 'tom' },
  { name: 'Pedal hi-hat', short: 'Pedal', sound: 'hhPedal', group: 'hat' },
  { name: 'Low tom', short: 'Tom 3', sound: 'tomLow', group: 'tom' },
  { name: 'Open hi-hat', short: 'Open', sound: 'hhOpen', group: 'hat' },
  { name: 'Mid tom', short: 'Tom 2', sound: 'tomMid', group: 'tom' },
  { name: 'High-mid tom', short: 'Tom 1', sound: 'tomHiMid', group: 'tom' },
  { name: 'Crash', short: 'Crash', sound: 'crash', group: 'cymbal' },
  { name: 'High tom', short: 'Hi tom', sound: 'tomHigh', group: 'tom' },
  { name: 'Ride', short: 'Ride', sound: 'ride', group: 'cymbal' },
];

/** Lanes of the grid from top to bottom: cymbals, hats, toms high to low, snares, kick (drum-notation order). */
export const LANE_ORDER = [CRASH, RIDE, HH_OPEN, HH_CLOSED, HH_PEDAL, TOM_HIGH, TOM_HIMID, TOM_MID, TOM_LOW, TOM_FLOOR,
  TOM_FLOOR_LOW, CLAP, RIM, SNARE2, SNARE, KICK];

/** Computer keys for pads 1–16 (pad 1 bottom left): bottom row Z X C V, then A S D F, Q W E R, 1 2 3 4. */
export const PAD_KEYS = ['z', 'x', 'c', 'v', 'a', 's', 'd', 'f', 'q', 'w', 'e', 'r', '1', '2', '3', '4'];

/** Default note map: pad i = note 36 + i on any channel. */
export const defaultPadMap = () => PADS.map((_, i) => ({ note: 36 + i, channel: null }));

/** Pad index (0–15) of a played note, or -1. A pad learned on a channel only answers on that channel. */
export function padOf(map, note, channel = null) {
  return map.findIndex((m) => m && m.note === note && (m.channel == null || channel == null || m.channel === channel));
}

// ---------------------------------------------------------------- meters

// pulses: length of each beat (or beat group) in ticks. 12 = quarter, 18 = dotted quarter (three eighths).
export const METERS = {
  '2/4': { pulses: [12, 12] },
  '3/4': { pulses: [12, 12, 12] },
  '4/4': { pulses: [12, 12, 12, 12] },
  '5/4': { pulses: [12, 12, 12, 12, 12] },
  '6/8': { pulses: [18, 18] },
  '9/8': { pulses: [18, 18, 18] },
  '12/8': { pulses: [18, 18, 18, 18] },
  '5/8': { pulses: [12, 18] },
  '7/8': { pulses: [12, 12, 18] },
};
export const SIMPLE_METERS = ['4/4', '3/4', '2/4'];
export const MIXED_METERS = ['4/4', '3/4', '2/4', '5/4', '6/8', '7/8', '5/8'];

export const meterLength = (meter) => METERS[meter].pulses.reduce((a, b) => a + b, 0);

/** Pulse start ticks (relative to the bar) and lengths. */
export function pulsesOf(meter) {
  let t = 0;
  return METERS[meter].pulses.map((len) => {
    const p = { start: t, len };
    t += len;
    return p;
  });
}

/** Meter names for `n` bars. `meter` is a meter name, 'simple', 'mixed', or an array to pick from per bar. */
export function chooseMeters(meter, n, rng) {
  const pool = Array.isArray(meter) ? meter : meter === 'mixed' ? MIXED_METERS : meter === 'simple' ? SIMPLE_METERS : null;
  if (!pool) return Array(n).fill(METERS[meter] ? meter : '4/4');
  const out = [];
  for (let i = 0; i < n; i++) {
    // Changing meters should change: avoid repeating the previous bar's meter when there is a choice.
    const options = pool.length > 1 && i > 0 ? pool.filter((m) => m !== out[i - 1]) : pool;
    out.push(rng.pick(options));
  }
  return out;
}

function layoutBars(meters) {
  let start = 0;
  const bars = meters.map((meter) => {
    const bar = { meter, start, len: meterLength(meter) };
    start += bar.len;
    return bar;
  });
  return { bars, length: start };
}

// ---------------------------------------------------------------- rhythm cells

/** Weighted onset cells (tick offsets inside one pulse of `len` ticks) for a subdivision. */
export function cellChoices(len, sub, { rests = false, sync = false } = {}) {
  const c = [];
  const add = (w, ...cells) => cells.forEach((cell) => c.push([cell, w]));
  if (len === 12) {
    if (sub === 'quarter') add(4, [0]);
    if (sub === 'eighth') {
      add(3, [0, 6]); add(2, [0]);
      if (sync) add(1.5, [6]);
    }
    if (sub === 'sixteenth') {
      add(2, [0, 3, 6, 9]); add(1.5, [0, 6, 9], [0, 3, 6]); add(1, [0, 6], [0, 9]); add(0.6, [0]);
      if (sync) add(0.8, [3, 6, 9], [0, 3, 9], [3, 9], [6, 9], [0, 3]);
    }
    if (sub === 'triplet') {
      add(3, [0, 4, 8]); add(1.5, [0, 8]); add(1, [0]);
      if (sync) add(1, [4, 8], [0, 4], [4]);
    }
  } else {
    // A dotted-quarter pulse (compound meters) or a group of three eighths (5/8, 7/8): eighths are the basic unit.
    if (sub === 'quarter') add(4, [0]);
    if (sub === 'eighth' || sub === 'triplet' || sub === 'sixteenth') {
      add(3, [0, 6, 12]); add(2, [0, 12]); add(1.5, [0]); add(1, [0, 6]);
      if (sync) add(1.2, [6, 12], [6], [12]);
    }
    if (sub === 'sixteenth') {
      add(1.5, [0, 3, 6, 12], [0, 6, 9, 12], [0, 6, 12, 15]); add(0.8, [0, 3, 6, 9, 12, 15]);
      if (sync) add(0.8, [3, 6, 12], [0, 9, 12]);
    }
  }
  if (rests) add(len === 12 ? 1 : 0.8, []);
  return c;
}

/** Onsets of one bar (ticks relative to the bar). Never empty. */
export function rhythmBar(meter, { sub = 'eighth', rests = false, sync = false }, rng) {
  const pulses = pulsesOf(meter);
  for (let attempt = 0; attempt < 20; attempt++) {
    const out = [];
    for (const p of pulses) {
      const s = sub === 'mixed' ? rng.pick(p.len === 12 ? ['eighth', 'sixteenth', 'triplet'] : ['eighth', 'sixteenth']) : sub;
      const cell = rng.weighted(cellChoices(p.len, s, { rests, sync }));
      for (const off of cell) out.push(p.start + off);
    }
    // At least two onsets per bar (one for very short bars), and not a bar of rests.
    if (out.length >= Math.min(2, pulses.length)) return out;
  }
  return [0];
}

// ---------------------------------------------------------------- generators

/** Pads used by rhythm exercises with 1–6 pads: the kit pieces you meet first. */
export const RHYTHM_PADS = { 1: [SNARE], 2: [KICK, SNARE], 3: [KICK, SNARE, HH_CLOSED], 4: [KICK, SNARE, HH_CLOSED, TOM_HIGH], 6: [KICK, SNARE, HH_CLOSED, TOM_HIGH, TOM_FLOOR, CRASH] };

/** Mark random onsets (ticks) as accented, at least one accented and one plain per bar when possible. */
function accentTicks(ticks, rng) {
  const acc = new Set(ticks.filter(() => rng.chance(0.35)));
  if (ticks.length > 1) {
    if (acc.size === 0) acc.add(rng.pick(ticks));
    if (acc.size === ticks.length) acc.delete(rng.pick(ticks));
  }
  return acc;
}

function rhythmPattern(spec, rng) {
  const { bars, length } = layoutBars(chooseMeters(spec.meter, spec.bars || 2, rng));
  const pads = RHYTHM_PADS[spec.pads] || RHYTHM_PADS[1];
  const notes = [];
  let prev = -1;
  for (const bar of bars) {
    const ticks = rhythmBar(bar.meter, spec, rng);
    const accents = spec.accents ? accentTicks(ticks, rng) : new Set();
    for (const t of ticks) {
      // Bar starts lean towards the kick; otherwise any pad, avoiding long runs on one pad.
      let pad = pads.length > 1 && t === 0 && rng.chance(0.6) ? pads[0] : rng.pick(pads);
      if (pads.length > 1 && pad === prev && rng.chance(0.5)) pad = rng.pick(pads.filter((p) => p !== pad));
      prev = pad;
      const dyn = spec.accents ? (accents.has(t) ? { accent: true } : { soft: true }) : {};
      notes.push({ tick: bar.start + t, pad, ...dyn });
      if (spec.combos && pads.length > 1 && rng.chance(0.25)) {
        notes.push({ tick: bar.start + t, pad: rng.pick(pads.filter((p) => p !== pad)), ...dyn });
      }
    }
  }
  return finish({ kind: 'rhythm', bars, length, notes, anyPad: pads.length === 1 && spec.anyPad !== false, accents: Boolean(spec.accents) });
}

/** Groove bar: hi-hat time, snare backbeat, kick, optional ghost notes, open hats, crash and a fill. */
function grooveBar(bar, { lanes = 3, feel = 'eighth', kick = 'simple', ghost = false, accents = false, fill = false, crash = false }, rng) {
  const notes = [];
  const add = (tick, pad, extra = {}) => notes.push({ tick: bar.start + tick, pad, ...extra });
  // Dynamics: hats accented on the beats and soft in between, loud backbeat and crash, soft ghost notes.
  const dyn = (hard) => (accents ? (hard ? { accent: true } : { soft: true }) : {});
  const pulses = pulsesOf(bar.meter);
  const fillFrom = fill ? pulses[pulses.length - (pulses.length >= 4 && rng.chance(0.5) ? 2 : 1)].start : Infinity;
  const taken = new Map(); // tick -> pads, to avoid two notes on one pad

  // Time keeping (from 3 lanes): the hi-hat on every subdivision of the feel.
  const timeTicks = [];
  for (const p of pulses) {
    let offs;
    if (feel === 'shuffle' && p.len === 12) offs = [0, 8];
    else {
      const unit = feel === 'sixteenth' ? 3 : feel === 'quarter' ? p.len : 6;
      offs = [];
      for (let t = 0; t < p.len; t += unit) offs.push(t);
    }
    for (const o of offs) timeTicks.push({ tick: p.start + o, onPulse: o === 0, offbeat: o === p.len / 2 || (p.len === 18 && o === 12) });
  }
  if (lanes >= 3) {
    const open = lanes >= 4 ? rng.pick(timeTicks.filter((x) => x.offbeat && x.tick < fillFrom)) : null;
    for (const x of timeTicks) {
      if (x.tick >= fillFrom) continue;
      if (crash && x.tick === 0) continue;
      add(x.tick, x === open ? HH_OPEN : HH_CLOSED, dyn(x.onPulse));
    }
  }
  if (crash) add(0, CRASH, dyn(true));

  // Backbeat: snare on every second pulse (2 and 4 in 4/4, the second dotted quarter in 6/8).
  const snareTicks = new Set();
  pulses.forEach((p, i) => {
    if (i % 2 === 1 && p.start < fillFrom) {
      add(p.start, SNARE, dyn(true));
      snareTicks.add(p.start);
    }
  });
  // Kick: always on one; more beats and off-beats as the kick option gets busier.
  const kicks = new Set([0]);
  pulses.forEach((p, i) => { if (i % 2 === 0 && i > 0 && (kick === 'simple' || rng.chance(0.6))) kicks.add(p.start); });
  const free = (t) => t < fillFrom && !snareTicks.has(t) && !kicks.has(t);
  if (kick !== 'simple') {
    const eighths = pulses.flatMap((p) => (p.len === 12 ? [p.start + 6] : [p.start + 6, p.start + 12])).filter(free);
    for (let n = rng.int(1, 2); n > 0 && eighths.length; n--) kicks.add(eighths.splice(rng.int(0, eighths.length - 1), 1)[0]);
  }
  if (kick === 'sixteenth') {
    const sixteenths = pulses.flatMap((p) => (p.len === 12 ? [p.start + 3, p.start + 9] : [p.start + 3, p.start + 9, p.start + 15])).filter(free);
    for (let n = rng.int(1, 2); n > 0 && sixteenths.length; n--) kicks.add(sixteenths.splice(rng.int(0, sixteenths.length - 1), 1)[0]);
  }
  for (const t of kicks) if (t < fillFrom || t === 0) add(t, KICK);
  // Ghost notes: soft snare on 16ths between the beats.
  if (ghost) {
    const spots = pulses.flatMap((p) => (p.len === 12 ? [p.start + 3, p.start + 9] : [p.start + 3, p.start + 9, p.start + 15]))
      .filter((t) => t < fillFrom && !kicks.has(t));
    for (let n = rng.int(1, 3); n > 0 && spots.length; n--) add(spots.splice(rng.int(0, spots.length - 1), 1)[0], SNARE, { ghost: true, ...dyn(false) });
  }
  // Fill: around the kit from high to low, in the feel's subdivision.
  if (fill) {
    const voices = lanes >= 5 ? [SNARE, TOM_HIGH, TOM_HIMID, TOM_LOW, TOM_FLOOR] : lanes === 4 ? [SNARE, TOM_HIGH, TOM_FLOOR] : [SNARE];
    const unit = feel === 'sixteenth' ? 3 : 6;
    const ticks = [];
    for (let t = fillFrom; t < bar.len; t += unit) ticks.push(t);
    ticks.forEach((t, i) => {
      if (i > 0 && i < ticks.length - 1 && rng.chance(0.15)) return;
      const v = Math.floor((i * voices.length) / ticks.length);
      const firstOfVoice = i === 0 || Math.floor(((i - 1) * voices.length) / ticks.length) !== v;
      add(t, voices[v], firstOfVoice ? dyn(true) : {});
    });
  }
  for (const n of notes) {
    const set = taken.get(n.tick) || new Set();
    n.dup = set.has(n.pad);
    set.add(n.pad);
    taken.set(n.tick, set);
  }
  return notes.filter((n) => !n.dup).map(({ dup, ...n }) => n);
}

function groovePattern(spec, rng) {
  const n = spec.bars || 2;
  const { bars, length } = layoutBars(chooseMeters(spec.meter, n, rng));
  const lanes = +spec.lanes || 3;
  const notes = [];
  bars.forEach((bar, b) => {
    const fill = Boolean(spec.fills) && n >= 2 && (b % 4 === 3 || b === n - 1);
    // A crash marks the start of the pattern and the bar after a fill.
    const crash = lanes >= 5 && (b === 0 || (spec.fills && b % 4 === 0));
    notes.push(...grooveBar(bar, { ...spec, lanes, fill, crash }, rng));
  });
  return finish({ kind: 'groove', bars, length, notes, accents: Boolean(spec.accents) });
}

export const POLYRHYTHMS = {
  '3:2': { label: '3 against 2', meter: '2/4', cross: 3 },
  '2:3': { label: '2 against 3', meter: '3/4', cross: 2 },
  '4:3': { label: '4 against 3', meter: '3/4', cross: 4 },
  '3:4': { label: '3 against 4', meter: '4/4', cross: 3 },
};

/** Beats on the kick, the cross rhythm evenly spread over the bar on the hi-hat. */
function polyPattern(spec) {
  const poly = POLYRHYTHMS[spec.ratio] || POLYRHYTHMS['3:2'];
  const { bars, length } = layoutBars(Array(spec.bars || 2).fill(poly.meter));
  const notes = [];
  for (const bar of bars) {
    for (const p of pulsesOf(bar.meter)) notes.push({ tick: bar.start + p.start, pad: KICK });
    const step = bar.len / poly.cross;
    for (let i = 0; i < poly.cross; i++) notes.push({ tick: bar.start + i * step, pad: HH_CLOSED });
  }
  return finish({ kind: 'poly', bars, length, notes, title: poly.label });
}

/** Call and response: the app plays a bar, you play it back in the next bar (shown only once you have played). */
function echoPattern(spec, rng) {
  const pairs = spec.bars || 4;
  const meters = chooseMeters(spec.meter, pairs, rng).flatMap((m) => [m, m]);
  const { bars, length } = layoutBars(meters);
  const notes = [];
  for (let i = 0; i < pairs; i++) {
    const call = bars[2 * i];
    const resp = bars[2 * i + 1];
    let bar;
    if (spec.style === 'groove') {
      bar = grooveBar({ ...call, start: 0 }, { lanes: 3, feel: spec.sub === 'sixteenth' ? 'sixteenth' : 'eighth', kick: 'eighth' }, rng);
    } else {
      const pads = spec.style === 'two' ? [KICK, SNARE] : [SNARE];
      bar = rhythmBar(call.meter, spec, rng).map((t) => ({ tick: t, pad: rng.pick(pads) }));
    }
    for (const n of bar) {
      notes.push({ ...n, tick: call.start + n.tick, demo: true });
      notes.push({ ...n, tick: resp.start + n.tick, hidden: true });
    }
  }
  return finish({ kind: 'echo', bars, length, notes, anyPad: spec.style !== 'two' && spec.style !== 'groove' && spec.anyPad !== false });
}

/** Pad finder: one pad (or a combination) at a time, at your own pace. */
export const PAD_SETS = {
  4: [KICK, RIM, SNARE, CLAP],
  8: [KICK, RIM, SNARE, CLAP, SNARE2, TOM_FLOOR_LOW, HH_CLOSED, TOM_FLOOR],
  16: PADS.map((_, i) => i),
};

function padsPattern(spec, rng) {
  const set = PAD_SETS[spec.padSet] || PAD_SETS[8];
  const steps = +spec.length || 16;
  const maxCombo = Math.min(+spec.combo || 1, set.length);
  const notes = [];
  let prev = [];
  for (let i = 0; i < steps; i++) {
    const size = rng.int(1, maxCombo);
    let pads;
    do {
      const pool = [...set];
      pads = [];
      while (pads.length < size) pads.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
    } while (set.length > size && pads.length === prev.length && pads.every((p) => prev.includes(p)));
    prev = pads;
    for (const pad of pads) notes.push({ tick: i * TPQ, pad });
  }
  const { bars, length } = layoutBars(Array(Math.ceil(steps / 4)).fill('4/4'));
  return finish({ kind: 'pads', bars, length, notes, cue: spec.cue || 'light' });
}

function finish(p) {
  p.notes.sort((a, b) => a.tick - b.tick || LANE_ORDER.indexOf(a.pad) - LANE_ORDER.indexOf(b.pad));
  const used = new Set(p.notes.map((n) => n.pad));
  p.lanes = p.anyPad ? [...used] : LANE_ORDER.filter((pad) => used.has(pad));
  return p;
}

/** Build a pattern from a spec ({ kind, ... }, see LEVELS and specFromOptions). */
export function makePattern(spec, rng) {
  switch (spec.kind) {
    case 'pads': return padsPattern(spec, rng);
    case 'groove': return groovePattern(spec, rng);
    case 'poly': return polyPattern(spec);
    case 'echo': return echoPattern(spec, rng);
    default: return rhythmPattern(spec, rng);
  }
}

// ---------------------------------------------------------------- the course

const R = (o) => ({ kind: 'rhythm', meter: '4/4', bars: 2, sub: 'eighth', pads: 1, anyPad: true, ...o });
const G = (o) => ({ kind: 'groove', meter: '4/4', bars: 2, lanes: 3, feel: 'eighth', kick: 'simple', ...o });

/** Levels of the course, easiest first. Each one is a pattern spec; you pass a level with PASS_ACCURACY. */
export const LEVELS = [
  { name: 'Meet the pads', info: 'Hit the pad that lights up.', spec: { kind: 'pads', padSet: 8, combo: 1, cue: 'light', length: 12 } },
  { name: 'Quarter notes', info: 'One hit per beat. Count “1 2 3 4”.', spec: R({ sub: 'quarter' }) },
  { name: 'Quarters and rests', info: 'Leave the gaps silent and keep counting through them.', spec: R({ sub: 'quarter', rests: true }) },
  { name: 'Eighth notes', info: 'Two hits per beat: “1 & 2 &”.', spec: R({ sub: 'eighth' }) },
  { name: 'Eighths and rests', info: 'Count every “&”, even when you don’t play it.', spec: R({ sub: 'eighth', rests: true }) },
  { name: 'Kick and snare', info: 'Kick on 1 and 3, snare on 2 and 4.', spec: G({ lanes: 2, feel: 'quarter' }) },
  { name: 'Two pads', info: 'Eighth-note rhythms split between kick and snare.', spec: R({ pads: 2, rests: true }) },
  { name: 'Rock beat', info: 'Hi-hat eighths over kick and snare.', spec: G({}) },
  { name: 'Three-four and two-four', info: 'Shorter bars: the count restarts sooner.', spec: R({ meter: ['3/4', '2/4'], rests: true }) },
  { name: 'Kick variations', info: 'The kick moves to the off-beats.', spec: G({ kick: 'eighth' }) },
  { name: 'Find pad combinations', info: 'Hit two or three pads together. Only the names are shown.', spec: { kind: 'pads', padSet: 16, combo: 3, cue: 'name', length: 12 } },
  { name: 'Syncopation', info: 'Hits on the “&” with the beat left silent.', spec: R({ rests: true, sync: true }) },
  { name: 'Sixteenth notes', info: 'Four hits per beat: “1 e & a”.', spec: R({ sub: 'sixteenth' }) },
  { name: 'Three pads and combinations', info: 'Kick, snare and hi-hat, sometimes together.', spec: R({ pads: 3, combos: true, rests: true }) },
  { name: 'Sixteenth hi-hats', info: 'A busier right hand over the rock beat.', spec: G({ feel: 'sixteenth', kick: 'eighth' }) },
  { name: 'Open hi-hat', info: 'Open the hat on an off-beat.', spec: G({ lanes: 4, kick: 'eighth' }) },
  { name: 'Six-eight', info: 'Two beats per bar, each split in three: “1 & a 2 & a”.', spec: R({ meter: '6/8', rests: true }) },
  { name: 'Triplets', info: 'Three even hits per beat: “1 trip let”.', spec: R({ sub: 'triplet', rests: true }) },
  { name: 'Shuffle', info: 'Swung eighths: the first and last note of each triplet.', spec: G({ feel: 'shuffle', kick: 'eighth' }) },
  { name: 'Fills', info: 'A tom fill ends the phrase, then a crash.', spec: G({ lanes: 5, bars: 4, fills: true, kick: 'eighth' }) },
  { name: 'Accents', info: 'Hit the accented notes (>) hard and the others softly.', spec: R({ sub: 'sixteenth', accents: true }) },
  { name: 'Five-four and seven-eight', info: 'Odd meters: 7/8 is counted 2 + 2 + 3.', spec: R({ meter: ['5/4', '7/8'], rests: true }) },
  { name: 'Ghost notes', info: 'Soft snare notes between the beats, with a syncopated kick.', spec: G({ feel: 'sixteenth', kick: 'sixteenth', ghost: true }) },
  { name: 'Four pads', info: 'Sixteenths across kick, snare, hi-hat and tom.', spec: R({ pads: 4, sub: 'sixteenth', combos: true, rests: true }) },
  { name: 'Changing meters', info: 'A new time signature every bar.', spec: R({ meter: 'mixed', bars: 4, rests: true }) },
  { name: 'Mixed subdivisions', info: 'Eighths, sixteenths and triplets side by side.', spec: R({ sub: 'mixed', rests: true }) },
  { name: 'Call and response', info: 'Listen to a bar, then play it back.', spec: { kind: 'echo', meter: '4/4', bars: 4, style: 'two', sub: 'eighth', rests: true } },
  { name: 'Three against two', info: 'Kick on the beats, hi-hat in threes.', spec: { kind: 'poly', ratio: '3:2', bars: 2 } },
  { name: 'Odd-meter grooves', info: 'Rock beats in 7/8 and 5/4.', spec: G({ meter: ['7/8', '5/4'], kick: 'eighth', lanes: 4 }) },
  { name: 'Four against three', info: 'Hi-hat in fours against three beats.', spec: { kind: 'poly', ratio: '4:3', bars: 2 } },
  { name: 'Everything', info: 'Sixteenths, ghost notes, fills, accents and changing meters.', spec: G({ meter: 'simple', bars: 4, lanes: 5, feel: 'sixteenth', kick: 'sixteenth', ghost: true, fills: true, accents: true }) },
];

export const PASS_ACCURACY = 0.9;
export const PASS_ACCENTS = 0.75;

/** Whether a run's result passes a level. */
export function passes(result) {
  return result.accuracy >= PASS_ACCURACY && (result.accentAccuracy == null || result.accentAccuracy >= PASS_ACCENTS);
}

/** Pattern spec from the panel's sidebar options (custom practice, not the course). */
export function specFromOptions(v) {
  const meter = v.meter || '4/4';
  const bars = +v.bars || 2;
  switch (v.exercise) {
    case 'pads': return { kind: 'pads', padSet: +v.padSet || 8, combo: +v.combo || 1, cue: v.cue || 'light', length: +v.length || 16 };
    case 'groove': return { kind: 'groove', meter, bars, lanes: +v.lanes || 3, feel: v.feel || 'eighth', kick: v.kick || 'simple', ghost: Boolean(v.ghost), fills: Boolean(v.fills), accents: Boolean(v.accents) };
    case 'poly': return { kind: 'poly', ratio: v.ratio || '3:2', bars };
    case 'echo': return { kind: 'echo', meter, bars: +v.pairs || 4, style: v.echoStyle || 'one', sub: v.sub || 'eighth', rests: Boolean(v.rests), anyPad: v.anyPad !== false };
    default: return { kind: 'rhythm', meter, bars, sub: v.sub || 'eighth', rests: Boolean(v.rests), sync: Boolean(v.sync), pads: +v.pads || 1, anyPad: v.anyPad !== false, combos: Boolean(v.combos), accents: Boolean(v.accents) };
  }
}

// ---------------------------------------------------------------- running a pattern

/**
 * Timing of a fixed-tempo run: count-in, `reps` repeats of the pattern, the tempo rising by `ramp` BPM per repeat.
 * Tempo is always quarter notes per minute. Times are seconds, 0 = first downbeat after the count-in.
 * @returns { countIn: [{ t, accent }], clicks: [{ t, accent }], notes: [{ id, idx, rep, at, pad, accent, demo }],
 *            reps: [{ start, bpm, spt }], end }   (notes also carry soft)
 */
export function buildRun(pattern, { bpm = 80, reps = 1, ramp = 0, countIn = true } = {}) {
  const run = { countIn: [], clicks: [], notes: [], reps: [], end: 0 };
  const sptOf = (b) => 60 / Math.max(20, Math.min(300, b)) / TPQ;
  if (countIn) {
    const bar = pattern.bars[0];
    const spt = sptOf(bpm);
    pulsesOf(bar.meter).forEach((p, i) => run.countIn.push({ t: (p.start - bar.len) * spt, accent: i === 0 }));
  }
  let t = 0;
  for (let r = 0; r < Math.max(1, reps); r++) {
    const b = Math.max(20, Math.min(300, bpm + r * ramp));
    const spt = sptOf(b);
    run.reps.push({ start: t, bpm: b, spt });
    for (const bar of pattern.bars) {
      pulsesOf(bar.meter).forEach((p, i) => run.clicks.push({ t: t + (bar.start + p.start) * spt, accent: i === 0 }));
    }
    pattern.notes.forEach((n, i) => run.notes.push({
      id: `${r}:${i}`, idx: i, rep: r, at: t + n.tick * spt, pad: n.pad, accent: Boolean(n.accent), soft: Boolean(n.soft),
      demo: Boolean(n.demo),
    }));
    t += pattern.length * spt;
  }
  run.end = t;
  return run;
}

/** Repeat and tick (ticks from the pattern start) at run time t, or null before the start. */
export function positionAt(run, t) {
  if (t < 0 || !run.reps.length) return null;
  let r = run.reps.length - 1;
  while (r > 0 && run.reps[r].start > t) r--;
  return { rep: r, tick: (t - run.reps[r].start) / run.reps[r].spt };
}

/** Matcher steps (js/practice/matcher.js, secPerQuarter = 1) for the expected notes of a run. */
export function tempoSteps(run, { anyPad = false } = {}) {
  const steps = [];
  for (const n of run.notes) {
    if (n.demo) continue;
    let s = steps[steps.length - 1];
    if (!s || Math.abs(s.time - n.at) > 1e-6) steps.push((s = { pos: steps.length, time: n.at, notes: [] }));
    s.notes.push({ id: n.id, midi: anyPad ? 0 : n.pad, staff: 1 });
  }
  return steps;
}

/** Matcher steps for free tempo: one step per onset of the pattern (ids `0:<note index>`). */
export function waitSteps(pattern, { anyPad = false } = {}) {
  const steps = [];
  pattern.notes.forEach((n, i) => {
    if (n.demo) return;
    let s = steps[steps.length - 1];
    if (!s || s.tick !== n.tick) steps.push((s = { pos: steps.length, tick: n.tick, time: n.tick / TPQ, notes: [] }));
    s.notes.push({ id: `0:${i}`, midi: anyPad ? 0 : n.pad, staff: 1 });
  });
  return steps;
}

/** 'good' for a tight hit, 'loose' for one inside the window but off the beat. */
export const timingClass = (offSec, tolSec) => (Math.abs(offSec) <= Math.max(0.035, tolSec * 0.4) ? 'good' : 'loose');

/** Whether a note asks for a particular force (accented or soft). */
export const hasDynamics = (note) => Boolean(note.accent || note.soft);

/** Whether the force of a hit matches the note's marking (true for notes without one). */
export const dynamicsOk = (note, velocity, threshold) => (note.accent ? velocity >= threshold : note.soft ? velocity < threshold : true);

/** Mean timing offset per pad (ms), for "your kick is late" feedback. offsets: [{ pad, off }] in seconds. */
export function laneOffsets(offsets) {
  const by = new Map();
  for (const { pad, off } of offsets) (by.get(pad) || by.set(pad, []).get(pad)).push(off);
  return [...by].map(([pad, offs]) => ({
    pad, n: offs.length, meanMs: Math.round((1000 * offs.reduce((a, b) => a + b, 0)) / offs.length),
  })).sort((a, b) => LANE_ORDER.indexOf(a.pad) - LANE_ORDER.indexOf(b.pad));
}

// ---------------------------------------------------------------- counting

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const SYLLABLES = {
  12: { 6: ['', '&'], 4: ['', 'trip', 'let'], 3: ['', 'e', '&', 'a'] },
  18: { 6: ['', '&', 'a'], 3: ['', '·', '&', '·', 'a', '·'] },
};

/**
 * Count syllables of a bar ("1 e & a", "1 trip let", "1 & a" for compound beats) at the finest subdivision its
 * notes need (at least eighths). Returns [{ tick (from the pattern start), label, beat }].
 */
export function countLabels(pattern, bar) {
  const out = [];
  pulsesOf(bar.meter).forEach((p, i) => {
    const from = bar.start + p.start;
    let res = p.len;
    for (const n of pattern.notes) if (n.tick >= from && n.tick < from + p.len) res = gcd(res, n.tick - from);
    if (res > 6) res = gcd(res, 6); // show at least the eighths (and keep triplets as triplets)
    const names = SYLLABLES[p.len]?.[res];
    for (let k = 0; k * res < p.len; k++) out.push({ tick: from + k * res, label: k === 0 ? String(i + 1) : names ? names[k] : '', beat: k === 0 });
  });
  return out;
}
