// Guitar chord changes: common progressions as block chords, with voicings chosen for smooth hand movement.

import { diatonicOf, fromDiatonic, spellWithStep, pitchName, findKey, midiOf, TONIC_BY_PC } from '../../core/theory.js';
import { CHORD_TYPES, chordSymbol, chordRootName } from '../../core/chords.js';
import { DUR } from '../../core/musicxml.js';
import { chordVoicings } from '../../guitar/voicings.js';
import { TONIC_CHOICES, pcOfChoice, placeTonic } from '../common.js';
import { tuningOf, guitarScore, displayOption } from './common.js';

// Progression steps: [semitones above the tonic, scale degree (letter offset), triad type, seventh-chord type].
const I = [0, 0, 'maj', 'maj7'];
const ii = [2, 1, 'min', 'min7'];
const IV = [5, 3, 'maj', 'maj7'];
const V = [7, 4, 'maj', 'dom7'];
const vi = [9, 5, 'min', 'min7'];
const I7 = [0, 0, 'dom7', 'dom7'];
const IV7 = [5, 3, 'dom7', 'dom7'];
const V7 = [7, 4, 'dom7', 'dom7'];

const PROGRESSIONS = {
  'I-IV-V-I': { label: 'I – IV – V – I', steps: [I, IV, V, I] },
  'I-V-vi-IV': { label: 'I – V – vi – IV', steps: [I, V, vi, IV] },
  'ii-V-I': { label: 'ii7 – V7 – Imaj7', steps: [ii, V, I, I], sevenths: true },
  blues: { label: '12-bar blues (dominant 7ths)', steps: [I7, I7, I7, I7, IV7, IV7, I7, I7, V7, IV7, I7, V7] },
  'I-vi-ii-V': { label: 'I – vi – ii – V', steps: [I, vi, ii, V] },
};
const RANDOM_GROUPS = {
  basic: ['maj', 'min'],
  triads: ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'],
  sevenths: ['maj7', 'dom7', 'min7', 'halfDim7', 'dim7'],
  mixed: ['maj', 'min', 'maj7', 'dom7', 'min7', 'maj6', 'min6', 'dom9', 'sus4'],
};
const STRUMS = { whole: 1, half: 2, quarter: 4 };

export const guitarChordsExercise = {
  id: 'g-chords',
  label: 'Chord changes',
  description: 'Common progressions as block chords, with voicings that keep the hand close between changes.',
  instrument: 'guitar',
  options: [
    {
      id: 'progression', label: 'Progression', type: 'select', default: 'I-IV-V-I',
      choices: [...Object.entries(PROGRESSIONS).map(([id, p]) => [id, p.label]), ['random', 'Random chords']],
    },
    {
      id: 'group', label: 'Chords', type: 'select', default: 'basic', showIf: (o) => o.progression === 'random',
      choices: [['basic', 'Major and minor'], ['triads', 'All triads'], ['sevenths', 'Seventh chords'], ['mixed', 'Mixed (6ths, 7ths, 9ths, sus)']],
    },
    { id: 'tonic', label: 'Key', type: 'select', default: 'G', choices: [['random', 'Random'], ...TONIC_CHOICES], showIf: (o) => o.progression !== 'random' },
    {
      id: 'style', label: 'Voicings', type: 'select', default: 'open',
      choices: [['open', 'Open where possible'], ['barre', 'Barre chords'], ['jazz', 'Jazz (shells, drop 2/3, sevenths)']],
    },
    { id: 'rhythm', label: 'Strums', type: 'select', default: 'half', choices: [['whole', 'Whole notes'], ['half', 'Half notes'], ['quarter', 'Quarter notes']] },
    { id: 'repeats', label: 'Length', type: 'select', default: '2', choices: [['1', 'Once'], ['2', 'Twice'], ['4', '4 times']] },
    { id: 'symbols', label: 'Chord symbols', type: 'checkbox', default: true },
    displayOption('both'),
  ],

  generate(o, rng, ctx) {
    const tuning = tuningOf(ctx);
    const chords = [];
    let key = { fifths: 0, mode: 'major' };
    let title;
    if (o.progression === 'random') {
      const types = RANDOM_GROUPS[o.group] || RANDOM_GROUPS.basic;
      const n = 4 * +o.repeats;
      for (let i = 0; i < n; i++) {
        const type = rng.pick(types);
        let pc = rng.int(0, 11);
        if (i > 0 && pc === chords[i - 1].pc && type === chords[i - 1].type) pc = (pc + 5) % 12;
        chords.push({ pc, type, name: chordRootName(pc, type) });
      }
      title = 'Chord changes — random chords';
    } else {
      const prog = PROGRESSIONS[o.progression] || PROGRESSIONS['I-IV-V-I'];
      const tonicPc = o.tonic === 'random' ? rng.int(0, 11) : pcOfChoice(o.tonic);
      const tonicName = TONIC_BY_PC.major[tonicPc];
      key = { fifths: findKey(tonicName, 'major').fifths, mode: 'major' };
      const tonic = placeTonic(tonicName, 48);
      const sevenths = o.style === 'jazz' || prog.sevenths;
      for (let r = 0; r < +o.repeats; r++) {
        for (const [semi, degree, triad, seventh] of prog.steps) {
          const root = spellWithStep(48 + ((tonicPc + semi) % 12), fromDiatonic(diatonicOf(tonic) + degree).step);
          chords.push({ pc: (tonicPc + semi) % 12, type: sevenths ? seventh : triad, name: pitchName(root, false) });
        }
      }
      title = `Chord changes — ${prog.label} in ${tonicName.replace('b', '♭').replace('#', '♯')} major`;
    }

    const voicings = chooseVoicings(chords, o.style, tuning);
    const strums = STRUMS[o.rhythm] || 2;
    const dur = DUR.whole / strums;
    const measures = chords.map((c, i) => {
      const pitches = voicingPitches(voicings[i], c.name, c.type, tuning);
      return Array.from({ length: strums }, (_, k) => ({
        pitches: pitches.map((p) => ({ ...p })),
        dur,
        chord: o.symbols && k === 0 ? { text: chordSymbol(c.name, c.type) } : undefined,
      }));
    });
    return guitarScore({ title, key, time: { beats: 4, beatType: 4 }, display: o.display, tuning, measures, fingering: false });
  },
};

/** Fret centre of a voicing (open strings count as fret 0). */
const centre = (v) => {
  const s = v.frets.filter((f) => f >= 0);
  return s.reduce((a, b) => a + b, 0) / s.length;
};

const candidateCache = new Map();

/** Candidate voicings of one chord for a style, best first, with a style-fit score (cached). */
function candidates(pc, type, style, tuning) {
  const key = `${pc}|${type}|${style}|${tuning.strings.join()}`;
  if (!candidateCache.has(key)) candidateCache.set(key, searchCandidates(pc, type, style, tuning));
  return candidateCache.get(key);
}

function searchCandidates(pc, type, style, tuning) {
  const out = new Map();
  const add = (list, penalty) => {
    for (const v of list) {
      const k = v.frets.join();
      if (!out.has(k)) out.set(k, { ...v, fit: v.score - penalty });
    }
  };
  add(chordVoicings(pc, type, tuning, { style, limit: 8 }), 0);
  // Fall back to other shapes when the style has few (or no) grips for this chord.
  add(chordVoicings(pc, type, tuning, { style: style === 'jazz' ? 'movable' : 'any', limit: 8 }), 3);
  return [...out.values()];
}

/** Viterbi: best-fitting voicings with the smallest jumps along the neck. */
export function chooseVoicings(chords, style, tuning) {
  const cands = chords.map((c) => candidates(c.pc, c.type, style, tuning));
  let prev = cands[0].map((v) => ({ cost: -v.fit, path: [v] }));
  for (let i = 1; i < cands.length; i++) {
    prev = cands[i].map((v) => {
      let best = null;
      for (const p of prev) {
        const cost = p.cost - v.fit + 0.6 * Math.abs(centre(v) - centre(p.path[p.path.length - 1]));
        if (!best || cost < best.cost) best = { cost, p };
      }
      return { cost: best.cost, path: [...best.p.path, v] };
    });
  }
  return prev.reduce((a, b) => (b.cost < a.cost ? b : a)).path;
}

/** Sounding pitches of a voicing, spelled as chord tones, with string and fret. */
export function voicingPitches(v, rootName, type, tuning) {
  const n = tuning.strings.length;
  const root = placeTonic(rootName, 48);
  const letterOf = Object.fromEntries(CHORD_TYPES[type].tones.map(([, letter, role]) => [role, letter]));
  const out = [];
  const seen = new Set();
  v.frets.forEach((fret, s) => {
    if (fret < 0) return;
    const midi = tuning.strings[s] + fret;
    if (seen.has(midi)) return;
    seen.add(midi);
    const step = fromDiatonic(diatonicOf(root) + letterOf[v.roles[s]]).step;
    out.push({ ...spellWithStep(midi, step), string: n - s, fret, finger: v.fingers[s] || undefined });
  });
  return out.sort((a, b) => midiOf(a) - midiOf(b));
}
