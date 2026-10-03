// Ear training logic (no DOM): interval naming, question generators for every exercise, answer checking,
// melody and progression generation. A question carries its playback as events relative to its start:
// { at (s), dur (s), midis: [..] }.

import { CHORD_TYPES, chordIntervals, inversionCount, INVERSION_NAMES } from '../core/chords.js';
import { SCALE_TYPES, scaleIntervals, TONIC_BY_PC } from '../core/theory.js';
import { weightedPick } from './trainer-stats.js';

// ---------------------------------------------------------------- intervals

const SIMPLE = [['P', 1], ['m', 2], ['M', 2], ['m', 3], ['M', 3], ['P', 4], ['TT', 4], ['P', 5], ['m', 6], ['M', 6], ['m', 7], ['M', 7]];
const QUALITY = { P: 'perfect', m: 'minor', M: 'major' };
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th');

/** Name of an interval in semitones: { short: 'm3', name: 'minor 3rd' } (compound: 'M9', 'major 9th'). */
export function intervalName(semis) {
  const a = Math.abs(semis);
  if (a === 0) return { short: 'P1', name: 'unison' };
  const oct = Math.floor(a / 12);
  const [q, n] = SIMPLE[a % 12];
  const number = a % 12 === 0 ? 1 + 7 * oct : n + 7 * oct;
  if (q === 'TT') return oct ? { short: `A${number}`, name: `augmented ${ordinal(number)}` } : { short: 'TT', name: 'tritone' };
  if (number === 8) return { short: 'P8', name: 'octave' };
  return { short: `${q}${number}`, name: `${QUALITY[q]} ${ordinal(number)}` };
}

/** Interval presets: lists of semitone sizes. */
export const INTERVAL_SETS = {
  seconds: { label: '2nds and 3rds', semis: [1, 2, 3, 4] },
  fifth: { label: 'Up to the 5th', semis: [1, 2, 3, 4, 5, 6, 7] },
  octave: { label: 'Up to the octave', semis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  compound: { label: 'All (with 9ths)', semis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
};

// ---------------------------------------------------------------- sets for the other exercises

export const EAR_CHORD_SETS = {
  triads: { label: 'Triads', types: ['maj', 'min', 'dim', 'aug'], invTypes: ['maj', 'min'] },
  sevenths: { label: 'Sevenths', types: ['maj7', 'dom7', 'min7', 'halfDim7', 'dim7'], invTypes: ['maj7', 'dom7', 'min7'] },
  mix: {
    label: 'Triads and 7ths', types: ['maj', 'min', 'dim', 'aug', 'maj7', 'dom7', 'min7', 'halfDim7', 'dim7'],
    invTypes: ['maj', 'min', 'dom7', 'maj7', 'min7'],
  },
};

export const EAR_SCALE_SETS = {
  majmin: { label: 'Major and minor', types: ['major', 'naturalMinor', 'harmonicMinor', 'jazzMinor'] },
  modes: { label: 'Church modes', types: ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'naturalMinor', 'locrian'] },
  jazz: {
    label: 'Jazz and pentatonic',
    types: ['majorPentatonic', 'minorPentatonic', 'blues', 'jazzMinor', 'lydianDominant', 'altered', 'wholeTone', 'dimHalfWhole'],
  },
};

/** Short labels for scale types in this trainer (church mode names for the modes set). */
const SCALE_LABELS = { major: 'Major (Ionian)', naturalMinor: 'Natural minor (Aeolian)', jazzMinor: 'Melodic minor' };
export const scaleLabel = (type) => SCALE_LABELS[type] || SCALE_TYPES[type].label;

/** Scale-degree labels by semitones above the tonic. */
export const DEGREE_LABELS = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];
const SOLFEGE = ['do', 'ra', 're', 'me', 'mi', 'fa', 'fi', 'sol', 'le', 'la', 'te', 'ti'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// ---------------------------------------------------------------- progressions

/** Diatonic chords per mode, by degree index 0-6 (minor uses the harmonic-minor V and the natural VII). */
export const DEGREES = {
  major: [
    { numeral: 'I', semis: 0, type: 'maj' }, { numeral: 'ii', semis: 2, type: 'min' }, { numeral: 'iii', semis: 4, type: 'min' },
    { numeral: 'IV', semis: 5, type: 'maj' }, { numeral: 'V', semis: 7, type: 'maj' }, { numeral: 'vi', semis: 9, type: 'min' },
    { numeral: 'vii°', semis: 11, type: 'dim' },
  ],
  minor: [
    { numeral: 'i', semis: 0, type: 'min' }, { numeral: 'ii°', semis: 2, type: 'dim' }, { numeral: 'III', semis: 3, type: 'maj' },
    { numeral: 'iv', semis: 5, type: 'min' }, { numeral: 'V', semis: 7, type: 'maj' }, { numeral: 'VI', semis: 8, type: 'maj' },
    { numeral: 'VII', semis: 10, type: 'maj' },
  ],
};

/** Progression chord sets as degree indices. */
export const PROG_SETS = {
  basic: { label: 'I IV V', degrees: [0, 3, 4] },
  pop: { label: 'I IV V vi', degrees: [0, 3, 4, 5] },
  common: { label: 'I ii IV V vi', degrees: [0, 1, 3, 4, 5] },
  diatonic: { label: 'All diatonic', degrees: [0, 1, 2, 3, 4, 5, 6] },
};

// Usual functional motion (degree index -> likely next degrees).
const NEXT = { 0: [1, 2, 3, 4, 5], 1: [4, 6, 3], 2: [5, 3], 3: [4, 0, 1], 4: [0, 5], 5: [1, 3, 4], 6: [0, 2] };

/**
 * A chord progression in a mode: `length` chords from the set, following common functional motion, never the
 * same chord twice in a row. The first chord follows the tonic (the key-establishing chord played before).
 * @returns [{ degree, numeral, semis, type }]
 */
export function generateProgression(rng, { mode = 'major', set = 'pop', length = 4, weight = () => 1 } = {}) {
  const allowed = PROG_SETS[set].degrees;
  const out = [];
  let prev = 0;
  for (let i = 0; i < length; i++) {
    let cands = NEXT[prev].filter((d) => allowed.includes(d) && d !== prev);
    if (!cands.length || rng.chance(0.15)) cands = allowed.filter((d) => d !== prev);
    const d = weightedPick(rng, cands, (x) => weight(`prog:${DEGREES[mode][x].numeral}`));
    out.push({ degree: d, ...DEGREES[mode][d] });
    prev = d;
  }
  return out;
}

/** Triad voicings for a progression: bass root below, close upper voices with smooth voice leading. */
export function voiceProgression(tonic, chords) {
  let upper = [tonic, tonic + 4, tonic + 7];
  const voiced = [];
  for (const c of chords) {
    const pcs = chordIntervals(c.type).map((s) => (tonic + c.semis + s) % 12);
    let best = null;
    for (let lo = tonic - 6; lo <= tonic + 6; lo++) {
      if (!pcs.includes(lo % 12)) continue;
      const v = [lo];
      for (let m = lo + 1; v.length < 3; m++) if (pcs.includes(m % 12)) v.push(m);
      const cost = v.reduce((s, m, i) => s + Math.abs(m - upper[i]), 0);
      if (!best || cost < best.cost) best = { v, cost };
    }
    upper = best.v;
    let bass = tonic - 12 + c.semis;
    if (bass > tonic - 5) bass -= 12;
    voiced.push([bass, ...upper]);
  }
  return voiced;
}

// ---------------------------------------------------------------- melodies

/**
 * A diatonic melody of `length` notes (as diatonic indices relative to the tonic, then MIDI).
 * motion: 'step' (seconds), 'leaps' (mostly 3rds-5ths), 'mixed'. Starts on a tonic-triad note, ends on one.
 */
export function generateMelody(rng, { length = 4, motion = 'mixed', tonic = 60, mode = 'major' } = {}) {
  const scale = mode === 'minor' ? MINOR : MAJOR;
  const toMidi = (d) => tonic + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const moves = {
    step: [[1, 5], [-1, 5]],
    leaps: [[1, 1], [-1, 1], [2, 3], [-2, 3], [3, 2], [-3, 2], [4, 2], [-4, 2]],
    mixed: [[1, 4], [-1, 4], [2, 2], [-2, 2], [3, 1], [-3, 1], [4, 1], [-4, 1]],
  }[motion] || [[1, 1], [-1, 1]];
  for (let attempt = 0; attempt < 50; attempt++) {
    const degs = [rng.pick([0, 2, 4])];
    let last = 0;
    while (degs.length < length) {
      const cur = degs[degs.length - 1];
      let opts = moves.filter(([m]) => cur + m >= -3 && cur + m <= 9);
      // After a leap, prefer stepping back the other way.
      if (Math.abs(last) > 2) opts = opts.map(([m, w]) => [m, Math.sign(m) !== Math.sign(last) && Math.abs(m) === 1 ? w * 4 : w]);
      // Avoid ping-pong figures (C A C A): going straight back to the previous note is rarer.
      const prev = degs[degs.length - 2];
      opts = opts.map(([m, w]) => [m, cur + m === prev ? w * 0.25 : w]);
      const m = rng.weighted(opts);
      degs.push(cur + m);
      last = m;
    }
    const end = ((degs[degs.length - 1] % 7) + 7) % 7;
    if (length < 4 || [0, 2, 4].includes(end) || attempt === 49) return { degrees: degs, midis: degs.map(toMidi) };
  }
  return null;
}

/** Dictation check for one note: exact pitch, or the same pitch class when octave tolerant. */
export function dictationNoteOk(expected, played, octaveTolerant = false) {
  return expected === played || (octaveTolerant && ((expected - played) % 12 + 12) % 12 === 0);
}

// ---------------------------------------------------------------- question generation

/** Comfortable range per instrument (MIDI). */
export const RANGES = { piano: [52, 81], guitar: [45, 76] };

const block = (midis, at, dur) => ({ at, dur, midis });
const choice = (id, label, sub = '') => ({ id: String(id), label, sub });

/** Tonic pitch class for the key option: 'fixed' = C (A for minor), 'random' = any. */
function pickTonic(rng, keyMode, mode, [lo, hi]) {
  const pc = keyMode === 'random' ? rng.int(0, 11) : mode === 'minor' ? 9 : 0;
  const center = Math.min(lo + 5, hi - 11);
  return center + ((pc - center) % 12 + 12) % 12; // tonic in [center, center+11]
}

const keyLabel = (tonic, mode) => {
  const name = TONIC_BY_PC[mode][((tonic % 12) + 12) % 12].replace('#', '♯').replace(/(?<=[A-G])b/, '♭');
  return `${name} ${mode}`;
};

/** Cadence I–IV–V–I (minor: i–iv–V–i) on a tonic, as events; returns { events, end }. */
export function cadence(tonic, mode = 'major', start = 0, beat = 0.75) {
  const third = mode === 'minor' ? 3 : 4;
  const sixth = mode === 'minor' ? 8 : 9;
  const chords = [[-12, third, 7, 12], [-7, 5, sixth, 12], [-5, 2, 7, 11], [-12, third, 7, 12]];
  const events = chords.map((c, i) => block(c.map((s) => tonic + s), start + i * beat, i === 3 ? beat * 1.6 : beat * 0.95));
  return { events, end: start + 3 * beat + beat * 1.6 };
}

function arpeggiate(midis, start, style) {
  const ev = [];
  let t = start;
  if (style === 'arp' || style === 'both') {
    midis.forEach((m, i) => ev.push(block([m], t + i * 0.35, 0.35 * (midis.length - i) + 0.4)));
    t += 0.35 * midis.length + 0.6;
  }
  if (style === 'block' || style === 'both' || !ev.length) ev.push(block(midis, t, 1.5));
  return ev;
}

/** Exercise ids and labels. */
export const EXERCISES = {
  intervals: 'Intervals',
  chords: 'Chord qualities',
  inversions: 'Chord inversions',
  scales: 'Scales and modes',
  degrees: 'Scale degrees',
  dictation: 'Melodic dictation',
  progressions: 'Chord progressions',
};

/**
 * Make an ear-training question.
 * @param values panel options
 * @param opts.weight(item) adaptive weight; opts.instrument 'piano' | 'guitar'
 * @returns { exercise, prompt, answer, choices, events, reference, items, reveal, ... }
 */
export function makeEarQuestion(values, rng, { weight = () => 1, instrument = 'piano' } = {}) {
  const range = RANGES[instrument] || RANGES.piano;
  const ex = values.exercise || 'intervals';
  const gen = GENERATORS[ex];
  if (!gen) throw new Error(`Unknown exercise ${ex}`);
  return { exercise: ex, ...gen(values, rng, weight, range) };
}

const GENERATORS = {
  intervals(values, rng, weight, [lo, hi]) {
    const set = (INTERVAL_SETS[values.intervalSet] || INTERVAL_SETS.octave).semis;
    const semis = weightedPick(rng, set, (s) => weight(`int:${intervalName(s).short}`));
    const dir = values.intervalDir === 'mixed' || !values.intervalDir ? rng.pick(['up', 'down', 'harmonic']) : values.intervalDir;
    const low = rng.int(lo, hi - semis);
    const high = low + semis;
    const first = dir === 'down' ? high : low;
    const second = dir === 'down' ? low : high;
    const events = dir === 'harmonic' ? [block([low, high], 0, 1.5)] : [block([first], 0, 0.8), block([second], 0.9, 0.9)];
    const { short, name } = intervalName(semis);
    return {
      prompt: dir === 'harmonic' ? 'Which interval (played together)?' : `Which interval (${dir === 'up' ? 'ascending' : 'descending'})?`,
      answer: short,
      choices: set.map((s) => choice(intervalName(s).short, intervalName(s).short, intervalName(s).name)),
      events,
      reference: [block([first], 0, 1)],
      items: [`int:${short}`],
      reveal: name,
      dir, first, second, set,
      playHint: dir === 'down' ? 'or play the lower note' : 'or play the top note',
    };
  },

  chords(values, rng, weight, [lo, hi]) {
    const types = (EAR_CHORD_SETS[values.chordSet] || EAR_CHORD_SETS.triads).types;
    const type = weightedPick(rng, types, (t) => weight(`chord:${t}`));
    const root = rng.int(lo + 3, Math.min(hi - 12, lo + 15));
    const midis = chordIntervals(type).map((s) => root + s);
    return {
      prompt: 'Which chord quality?',
      answer: type,
      choices: types.map((t) => choice(t, CHORD_TYPES[t].label, CHORD_TYPES[t].symbol ? `C${CHORD_TYPES[t].symbol}` : 'C')),
      events: arpeggiate(midis, 0, values.chordStyle || 'block'),
      reference: [block([root], 0, 1)],
      items: [`chord:${type}`],
      reveal: CHORD_TYPES[type].label,
    };
  },

  inversions(values, rng, weight, [lo, hi]) {
    const types = (EAR_CHORD_SETS[values.chordSet] || EAR_CHORD_SETS.triads).invTypes;
    const type = rng.pick(types);
    const n = inversionCount(type);
    const inv = weightedPick(rng, Array.from({ length: n }, (_, i) => i), (i) => weight(`inv:${i}`));
    const root = rng.int(lo + 3, lo + 12);
    const tones = chordIntervals(type).map((s) => root + s).sort((a, b) => a - b);
    for (let k = 0; k < inv; k++) tones.push(tones.shift() + 12);
    return {
      prompt: `Which inversion? (${CHORD_TYPES[type].label.toLowerCase()} chord)`,
      answer: String(inv),
      choices: Array.from({ length: n }, (_, i) => choice(i, INVERSION_NAMES[i].replace(/^./, (c) => c.toUpperCase()))),
      events: arpeggiate(tones, 0, values.chordStyle || 'block'),
      reference: [block([tones[0]], 0, 1)],
      items: [`inv:${inv}`],
      reveal: `${INVERSION_NAMES[inv]} (${CHORD_TYPES[type].label.toLowerCase()})`,
      chordType: type,
    };
  },

  scales(values, rng, weight, [lo]) {
    const types = (EAR_SCALE_SETS[values.scaleSet] || EAR_SCALE_SETS.majmin).types;
    const type = weightedPick(rng, types, (t) => weight(`scale:${t}`));
    const tonic = rng.int(lo + 3, lo + 14);
    const up = [...scaleIntervals(type), 12].map((s) => tonic + s);
    const notes = values.scaleDir === 'updown' ? up.concat(up.slice(0, -1).reverse()) : up;
    const step = 0.32;
    return {
      prompt: 'Which scale or mode?',
      answer: type,
      choices: types.map((t) => choice(t, scaleLabel(t))),
      events: notes.map((m, i) => block([m], i * step, i === notes.length - 1 ? 1 : step * 1.1)),
      reference: [block([tonic], 0, 1)],
      items: [`scale:${type}`],
      reveal: scaleLabel(type),
    };
  },

  degrees(values, rng, weight, range) {
    const mode = values.tonality === 'mixed' ? rng.pick(['major', 'minor']) : values.tonality || 'major';
    const tonic = pickTonic(rng, values.keyMode, mode, range);
    const pool = values.chromatic ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : mode === 'minor' ? MINOR : MAJOR;
    const semis = weightedPick(rng, pool, (s) => weight(`deg:${DEGREE_LABELS[s]}`));
    const { events, end } = cadence(tonic, mode);
    const opts = [tonic + semis, tonic + semis - 12, tonic + semis + 12].filter((m) => m >= range[0] && m <= range[1]);
    const note = rng.pick(opts.length ? opts : [tonic + semis]);
    return {
      prompt: `Which scale degree? (${keyLabel(tonic, mode)})`,
      answer: String(semis),
      choices: pool.map((s) => choice(s, DEGREE_LABELS[s], SOLFEGE[s])),
      events: [...events, block([note], end + 0.5, 1.2)],
      reference: [block([tonic], 0, 1)],
      items: [`deg:${DEGREE_LABELS[semis]}`],
      reveal: `${DEGREE_LABELS[semis]} (${SOLFEGE[semis]})`,
      tonic, mode, note,
      playHint: 'or play the note (any octave)',
    };
  },

  dictation(values, rng, weight, range) {
    const mode = values.tonality === 'minor' ? 'minor' : values.tonality === 'mixed' ? rng.pick(['major', 'minor']) : 'major';
    const tonic = pickTonic(rng, values.keyMode, mode, [range[0], range[1] - 7]);
    const length = Math.min(8, Math.max(3, parseInt(values.dictLength, 10) || 4));
    const mel = generateMelody(rng, { length, motion: values.dictMotion || 'mixed', tonic, mode });
    const third = mode === 'minor' ? 3 : 4;
    const start = 1.6;
    const beat = 0.7;
    return {
      prompt: `Play the melody back (${keyLabel(tonic, mode)}, ${length} notes)`,
      answer: mel.midis.join(','),
      choices: [],
      events: [block([tonic - 12, tonic + third, tonic + 7], 0, 1.2),
        ...mel.midis.map((m, i) => block([m], start + i * beat, i === length - 1 ? 1 : beat * 0.9))],
      reference: [block([mel.midis[0]], 0, 1)],
      items: [`dict:${values.dictMotion || 'mixed'}`],
      reveal: null,
      melody: mel.midis,
      tonic, mode,
    };
  },

  progressions(values, rng, weight, range) {
    const mode = values.tonality === 'mixed' ? rng.pick(['major', 'minor']) : values.tonality || 'major';
    const tonic = pickTonic(rng, values.keyMode, mode, range);
    const length = parseInt(values.progLength, 10) === 3 ? 3 : 4;
    const prog = generateProgression(rng, { mode, set: values.progSet || 'pop', length, weight });
    const voiced = voiceProgression(tonic, [{ semis: 0, type: mode === 'minor' ? 'min' : 'maj' }, ...prog]);
    const beat = 1.1;
    const events = voiced.map((v, i) => block(v, i === 0 ? 0 : 0.5 + i * beat, i === 0 ? 1.2 : beat * 0.95));
    const degrees = PROG_SETS[values.progSet || 'pop'].degrees;
    return {
      prompt: `Name the ${length} chords after the tonic (${keyLabel(tonic, mode)})`,
      answer: prog.map((c) => c.numeral).join(' '),
      choices: degrees.map((d) => choice(DEGREES[mode][d].numeral, DEGREES[mode][d].numeral)),
      events,
      reference: [block(voiced[0], 0, 1.2)],
      items: prog.map((c) => `prog:${c.numeral}`),
      reveal: prog.map((c) => c.numeral).join(' – '),
      progression: prog, tonic, mode, slots: length,
    };
  },
};

/** Is a button answer correct? */
export const checkEarAnswer = (q, id) => String(id) === q.answer;

/** Progression answer (numerals per slot) -> per-slot booleans. */
export function checkProgression(q, numerals) {
  return q.progression.map((c, i) => numerals[i] === c.numeral);
}

/**
 * Answer id for a note played on the instrument, or null when playing does not answer this exercise.
 * Intervals: the second note (top note for harmonic); the octave is taken from the played note relative to the
 * first note, and folded onto the set (so m2/m9 are told apart only when both are in the set).
 * Degrees: the pitch class relative to the tonic.
 */
export function answerFromPlayed(q, midi) {
  if (q.exercise === 'degrees') return String((((midi - q.tonic) % 12) + 12) % 12);
  if (q.exercise !== 'intervals') return null;
  const raw = q.dir === 'down' ? q.first - midi : midi - q.first;
  if (raw <= 0) return 'none';
  const same = q.set.filter((s) => s % 12 === raw % 12);
  if (!same.length) return intervalName(raw).short;
  const best = same.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
  return intervalName(best).short;
}

/** Item key for the stats from an exercise item, e.g. 'intervals|int:m3'. */
export const statKey = (exercise, item) => `${exercise}|${item}`;
