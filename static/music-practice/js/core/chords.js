// Chord theory: chord types, spelling, inversions, symbols and recognition.
// A chord tone is [semitones above the root, letter offset above the root, role].
// Letter offsets: 3rd = 2, 5th = 4, 6th = 5, 7th = 6, 9th = 8, 11th = 10, 13th = 12 (so 9ths spell as 2nds + octave).

import {
  midiOf, diatonicOf, fromDiatonic, spellWithStep, parsePitch, pitchName, simplestSpelling, TONIC_BY_PC,
} from './theory.js';

const t = (semi, letter, role) => [semi, letter, role];
const R = t(0, 0, 'R');
const M3 = t(4, 2, '3');
const m3 = t(3, 2, '♭3');
const P5 = t(7, 4, '5');
const d5 = t(6, 4, '♭5');
const A5 = t(8, 4, '♯5');
const M7 = t(11, 6, '7');
const m7 = t(10, 6, '♭7');
const d7 = t(9, 6, '𝄫7');
const M6 = t(9, 5, '6');
const M9 = t(14, 8, '9');
const b9 = t(13, 8, '♭9');
const s9 = t(15, 8, '♯9');
const P11 = t(17, 10, '11');
const s11 = t(18, 10, '♯11');
const M13 = t(21, 12, '13');

/**
 * Chord types. `symbol` is the suffix after the root (C + 'm7' = Cm7). `optional` lists roles that may be left
 * out when voicing (e.g. the 5th of a 7th chord on guitar). `group` organises menus.
 */
export const CHORD_TYPES = {
  maj: { label: 'Major', symbol: '', group: 'Triads', tones: [R, M3, P5] },
  min: { label: 'Minor', symbol: 'm', group: 'Triads', tones: [R, m3, P5] },
  dim: { label: 'Diminished', symbol: '°', group: 'Triads', tones: [R, m3, d5] },
  aug: { label: 'Augmented', symbol: '+', group: 'Triads', tones: [R, M3, A5] },
  sus2: { label: 'Suspended 2nd', symbol: 'sus2', group: 'Triads', tones: [R, t(2, 1, '2'), P5] },
  sus4: { label: 'Suspended 4th', symbol: 'sus4', group: 'Triads', tones: [R, t(5, 3, '4'), P5] },

  maj6: { label: 'Major 6th', symbol: '6', group: 'Sixths', tones: [R, M3, P5, M6], optional: ['5'] },
  min6: { label: 'Minor 6th', symbol: 'm6', group: 'Sixths', tones: [R, m3, P5, M6], optional: ['5'] },

  maj7: { label: 'Major 7th', symbol: 'maj7', group: 'Sevenths', tones: [R, M3, P5, M7], optional: ['5'] },
  dom7: { label: 'Dominant 7th', symbol: '7', group: 'Sevenths', tones: [R, M3, P5, m7], optional: ['5'] },
  min7: { label: 'Minor 7th', symbol: 'm7', group: 'Sevenths', tones: [R, m3, P5, m7], optional: ['5'] },
  minMaj7: { label: 'Minor-major 7th', symbol: 'm(maj7)', group: 'Sevenths', tones: [R, m3, P5, M7], optional: ['5'] },
  halfDim7: { label: 'Half-diminished 7th', symbol: 'm7♭5', group: 'Sevenths', tones: [R, m3, d5, m7] },
  dim7: { label: 'Diminished 7th', symbol: '°7', group: 'Sevenths', tones: [R, m3, d5, d7] },
  aug7: { label: 'Augmented 7th', symbol: '+7', group: 'Sevenths', tones: [R, M3, A5, m7] },
  augMaj7: { label: 'Augmented major 7th', symbol: '+maj7', group: 'Sevenths', tones: [R, M3, A5, M7] },
  dom7sus4: { label: 'Dominant 7th sus4', symbol: '7sus4', group: 'Sevenths', tones: [R, t(5, 3, '4'), P5, m7], optional: ['5'] },
  dom7b5: { label: 'Dominant 7th ♭5', symbol: '7♭5', group: 'Sevenths', tones: [R, M3, d5, m7] },

  add9: { label: 'Added 9th', symbol: 'add9', group: 'Extended', tones: [R, M3, P5, M9], optional: ['5'] },
  minAdd9: { label: 'Minor added 9th', symbol: 'm(add9)', group: 'Extended', tones: [R, m3, P5, M9], optional: ['5'] },
  six9: { label: '6/9', symbol: '6/9', group: 'Extended', tones: [R, M3, P5, M6, M9], optional: ['5'] },
  dom9: { label: 'Dominant 9th', symbol: '9', group: 'Extended', tones: [R, M3, P5, m7, M9], optional: ['5'] },
  maj9: { label: 'Major 9th', symbol: 'maj9', group: 'Extended', tones: [R, M3, P5, M7, M9], optional: ['5'] },
  min9: { label: 'Minor 9th', symbol: 'm9', group: 'Extended', tones: [R, m3, P5, m7, M9], optional: ['5'] },
  dom7b9: { label: 'Dominant 7th ♭9', symbol: '7♭9', group: 'Extended', tones: [R, M3, P5, m7, b9], optional: ['5'] },
  dom7s9: { label: 'Dominant 7th ♯9', symbol: '7♯9', group: 'Extended', tones: [R, M3, P5, m7, s9], optional: ['5'] },
  dom7s11: { label: 'Dominant 7th ♯11', symbol: '7♯11', group: 'Extended', tones: [R, M3, P5, m7, s11], optional: ['5'] },
  dom11: { label: 'Dominant 11th', symbol: '11', group: 'Extended', tones: [R, P5, m7, M9, P11], optional: ['5', '9'] },
  min11: { label: 'Minor 11th', symbol: 'm11', group: 'Extended', tones: [R, m3, P5, m7, M9, P11], optional: ['5', '9'] },
  dom13: { label: 'Dominant 13th', symbol: '13', group: 'Extended', tones: [R, M3, P5, m7, M9, M13], optional: ['5', '9'] },
  maj13: { label: 'Major 13th', symbol: 'maj13', group: 'Extended', tones: [R, M3, P5, M7, M9, M13], optional: ['5', '9'] },
};

export const CHORD_GROUPS = ['Triads', 'Sixths', 'Sevenths', 'Extended'];

/** Chord type ids in a group (or several groups). */
export function chordTypesIn(...groups) {
  return Object.keys(CHORD_TYPES).filter((id) => groups.includes(CHORD_TYPES[id].group));
}

/** Pitch classes relative to the root. */
export const chordIntervals = (type) => CHORD_TYPES[type].tones.map(([s]) => s % 12);

/** Number of inversions that make sense: one per chord tone within the octave (3rd, 5th, 7th...). */
export function inversionCount(type) {
  return CHORD_TYPES[type].tones.filter(([s]) => s < 12).length;
}

export const INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion', '3rd inversion'];

/**
 * Conventional spelling of a chord root on a pitch class: the one with the fewest accidentals in the chord,
 * ties going to the usual key name (major-ish chords like major keys, minor-ish like minor keys).
 */
export function chordRootName(pc, type) {
  const tones = CHORD_TYPES[type].tones;
  const minorish = tones.some(([s]) => s === 3) && !tones.some(([s]) => s === 4);
  return simplestSpelling(pc, tones.map(([s, l]) => [s, l]), TONIC_BY_PC[minorish ? 'minor' : 'major'][pc]);
}

/**
 * Chord tones as pitches, ascending, in close position from a root pitch.
 * @param root pitch object or name with octave ('C4')
 * @param inversion 0 = root position; k moves the k lowest tones (within the octave) up an octave
 * @returns [{ step, alter, octave, role }]
 */
export function buildChord(root, type, inversion = 0) {
  const r = typeof root === 'string' ? parsePitch(root) : root;
  const base = midiOf(r);
  const d0 = diatonicOf(r);
  let notes = CHORD_TYPES[type].tones.map(([semi, letter, role]) => {
    const p = spellWithStep(base + semi, fromDiatonic(d0 + letter).step);
    return { ...p, role, midi: base + semi };
  });
  const inv = Math.min(inversion, inversionCount(type) - 1);
  for (let k = 0; k < inv; k++) {
    const lowest = notes.reduce((a, b) => (a.midi < b.midi ? a : b));
    lowest.midi += 12;
    lowest.octave += 1;
  }
  // Extended tones sit an octave above the 3rd/5th/7th; after inverting keep everything ascending and compact.
  notes.sort((a, b) => a.midi - b.midi);
  for (let i = 1; i < notes.length; i++) {
    while (notes[i].midi - notes[i - 1].midi > 12) { notes[i].midi -= 12; notes[i].octave -= 1; }
  }
  notes = notes.sort((a, b) => a.midi - b.midi);
  return notes.map(({ midi, ...p }) => p);
}

/** Bass role for an inversion: 'R', '3', '5', '7'... */
export function bassRole(type, inversion) {
  const inner = CHORD_TYPES[type].tones.filter(([s]) => s < 12);
  return inner[Math.min(inversion, inner.length - 1)][2];
}

const pretty = (name) => name.replace(/##/g, '𝄪').replace(/#/g, '♯').replace(/bb/g, '𝄫').replace(/(?<=[A-G])b/g, '♭');

/** Pretty note name without octave: 'Eb' -> 'E♭'. */
export const prettyNote = (nameOrPitch) => pretty(typeof nameOrPitch === 'string' ? nameOrPitch : pitchName(nameOrPitch, false));

/**
 * Chord symbol, e.g. chordSymbol('Eb', 'min7') = 'E♭m7'; with an inversion it becomes a slash chord: 'E♭m7/G♭'.
 */
export function chordSymbol(rootName, type, inversion = 0) {
  const s = pretty(rootName) + CHORD_TYPES[type].symbol;
  if (!inversion) return s;
  const notes = buildChord(`${rootName}4`, type, inversion);
  return `${s}/${prettyNote(notes[0])}`;
}

/** Root-relative pitch-class set of a chord (as a sorted array of 0-11). */
export function chordPcs(rootPc, type) {
  return [...new Set(chordIntervals(type).map((i) => (rootPc + i) % 12))].sort((a, b) => a - b);
}

/**
 * Does a set of played MIDI notes form the chord?
 * @param opts.inversion required inversion (bass note), or null for any
 * @param opts.allowOmit allow leaving out the chord's optional tones (e.g. the 5th)
 * @returns { ok, missing: [pc], extra: [pc], bassOk }
 */
export function matchChord(midis, rootPc, type, { inversion = null, allowOmit = false } = {}) {
  if (!midis.length) return { ok: false, missing: chordPcs(rootPc, type), extra: [], bassOk: false };
  const played = new Set(midis.map((m) => ((m % 12) + 12) % 12));
  const def = CHORD_TYPES[type];
  const required = def.tones
    .filter(([, , role]) => !(allowOmit && def.optional?.includes(role)))
    .map(([s]) => (rootPc + s) % 12);
  const all = new Set(chordPcs(rootPc, type));
  const missing = [...new Set(required.filter((pc) => !played.has(pc)))];
  const extra = [...played].filter((pc) => !all.has(pc));
  let bassOk = true;
  if (inversion !== null) {
    const bassPc = (((Math.min(...midis) % 12) + 12) % 12);
    const role = bassRole(type, inversion);
    const want = def.tones.find(([, , r]) => r === role);
    bassOk = bassPc === (rootPc + want[0]) % 12;
  }
  return { ok: !missing.length && !extra.length && bassOk, missing, extra, bassOk };
}

/**
 * Name a set of MIDI notes: every (root, type, inversion) whose tones exactly match the pitch classes.
 * Sorted with root-position readings first. Useful for "what did I play?" feedback.
 */
export function identifyChord(midis, types = Object.keys(CHORD_TYPES)) {
  if (midis.length < 2) return [];
  const pcs = new Set(midis.map((m) => ((m % 12) + 12) % 12));
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const type of types) {
      const set = chordPcs(root, type);
      if (set.length !== pcs.size || !set.every((pc) => pcs.has(pc))) continue;
      const inner = CHORD_TYPES[type].tones.filter(([s]) => s < 12);
      const inv = inner.findIndex(([s]) => (root + s) % 12 === bass);
      const name = chordRootName(root, type);
      out.push({ root, rootName: name, type, inversion: inv, symbol: chordSymbol(name, type, Math.max(0, inv)) });
    }
  }
  return out.sort((a, b) => (a.inversion === -1) - (b.inversion === -1) || a.inversion - b.inversion);
}

/** Root name placed so its MIDI number lies in [lo, lo+11], as a pitch. */
export function rootPitch(name, lo) {
  const step = name[0];
  const alter = name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0;
  const pc = ((({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[step] + alter) % 12 + 12) % 12;
  const midi = lo + ((pc - (lo % 12) + 12) % 12);
  return spellWithStep(midi, step);
}

