// Arpeggio exercises: every chord type, root and inversion, hands separately or together, 1-4 octaves.
//
// A chord voicing that fits inside an octave (triads, sevenths, sixths, and inverted voicings of most extended
// chords) repeats by octave: C E G | C E G | C ... and back down. Voicings wider than an octave (9ths, 11ths, 13ths
// in root position) can't repeat that way (the 9th lies above the next root), so they play one span, R-3-5-7-9 up
// and back down, whatever the octave setting.

import { midiOf, findKey, buildScale, pitchName } from '../core/theory.js';
import {
  CHORD_TYPES, CHORD_GROUPS, chordTypesIn, buildChord, chordRootName, chordSymbol, inversionCount, rootPitch,
  prettyNote, INVERSION_NAMES,
} from '../core/chords.js';
import { dpFingering } from '../core/pianofingering.js';
import { DUR, Q, layoutEvents, measureLength } from '../core/musicxml.js';
import {
  assembleScore, TONIC_CHOICES, CIRCLE_PCS, pcOfChoice, tonicFor, placeTonic, handsList, clefForHand,
} from './common.js';

const HAND_NAMES = { R: 'right hand', L: 'left hand', both: 'hands together' };
const BASIC_TRIADS = ['maj', 'min', 'dim', 'aug'];
const SEVENTHS = chordTypesIn('Sevenths');
// Diatonic seventh chords of a major key, degree by degree.
const DIATONIC_SEVENTHS = ['maj7', 'min7', 'min7', 'maj7', 'dom7', 'min7', 'halfDim7'];
const ROMAN = ['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø7'];

const MIXED = {
  randomTriad: { label: 'Random triad', title: 'Triad arpeggios' },
  randomSeventh: { label: 'Random seventh', title: 'Seventh-chord arpeggios' },
  allTriads: { label: 'All four triads on the root', title: 'Major, minor, diminished and augmented arpeggios' },
  allSevenths: { label: 'All seventh chords on the root', title: 'Seventh-chord arpeggios' },
  diatonicSevenths: { label: 'Diatonic sevenths of the major key', title: 'Diatonic seventh chords' },
};

export const arpeggioExercise = {
  id: 'arpeggios',
  label: 'Arpeggios',
  instrument: 'piano',
  description: 'Arpeggios of every chord type in every key and inversion, with fingering. Hands separately or together, 1-4 octaves.',
  options: [
    {
      id: 'chordType', label: 'Chord', type: 'select', default: 'maj',
      choices: [
        ...CHORD_GROUPS.map((group) => ({ group, choices: chordTypesIn(group).map((id) => [id, CHORD_TYPES[id].label]) })),
        { group: 'Mixed', choices: Object.entries(MIXED).map(([id, m]) => [id, m.label]) },
      ],
    },
    {
      id: 'root', label: 'Root', type: 'select', default: 'C',
      choices: [['random', 'Random'], ['circle', 'All 12 (circle of fifths)'], ['chromatic', 'Rising by semitones'], ...TONIC_CHOICES],
    },
    {
      id: 'inversion', label: 'Inversion', type: 'select', default: '0',
      choices: [
        ['0', 'Root position'], ['1', '1st inversion'], ['2', '2nd inversion'], ['3', '3rd inversion (4-note chords)'],
        ['all', 'All inversions in sequence'], ['random', 'Random'],
      ],
    },
    { id: 'hands', label: 'Hands', type: 'select', default: 'R', choices: [['R', 'Right'], ['L', 'Left'], ['both', 'Both']] },
    { id: 'octaves', label: 'Octaves', type: 'select', default: '2', choices: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] },
    {
      id: 'direction', label: 'Direction', type: 'select', default: 'updown',
      choices: [['updown', 'Up and down'], ['up', 'Up only'], ['down', 'Down only']],
    },
    {
      id: 'noteValue', label: 'Note value', type: 'select', default: 'eighth',
      choices: [['quarter', 'Quarters'], ['eighth', 'Eighths'], ['sixteenth', 'Sixteenths']],
    },
    { id: 'fingering', label: 'Show fingering', type: 'checkbox', default: true },
  ],

  generate(o, rng) {
    const hands = handsList(o.hands);
    const octaves = +o.octaves;
    const value = DUR[o.noteValue];
    const items = chordList(o, rng);
    const staffMeasures = hands.map(() => []);
    const meta = [];
    const times = []; // [measure index, time] where the meter changes
    let prevKey = null;
    let prevTime = null;
    let wide = 0;
    for (const [k, item] of items.entries()) {
      const at = staffMeasures[0].length;
      const label = items.length > 1 ? item.label : undefined;
      const changed = k > 0 && item.sigKey.fifths !== prevKey.fifths;
      meta[at] = k === 0 ? { label } : { key: changed ? item.sigKey : undefined, newSystem: true, label };
      prevKey = item.sigKey;

      const lines = hands.map((h) => arpeggioLine(item, h, octaves, o.direction));
      if (lines[0].wide) wide++;
      const time = meterFor(lines[0].group, value);
      if (!prevTime || time.beats !== prevTime.beats || time.beatType !== prevTime.beatType) times.push([at, time]);
      prevTime = time;
      const mLen = measureLength(time);
      lines.forEach(({ notes }, s) => {
        const fingers = o.fingering ? dpFingering(notes.map(midiOf), hands[s]) : [];
        const events = notes.map((p, i) => ({ pitches: [{ ...p, finger: fingers[i] }], dur: value }));
        events[events.length - 1].dur = finalDuration(events.length, value, time);
        staffMeasures[s].push(...layoutEvents(events, mLen));
      });
    }

    const score = assembleScore({
      title: titleFor(o, items, octaves, wide),
      key: items[0].sigKey,
      time: times[0][1],
      clefs: hands.map(clefForHand),
      staffMeasures,
      measureMeta: meta,
      autoClef: true,
    });
    for (const [at, time] of times.slice(1)) score.measures[at].time = time;
    return score;
  },
};

// ---------------------------------------------------------------- what to play

/** Chord types for a chord-type option on one root. */
function typesFor(choice, rng) {
  if (choice === 'randomTriad') return [rng.pick(BASIC_TRIADS)];
  if (choice === 'randomSeventh') return [rng.pick(SEVENTHS)];
  if (choice === 'allTriads') return BASIC_TRIADS;
  if (choice === 'allSevenths') return SEVENTHS;
  return [choice];
}

const minorish = (type) => {
  const semis = CHORD_TYPES[type].tones.map(([s]) => s);
  return semis.includes(3) && !semis.includes(4);
};

/** Key signature for a chord on its own: the major or minor key of its root, or C when that key doesn't exist. */
function keyFor(root, type) {
  const mode = minorish(type) ? 'minor' : 'major';
  const key = findKey(root, mode);
  return key && Math.abs(key.fifths) <= 6 ? { fifths: key.fifths, mode } : { fifths: 0, mode: 'major' };
}

/**
 * The arpeggios to play, in order: [{ root, type, inversion, sigKey, label }].
 * Diatonic sets use their major key; single chords use the key of their root (major or minor by quality);
 * rising by semitones stays in C with accidentals so the signature doesn't change every line.
 */
function chordList(o, rng) {
  let pcs;
  if (o.root === 'circle') pcs = CIRCLE_PCS;
  else if (o.root === 'chromatic') pcs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  else pcs = [o.root === 'random' ? rng.int(0, 11) : pcOfChoice(o.root)];
  const fixedKey = o.root === 'chromatic' ? { fifths: 0, mode: 'major' } : null;

  const chords = [];
  for (const pc of pcs) {
    if (o.chordType === 'diatonicSevenths') {
      const { name, key } = tonicFor(pc, 'major');
      const sigKey = fixedKey || { fifths: key.fifths, mode: 'major' };
      const degrees = buildScale(placeTonic(name, 60), 'major', 1, 'up');
      DIATONIC_SEVENTHS.forEach((type, i) => chords.push({ root: pitchName(degrees[i], false), type, sigKey, roman: ROMAN[i] }));
    } else {
      for (const type of typesFor(o.chordType, rng)) {
        const root = chordRootName(pc, type);
        chords.push({ root, type, sigKey: fixedKey || keyFor(root, type) });
      }
    }
  }

  const out = [];
  for (const c of chords) {
    const count = inversionCount(c.type);
    let invs;
    if (o.inversion === 'all') invs = Array.from({ length: count }, (_, i) => i);
    else if (o.inversion === 'random') invs = [rng.int(0, count - 1)];
    else invs = [+o.inversion < count ? +o.inversion : 0]; // a triad has no 3rd inversion: root position
    for (const inversion of invs) {
      const symbol = chordSymbol(c.root, c.type, inversion);
      out.push({ ...c, inversion, label: c.roman ? `${symbol} (${c.roman})` : symbol });
    }
  }
  return out;
}

// ---------------------------------------------------------------- notes and meter

const shiftOctave = (p, n) => ({ step: p.step, alter: p.alter, octave: p.octave + n });

/**
 * One hand's arpeggio. The bottom note sits in [lo, lo+11]: right hand from C4 (C3 for 3-4 octaves), left hand an
 * octave lower, as in the scales exercise. Returns { notes, group (notes per octave), wide (one-span pattern) }.
 */
function arpeggioLine({ root, type, inversion }, hand, octaves, direction) {
  // Left-hand roots sit between G2 and F#3 (an octave lower for 3+ octaves), so the line stays in the bass clef.
  const lo = hand === 'R' ? (octaves <= 2 ? 60 : 48) : (octaves <= 2 ? 43 : 31);
  let chord = buildChord(rootPitch(root, lo), type, inversion).map((p) => shiftOctave(p, 0));
  const drop = Math.floor((midiOf(chord[0]) - lo) / 12); // inverted voicings start above the root
  if (drop) chord = chord.map((p) => shiftOctave(p, -drop));
  const wide = midiOf(chord[chord.length - 1]) - midiOf(chord[0]) >= 12;
  let up;
  if (wide) {
    up = chord;
  } else {
    up = [];
    for (let k = 0; k < octaves; k++) up.push(...chord.map((p) => shiftOctave(p, k)));
    up.push(shiftOctave(chord[0], octaves));
  }
  const down = up.slice().reverse();
  const notes = direction === 'up' ? up : direction === 'down' ? down : up.concat(down.slice(1));
  return { notes, group: wide ? 0 : chord.length, wide };
}

/**
 * Meter in which the groups (one chord voicing per octave) align with beats or bars: 3-note groups in compound
 * time (3/4 in quarters, 12/8 in eighths, 6/8 in sixteenths), 4-note groups in 4/4, 5-note groups in 5/4 or 5/8,
 * 6-note groups in 6/4, 6/8 or 3/4. One-span patterns (group 0) use 4/4.
 */
function meterFor(group, value) {
  const v = value === DUR.quarter ? 'q' : value === DUR.eighth ? 'e' : 's';
  const table = {
    3: { q: [3, 4], e: [12, 8], s: [6, 8] },
    5: { q: [5, 4], e: [5, 8], s: [5, 8] },
    6: { q: [6, 4], e: [6, 8], s: [3, 4] },
  };
  const [beats, beatType] = table[group]?.[v] || [4, 4];
  return { beats, beatType };
}

/** Length of the last note so the line ends on a full bar (at least a beat). */
function finalDuration(n, v, time) {
  const mLen = measureLength(time);
  const beat = time.beatType === 8 && time.beats % 3 === 0 ? 1.5 * Q : Q;
  const pos = ((n - 1) * v) % mLen;
  let last = mLen - pos;
  if (last < beat) last += mLen;
  return last;
}

// ---------------------------------------------------------------- title

function titleFor(o, items, octaves, wide) {
  const first = items[0];
  let title;
  if (MIXED[o.chordType]) {
    title = MIXED[o.chordType].title;
    const oneRoot = o.root !== 'circle' && o.root !== 'chromatic';
    if (o.chordType === 'diatonicSevenths' && oneRoot) title += ` of ${prettyNote(first.root)} major`;
    else if (o.chordType.startsWith('all') && oneRoot) title += ` on ${prettyNote(first.root)}`;
  } else {
    const kind = CHORD_TYPES[first.type].label.toLowerCase();
    title = items.length === 1 || (o.inversion === 'all' && items.every((c) => c.root === first.root))
      ? `${prettyNote(first.root)} ${kind} arpeggio${items.length > 1 ? 's' : ''}`
      : `${CHORD_TYPES[first.type].label} arpeggios`;
  }
  if (o.root === 'circle') title += ' around the circle of fifths';
  else if (o.root === 'chromatic') title += ' rising by semitones';
  if (o.inversion === 'all') title += ', all inversions';
  else if (items.length === 1 && first.inversion) title += `, ${INVERSION_NAMES[first.inversion]}`;
  const span = wide === items.length ? 'one span' : `${octaves} octave${octaves > 1 ? 's' : ''}`;
  return `${title} — ${span}, ${HAND_NAMES[o.hands]}`;
}
