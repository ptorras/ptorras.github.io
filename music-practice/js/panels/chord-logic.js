// Chord trainer logic (no DOM): option choices, question generation, answer checking and the staff model.

import {
  CHORD_TYPES, chordTypesIn, buildChord, chordRootName, chordSymbol, inversionCount, INVERSION_NAMES,
  matchChord, identifyChord, prettyNote, chordPcs, bassRole, rootPitch,
} from '../core/chords.js';
import { COMMON_KEYS, buildScale, parsePitch, midiOf, pitchName, findKey, spellMidi } from '../core/theory.js';
import { DUR } from '../core/musicxml.js';
import { weightedPick } from './trainer-stats.js';

const COMMON7 = ['maj7', 'dom7', 'min7', 'halfDim7', 'dim7'];
const TRIADS4 = ['maj', 'min', 'dim', 'aug'];

/** Chord sets for the "Chord set" option. */
export const CHORD_SETS = {
  majmin: { label: 'Major & minor', group: 'Triads', types: ['maj', 'min'] },
  triads: { label: 'Maj, min, dim, aug', group: 'Triads', types: TRIADS4 },
  triadsSus: { label: 'All triads (with sus)', group: 'Triads', types: chordTypesIn('Triads') },
  sevenths: { label: 'Common 7ths', group: 'Sevenths', types: COMMON7 },
  seventhsAll: { label: 'All 7ths', group: 'Sevenths', types: chordTypesIn('Sevenths') },
  sixths: { label: '6th chords', group: 'Sixths & extended', types: chordTypesIn('Sixths') },
  ninths: { label: 'add9 and 9ths', group: 'Sixths & extended', types: ['add9', 'minAdd9', 'dom9', 'maj9', 'min9'] },
  extended: { label: 'All extended', group: 'Sixths & extended', types: chordTypesIn('Extended') },
  mixBasic: { label: 'Triads + common 7ths', group: 'Mix', types: [...TRIADS4, ...COMMON7] },
  mix67: { label: 'Triads, 6ths and 7ths', group: 'Mix', types: [...TRIADS4, ...chordTypesIn('Sixths'), ...COMMON7] },
  all: { label: 'Everything', group: 'Mix', types: Object.keys(CHORD_TYPES) },
};

/** Grouped choices for js/ui/forms.js. */
export function chordSetChoices() {
  const groups = [];
  for (const [id, s] of Object.entries(CHORD_SETS)) {
    let g = groups.find((x) => x.group === s.group);
    if (!g) groups.push((g = { group: s.group, choices: [] }));
    g.choices.push([id, s.label]);
  }
  return groups;
}

const pretty = (s) => s.replace(/#/g, '♯').replace(/(?<=[A-G])b/g, '♭');

/** Key choices ('Eb-major') for the "key's diatonic chords" root option. */
export const KEY_CHOICES = [
  { group: 'Major', choices: COMMON_KEYS.filter((k) => k.mode === 'major').sort((a, b) => a.fifths - b.fifths).map((k) => [`${k.tonic}-major`, pretty(k.name)]) },
  { group: 'Minor', choices: COMMON_KEYS.filter((k) => k.mode === 'minor').sort((a, b) => a.fifths - b.fifths).map((k) => [`${k.tonic}-minor`, pretty(k.name)]) },
];

export const NATURAL_NAMES = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };

/** Chord type whose tones (semitones above the root) are exactly `iv`, or undefined. */
function typeFromIntervals(iv) {
  return Object.keys(CHORD_TYPES).find((t) => {
    const s = CHORD_TYPES[t].tones.map(([x]) => x);
    return s.length === iv.length && s.every((x, i) => x === iv[i]);
  });
}

/**
 * Diatonic triads and sevenths of a key ('Eb-major', 'C#-minor'). Minor keys use natural minor plus the
 * harmonic-minor V and vii° chords. Returns [{ rootPc, rootName, type, degree }].
 */
export function diatonicChords(keyId) {
  const [tonic, mode] = keyId.split('-');
  const scales = mode === 'minor' ? [['naturalMinor', null], ['harmonicMinor', [4, 6]]] : [['major', null]];
  const out = [];
  for (const [scale, degrees] of scales) {
    const pitches = buildScale(parsePitch(`${tonic}4`), scale, 2, 'up');
    for (let d = 0; d < 7; d++) {
      if (degrees && !degrees.includes(d)) continue;
      for (const size of [3, 4]) {
        const notes = Array.from({ length: size }, (_, i) => pitches[d + 2 * i]);
        const iv = notes.map((p) => midiOf(p) - midiOf(notes[0]));
        const type = typeFromIntervals(iv);
        if (!type) continue;
        const rootName = pitchName(notes[0], false);
        if (out.some((c) => c.rootName === rootName && c.type === type)) continue;
        out.push({ rootPc: ((midiOf(notes[0]) % 12) + 12) % 12, rootName, type, degree: d });
      }
    }
  }
  return out;
}

/** Key signature (fifths) for a key id. */
export const keyFifths = (keyId) => {
  const [tonic, mode] = keyId.split('-');
  return findKey(tonic, mode)?.fifths ?? 0;
};

/** All (root, type) candidates for the options. */
export function candidateChords(values) {
  const types = (CHORD_SETS[values.chordSet] || CHORD_SETS.majmin).types;
  if (values.roots === 'key') {
    const dia = diatonicChords(values.key || 'C-major');
    const inSet = dia.filter((c) => types.includes(c.type));
    // Sets with no diatonic members (e.g. 9ths) fall back to the key's triads and sevenths.
    return inSet.length ? inSet : dia;
  }
  const pcs = values.roots === 'naturals' ? [0, 2, 4, 5, 7, 9, 11] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const out = [];
  for (const pc of pcs) {
    for (const type of types) {
      out.push({ rootPc: pc, rootName: values.roots === 'naturals' ? NATURAL_NAMES[pc] : chordRootName(pc, type), type });
    }
  }
  return out;
}

/** Inversions to ask for a type: 'root' -> [0], 'inv' -> inversions only, 'all' -> all. */
export function allowedInversions(type, mode) {
  const n = inversionCount(type);
  if (mode === 'root') return [0];
  const all = Array.from({ length: n }, (_, i) => i);
  return mode === 'inv' ? all.slice(1) : all;
}

/** Chord type in words: 'minor 7th'. */
export const typeWords = (type) => CHORD_TYPES[type].label.toLowerCase();

/** Full description of a chord question. */
export function describeChord({ rootPc, rootName, type, inversion = 0, fifths = 0 }) {
  const notes = buildChord(rootPitch(rootName, 60), type, inversion);
  const inner = CHORD_TYPES[type].tones;
  const bass = notes[0];
  return {
    rootPc, rootName, type, inversion, fifths,
    symbol: chordSymbol(rootName, type, inversion),
    words: `${prettyNote(rootName)} ${typeWords(type)}${inversion ? `, ${INVERSION_NAMES[inversion]}` : ''}`,
    pcs: chordPcs(rootPc, type),
    bassPc: ((midiOf(bass) % 12) + 12) % 12,
    bassName: prettyNote(bass),
    notes: notes.map(({ step, alter, octave }) => ({ step, alter, octave })),
    midis: notes.map(midiOf),
    size: inner.length,
    required: inner.filter(([, , role]) => !CHORD_TYPES[type].optional?.includes(role)).length,
  };
}

/**
 * Generate a question. `weight(item)` (adaptive stats) weights 'type:<id>' and 'inv:<n>' items;
 * `avoid` ({ rootPc, type }) avoids repeating the previous chord.
 */
export function makeChordQuestion(values, rng, { weight = () => 1, avoid = null } = {}) {
  const cands = candidateChords(values);
  const types = [...new Set(cands.map((c) => c.type))];
  const type = weightedPick(rng, types, (t) => weight(`type:${t}`));
  let pool = cands.filter((c) => c.type === type);
  if (avoid && pool.length > 1) pool = pool.filter((c) => !(c.rootPc === avoid.rootPc && c.type === avoid.type));
  const c = rng.pick(pool);
  const inversion = weightedPick(rng, allowedInversions(type, values.inversions), (i) => weight(`inv:${i}`));
  return describeChord({ ...c, inversion, fifths: values.roots === 'key' ? keyFifths(values.key || 'C-major') : 0 });
}

/** Minimum number of held notes before the played chord is evaluated. */
export const evalThreshold = (q, voicing) => (voicing === 'close' ? q.size : q.required);

/**
 * Check a played chord.
 * @param opts.requireBass the inversion (bass note) must match
 * @param opts.voicing 'close' (each tone once, within an octave; extended chords within two) or 'any'
 * @returns { ok, reason: '' | 'notes' | 'bass' | 'doubled' | 'spread', missing, extra }
 */
export function checkPlayedChord(q, midis, { requireBass = true, voicing = 'any' } = {}) {
  const res = matchChord(midis, q.rootPc, q.type, { inversion: requireBass ? q.inversion : null, allowOmit: voicing === 'any' });
  if (res.missing.length || res.extra.length) return { ...res, ok: false, reason: 'notes' };
  if (!res.bassOk) return { ...res, ok: false, reason: 'bass' };
  if (voicing === 'close') {
    const pcs = new Set(midis.map((m) => ((m % 12) + 12) % 12));
    if (pcs.size !== midis.length) return { ...res, ok: false, reason: 'doubled' };
    const span = Math.max(...midis) - Math.min(...midis);
    const maxSpan = CHORD_TYPES[q.type].tones.every(([s]) => s < 12) ? 11 : 23;
    if (span > maxSpan) return { ...res, ok: false, reason: 'spread' };
  }
  return { ...res, ok: true, reason: '' };
}

/** Human description of what was played: a chord symbol when recognised, else the note names. */
export function describePlayed(midis, preferFlats = true) {
  const names = midis.map((m) => prettyNote(pitchName(spellMidi(m, !preferFlats), false)));
  const ids = identifyChord(midis);
  return { symbol: ids[0]?.symbol || null, alternatives: ids.slice(1, 3).map((x) => x.symbol), names };
}

/**
 * Check a "name the chord" answer { rootPc, type, inversion }.
 * Returns 'exact', 'equivalent' (same notes and bass, e.g. C6 = Am7/C) or false, plus per-part flags.
 */
export function checkNamedChord(q, ans, { inversions = true } = {}) {
  const parts = {
    root: ans.rootPc === q.rootPc,
    type: ans.type === q.type,
    inversion: !inversions || ans.inversion === q.inversion,
  };
  if (parts.root && parts.type && parts.inversion) return { result: 'exact', parts };
  if (ans.rootPc === undefined || !ans.type || !CHORD_TYPES[ans.type]) return { result: false, parts };
  const inv = inversions ? ans.inversion ?? 0 : 0;
  if (inv >= inversionCount(ans.type)) return { result: false, parts };
  const pcs = chordPcs(ans.rootPc, ans.type);
  const samePcs = pcs.length === q.pcs.length && pcs.every((p, i) => p === q.pcs[i]);
  const role = bassRole(ans.type, inv);
  const semi = CHORD_TYPES[ans.type].tones.find(([, , r]) => r === role)[0];
  const sameBass = !inversions || (ans.rootPc + semi) % 12 === q.bassPc;
  return { result: samePcs && sameBass ? 'equivalent' : false, parts };
}

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Labels for the 12 root buttons, spelled to match the question (its root keeps its own spelling). */
export function rootLabels(q) {
  const sharps = q ? /#/.test(q.rootName) || (q.fifths > 0) : false;
  const names = (sharps ? SHARP_NAMES : FLAT_NAMES).slice();
  if (q) names[q.rootPc] = q.rootName;
  return names.map(prettyNote);
}

/** Resolve the clef option ('auto' picks per question, favouring treble). */
export function pickClef(option, rng) {
  if (option !== 'auto') return option;
  return rng.weighted([['treble', 3], ['bass', 2], ['grand', 2]]);
}

/**
 * Score model (js/core/musicxml.js) showing the chord as a whole-note chord. Treble puts the bass note in
 * C4..B4, bass clef in G2..F♯3; the grand staff places the chord around middle C and splits it there.
 */
export function chordScore(q, clef = 'treble') {
  const target = { treble: 60, bass: 43, grand: 52 }[clef] ?? 60;
  const low = Math.min(...q.midis);
  const shift = -Math.floor((low - target) / 12);
  const pitches = q.notes.map((p) => ({ ...p, octave: p.octave + shift }));
  const ev = (ps) => (ps.length ? { pitches: ps, dur: DUR.whole } : { rest: true, pitches: [], dur: DUR.whole, measureRest: true });
  let staves;
  let voices;
  if (clef === 'grand') {
    staves = ['treble', 'bass'];
    const upper = pitches.filter((p) => midiOf(p) >= 60);
    const lower = pitches.filter((p) => midiOf(p) < 60);
    voices = [{ staff: 1, events: [ev(upper)] }, { staff: 2, events: [ev(lower)] }];
  } else {
    staves = [clef];
    voices = [{ staff: 1, events: [ev(pitches)] }];
  }
  return {
    title: '', key: { fifths: q.fifths || 0, mode: 'major' }, time: { beats: 4, beatType: 4 }, staves,
    measures: [{ voices, final: true }],
  };
}

/** MIDI notes for a hint / playback in a comfortable register (bass note from C4 down to F3). */
export function hintMidis(q) {
  const low = Math.min(...q.midis);
  const shift = 12 * -Math.floor((low - 53) / 12);
  return q.midis.map((m) => m + shift);
}
