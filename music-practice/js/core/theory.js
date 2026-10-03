// Core music theory helpers: pitch spelling, keys, scales.
// A pitch is { step: 'C'..'B', alter: -2..2, octave: number } (scientific octave, C4 = middle C).

export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export const stepIndex = (step) => STEPS.indexOf(step);

export function midiOf(p) {
  return 12 * (p.octave + 1) + STEP_SEMITONES[stepIndex(p.step)] + (p.alter || 0);
}

/** Diatonic index: number of letter-name steps above C0. */
export function diatonicOf(p) {
  return p.octave * 7 + stepIndex(p.step);
}

/** Pitch at a diatonic index with the given alteration. */
export function fromDiatonic(d, alter = 0) {
  const octave = Math.floor(d / 7);
  return { step: STEPS[d - octave * 7], alter, octave };
}

/** Alteration that a key signature applies to a step. */
export function keyAlter(step, fifths) {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.indexOf(step) < -fifths ? -1 : 0;
  return 0;
}

/** Pitch at diatonic index d with the alteration implied by the key. */
export function diatonicInKey(d, fifths) {
  const p = fromDiatonic(d);
  p.alter = keyAlter(p.step, fifths);
  return p;
}

const ACC_TEXT = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };

export function pitchName(p, withOctave = true) {
  return p.step + ACC_TEXT[p.alter || 0] + (withOctave ? p.octave : '');
}

/** Parse 'C#4', 'Bb3', 'Ebb5', 'F' (octave defaults to 4). */
export function parsePitch(s) {
  const m = /^([A-Ga-g])(##|#|bb|b)?(-?\d+)?$/.exec(s.trim());
  if (!m) throw new Error(`Bad pitch: ${s}`);
  const alter = { '##': 2, '#': 1, bb: -2, b: -1 }[m[2]] || 0;
  return { step: m[1].toUpperCase(), alter, octave: m[3] !== undefined ? parseInt(m[3], 10) : 4 };
}

/** Spell a MIDI number, preferring sharps or flats for black keys. */
export function spellMidi(midi, preferSharps = true) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const natural = STEP_SEMITONES.indexOf(pc);
  if (natural >= 0) return { step: STEPS[natural], alter: 0, octave };
  if (preferSharps) return { step: STEPS[STEP_SEMITONES.indexOf(pc - 1)], alter: 1, octave };
  return { step: STEPS[STEP_SEMITONES.indexOf(pc + 1)], alter: -1, octave };
}

/** Spell a MIDI number using a given letter (for diatonic spelling). */
export function spellWithStep(midi, step) {
  const idx = stepIndex(step);
  // Choose the octave whose natural letter is nearest to midi.
  let best = null;
  for (let octave = Math.floor(midi / 12) - 2; octave <= Math.floor(midi / 12) + 1; octave++) {
    const alter = midi - (12 * (octave + 1) + STEP_SEMITONES[idx]);
    if (Math.abs(alter) <= 2 && (best === null || Math.abs(alter) < Math.abs(best.alter))) {
      best = { step, alter, octave };
    }
  }
  return best;
}

export const midiName = (midi, preferSharps = true) => pitchName(spellMidi(midi, preferSharps));

// ---------------------------------------------------------------- keys

const MAJOR_TONICS = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C',
  1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};
const MINOR_TONICS = {
  '-7': 'Ab', '-6': 'Eb', '-5': 'Bb', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D', 0: 'A',
  1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#',
};

/** All 30 key signatures as { fifths, mode, tonic, name }. */
export const KEYS = [];
for (let f = -7; f <= 7; f++) {
  KEYS.push({ fifths: f, mode: 'major', tonic: MAJOR_TONICS[f], name: `${MAJOR_TONICS[f]} major` });
  KEYS.push({ fifths: f, mode: 'minor', tonic: MINOR_TONICS[f], name: `${MINOR_TONICS[f]} minor` });
}

/** The 12 commonly used keys per mode (avoids 7-accidental enharmonic duplicates). */
export const COMMON_KEYS = KEYS.filter((k) => Math.abs(k.fifths) <= 6 && !(k.fifths === -6 && k.mode === 'major') && !(k.fifths === 6 && k.mode === 'minor'));

export function findKey(tonic, mode) {
  return KEYS.find((k) => k.tonic === tonic && k.mode === mode);
}

/** Key signature (in fifths) of the major key on a tonic name such as 'F#' or 'Bb'. */
export function majorFifthsOf(name) {
  const p = parsePitch(name);
  return { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 }[p.step] + 7 * p.alter;
}

export function keyName(fifths, mode = 'major') {
  return (mode === 'minor' ? MINOR_TONICS : MAJOR_TONICS)[fifths] + ' ' + mode;
}

// ---------------------------------------------------------------- scales

/** Conventional tonic spelling per pitch class for major and minor keys. */
export const TONIC_BY_PC = {
  major: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  minor: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
};

/**
 * Scale definitions. A scale is either
 *  - `steps`: 7 semitone offsets, one per letter name (diatonic spelling), or
 *  - `degrees`: [semitones, letterOffset] pairs, for scales with 5, 6 or 8 notes or unusual spellings
 *    (letterOffset counts letter names above the tonic: 0 = tonic letter, 2 = third, ...).
 * Key signature: `mode` 'major'/'minor' use the conventional key; `fifthsOffset` gives the signature relative
 * to the major key on the same tonic (modes, pentatonics); `sig: 'none'` writes the scale with accidentals only.
 * `group` organises the scale menu.
 */
export const SCALE_TYPES = {
  major: { label: 'Major (Ionian)', name: 'major', group: 'Major & minor', mode: 'major', steps: [0, 2, 4, 5, 7, 9, 11] },
  naturalMinor: { label: 'Natural minor (Aeolian)', name: 'natural minor', group: 'Major & minor', mode: 'minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { label: 'Harmonic minor', group: 'Major & minor', mode: 'minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: {
    label: 'Melodic minor (classical)', name: 'melodic minor', group: 'Major & minor', mode: 'minor',
    steps: [0, 2, 3, 5, 7, 9, 11], descendingSteps: [0, 2, 3, 5, 7, 8, 10],
  },
  chromatic: { label: 'Chromatic', group: 'Major & minor', mode: 'major', chromatic: true },
  // Church modes. fifthsOffset: key signature relative to the major key on the same tonic.
  lydian: { label: 'Lydian', group: 'Modes', mode: 'lydian', modal: true, fifthsOffset: 1, steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { label: 'Mixolydian', group: 'Modes', mode: 'mixolydian', modal: true, fifthsOffset: -1, steps: [0, 2, 4, 5, 7, 9, 10] },
  dorian: { label: 'Dorian', group: 'Modes', mode: 'dorian', modal: true, fifthsOffset: -2, steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: 'Phrygian', group: 'Modes', mode: 'phrygian', modal: true, fifthsOffset: -4, steps: [0, 1, 3, 5, 7, 8, 10] },
  locrian: { label: 'Locrian', group: 'Modes', mode: 'locrian', modal: true, fifthsOffset: -5, steps: [0, 1, 3, 5, 6, 8, 10] },
  // Jazz: melodic minor (same up and down) and its modes, written with accidentals.
  jazzMinor: { label: 'Jazz melodic minor', group: 'Jazz', sig: 'none', jazz: true, steps: [0, 2, 3, 5, 7, 9, 11] },
  dorianFlat2: { label: 'Dorian ♭2 (Phrygian ♮6)', name: 'Dorian ♭2', group: 'Jazz', sig: 'none', jazz: true, steps: [0, 1, 3, 5, 7, 9, 10] },
  lydianAugmented: { label: 'Lydian augmented', group: 'Jazz', sig: 'none', jazz: true, steps: [0, 2, 4, 6, 8, 9, 11] },
  lydianDominant: { label: 'Lydian dominant', group: 'Jazz', sig: 'none', jazz: true, steps: [0, 2, 4, 6, 7, 9, 10] },
  mixolydianFlat6: { label: 'Mixolydian ♭6', group: 'Jazz', sig: 'none', jazz: true, steps: [0, 2, 4, 5, 7, 8, 10] },
  locrianNat2: { label: 'Locrian ♮2 (half-diminished)', name: 'Locrian ♮2', group: 'Jazz', sig: 'none', jazz: true, steps: [0, 2, 3, 5, 6, 8, 10] },
  altered: {
    label: 'Altered (super Locrian)', name: 'altered', group: 'Jazz', sig: 'none', jazz: true,
    // Spelled as a dominant: R ♭9 ♯9 3 ♯11 ♭13 ♭7.
    degrees: [[0, 0], [1, 1], [3, 1], [4, 2], [6, 3], [8, 5], [10, 6]],
  },
  phrygianDominant: { label: 'Phrygian dominant', group: 'Jazz', fifthsOffset: -4, steps: [0, 1, 4, 5, 7, 8, 10] },
  bebopDominant: { label: 'Bebop dominant', group: 'Jazz', fifthsOffset: -1, jazz: true, degrees: [[0, 0], [2, 1], [4, 2], [5, 3], [7, 4], [9, 5], [10, 6], [11, 6]] },
  bebopMajor: { label: 'Bebop major', group: 'Jazz', fifthsOffset: 0, jazz: true, degrees: [[0, 0], [2, 1], [4, 2], [5, 3], [7, 4], [8, 4], [9, 5], [11, 6]] },
  bebopDorian: { label: 'Bebop Dorian', group: 'Jazz', fifthsOffset: -2, jazz: true, degrees: [[0, 0], [2, 1], [3, 2], [4, 2], [5, 3], [7, 4], [9, 5], [10, 6]] },
  // Pentatonic and blues, in the key signature of the tonic's major or minor key.
  majorPentatonic: { label: 'Major pentatonic', group: 'Pentatonic & blues', fifthsOffset: 0, degrees: [[0, 0], [2, 1], [4, 2], [7, 4], [9, 5]] },
  minorPentatonic: { label: 'Minor pentatonic', group: 'Pentatonic & blues', fifthsOffset: -3, degrees: [[0, 0], [3, 2], [5, 3], [7, 4], [10, 6]] },
  blues: { label: 'Blues (minor)', name: 'blues', group: 'Pentatonic & blues', fifthsOffset: -3, degrees: [[0, 0], [3, 2], [5, 3], [6, 4], [7, 4], [10, 6]] },
  majorBlues: { label: 'Major blues', group: 'Pentatonic & blues', fifthsOffset: 0, degrees: [[0, 0], [2, 1], [3, 2], [4, 2], [7, 4], [9, 5]] },
  // Symmetric scales.
  wholeTone: { label: 'Whole tone', group: 'Symmetric', sig: 'none', degrees: [[0, 0], [2, 1], [4, 2], [6, 3], [8, 4], [10, 6]] },
  dimHalfWhole: { label: 'Diminished (half-whole)', name: 'half-whole diminished', group: 'Symmetric', sig: 'none', degrees: [[0, 0], [1, 1], [3, 1], [4, 2], [6, 3], [7, 4], [9, 5], [10, 6]] },
  dimWholeHalf: { label: 'Diminished (whole-half)', name: 'whole-half diminished', group: 'Symmetric', sig: 'none', degrees: [[0, 0], [2, 1], [3, 2], [5, 3], [6, 4], [8, 5], [9, 5], [11, 6]] },
};

/** [semitones, letterOffset] pairs of a scale (ascending, or the descending form when it differs). */
export function scaleDegrees(type, descending = false) {
  const def = SCALE_TYPES[type];
  if (def.chromatic) return Array.from({ length: 12 }, (_, i) => [i, null]);
  if (def.degrees) return def.degrees;
  const steps = (descending && def.descendingSteps) || def.steps;
  return steps.map((s, i) => [s, i]);
}

/** Number of notes per octave. */
export const scaleSize = (type) => scaleDegrees(type).length;

/** Semitone offsets (relative to the tonic) of a scale, ascending form. */
export const scaleIntervals = (type) => scaleDegrees(type).map(([s]) => s);

/** Scale type ids grouped for menus: [[group, [ids]]]. */
export function scaleGroups(filter = () => true) {
  const groups = new Map();
  for (const [id, def] of Object.entries(SCALE_TYPES)) {
    if (!filter(id, def)) continue;
    if (!groups.has(def.group)) groups.set(def.group, []);
    groups.get(def.group).push(id);
  }
  return [...groups.entries()];
}

/** Display name of a scale type, for titles: "major", "harmonic minor", "Dorian", "Bebop dominant". */
export function scaleName(type) {
  const def = SCALE_TYPES[type];
  return def.name || (def.mode === 'major' || def.mode === 'minor' ? def.label.toLowerCase() : def.label);
}

/** The seven church modes in scale-degree order of a major key (Ionian on degree 1, Dorian on 2, ...). */
export const MODES_BY_DEGREE = ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'naturalMinor', 'locrian'];
/** The seven church modes from brightest to darkest (for comparing modes on one tonic). */
export const MODES_BY_BRIGHTNESS = ['lydian', 'major', 'mixolydian', 'dorian', 'naturalMinor', 'phrygian', 'locrian'];

const nameOf = (step, alter) => step + ({ '-1': 'b', 0: '', 1: '#' })[alter];

/** All single-accidental spellings of a pitch class, e.g. 1 -> ['C#', 'Db']. */
export function spellingsOf(pc) {
  const out = [];
  for (const step of STEPS) {
    for (const alter of [-1, 0, 1]) {
      if ((((STEP_SEMITONES[stepIndex(step)] + alter) % 12) + 12) % 12 === pc) out.push(nameOf(step, alter));
    }
  }
  return out;
}

/**
 * Spelling of a modal tonic on a pitch class: the one whose key signature has the fewest accidentals
 * (ties go to the `prefer` spelling, else to sharps). Returns { name, fifths }.
 */
export function modalTonic(pc, fifthsOffset, prefer = null) {
  let best = null;
  for (const name of spellingsOf(pc)) {
    const fifths = majorFifthsOf(name) + fifthsOffset;
    if (Math.abs(fifths) > 7) continue;
    if (!best || Math.abs(fifths) < Math.abs(best.fifths) || (Math.abs(fifths) === Math.abs(best.fifths) && (prefer ? name === prefer : fifths > best.fifths))) {
      best = { name, fifths };
    }
  }
  return best;
}

/**
 * Root/tonic spelling that keeps the notes of a set of [semitones, letterOffset] degrees simplest:
 * fewest accidentals, with double accidentals counting triple. Ties go to `prefer`.
 */
export function simplestSpelling(pc, degrees, prefer = null) {
  let best = null;
  for (const name of spellingsOf(pc)) {
    const root = parsePitch(`${name}4`);
    const r = midiOf(root);
    const d0 = diatonicOf(root);
    // The root's own accidental counts extra, and B#, E#, Cb and Fb roots are a last resort.
    let cost = 2 * Math.abs(root.alter) + (root.alter && !isBlackKey(r) ? 3 : 0);
    for (const [semi, letter] of degrees) {
      if (letter === null) continue;
      const p = spellWithStep(r + semi, fromDiatonic(d0 + letter).step);
      const a = p ? Math.abs(p.alter) : 9;
      cost += a === 2 ? 3 : a;
    }
    if (!best || cost < best.cost || (cost === best.cost && name === prefer)) best = { name, cost };
  }
  return best.name;
}

/**
 * Tonic spelling and key signature for a scale type on a pitch class.
 * @returns { name, fifths, mode } (mode: the key's mode, for display)
 */
export function scaleTonic(pc, type) {
  const def = SCALE_TYPES[type];
  const iv = scaleIntervals(type);
  const minorish = iv.includes(3) && !iv.includes(4);
  const prefer = TONIC_BY_PC[minorish ? 'minor' : 'major'][pc];
  if (def.chromatic) return { name: TONIC_BY_PC.major[pc], fifths: 0, mode: 'major' };
  if (def.fifthsOffset !== undefined) {
    const { name, fifths } = modalTonic(pc, def.fifthsOffset, prefer);
    return { name, fifths, mode: def.mode || 'major' };
  }
  if (def.sig === 'none') return { name: simplestSpelling(pc, scaleDegrees(type), prefer), fifths: 0, mode: 'major' };
  const name = TONIC_BY_PC[def.mode][pc];
  return { name, fifths: findKey(name, def.mode).fifths, mode: def.mode };
}

/**
 * Ascending/descending scale as pitches.
 * @param tonic pitch with octave (the bottom note)
 * @param direction 'up' | 'down' | 'updown' ('down' starts at the top)
 */
export function buildScale(tonic, type, octaves = 1, direction = 'updown') {
  const def = SCALE_TYPES[type];
  if (!def) throw new Error(`Unknown scale type ${type}`);
  const base = midiOf(tonic);
  const up = [];
  const down = [];
  if (def.chromatic) {
    // Common convention: sharps ascending, flats descending; tonics keep their own spelling.
    const n = 12 * octaves;
    const spell = (i, sharps) => (i % 12 === 0 ? { ...tonic, octave: tonic.octave + i / 12 } : spellMidi(base + i, sharps));
    for (let i = 0; i <= n; i++) up.push(spell(i, true));
    for (let i = n; i >= 0; i--) down.push(spell(i, false));
  } else {
    const t0 = diatonicOf(tonic);
    // Jazz and symmetric scales are read enharmonically: no double accidentals, and scales that are not
    // one-note-per-letter also avoid Cb, Fb, E# and B#.
    const flex = def.sig === 'none' || Boolean(def.degrees);
    const make = (degs, i) => {
      const n = degs.length;
      const oct = Math.floor(i / n);
      const [semi, letter] = degs[i % n];
      const midi = base + 12 * oct + semi;
      const p = spellWithStep(midi, fromDiatonic(t0 + 7 * oct + letter).step);
      const awkward = Math.abs(p.alter) === 2 || (def.degrees && p.alter && !isBlackKey(midi));
      return flex && i % n !== 0 && awkward ? spellMidi(midi, p.alter > 0) : p;
    };
    const upDegs = scaleDegrees(type);
    const downDegs = scaleDegrees(type, true);
    for (let i = 0; i <= upDegs.length * octaves; i++) up.push(make(upDegs, i));
    for (let i = downDegs.length * octaves; i >= 0; i--) down.push(make(downDegs, i));
  }
  if (direction === 'up') return up;
  if (direction === 'down') return down;
  return up.concat(down.slice(1));
}

/** Diatonic triad (or seventh) built on a degree index, in a key, as diatonic indices. */
export function chordDiatonic(rootDiatonic, size = 3) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(rootDiatonic + 2 * i);
  return out;
}

export const isBlackKey = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

export function samePitch(a, b) {
  return a.step === b.step && (a.alter || 0) === (b.alter || 0) && a.octave === b.octave;
}
