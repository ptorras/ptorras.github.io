// Random sight-reading exercises: notes, intervals, chords; one or both hands;
// configurable range, keys (with optional key changes), accidentals, clef changes and rhythm.

import { diatonicInKey, keyAlter, keyName, midiOf } from '../core/theory.js';
import { Q } from '../core/musicxml.js';
import { assembleScore, handsList, clefForHand } from './common.js';

/** Diatonic index of each clef's middle staff line. */
const CLEF_CENTER = { treble: 34, bass: 22, alto: 28, tenor: 26 };
/** Half-range in diatonic steps around the middle line (outer lines are at +/-4). */
const RANGES = { staff: 5, ledger1: 7, ledger2: 9, ledger3: 11 };
const LEAPS = { step: 1, small: 3, leaps: 7 };

const KEY_CHOICES = [
  ['0', 'C major / A minor'], ['r2', 'Random, up to 2 ♯/♭'], ['r4', 'Random, up to 4 ♯/♭'], ['r7', 'Random, any key'],
  ...[1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7].map((f) => [`${f}`, `${Math.abs(f)}${f > 0 ? '♯' : '♭'} (${keyName(f)})`]),
];

export const sightReadingExercise = {
  id: 'sightreading',
  label: 'Sight reading',
  description: 'Randomly generated reading drills. Combine notes, intervals and chords with key and clef changes.',
  options: [
    { id: 'hands', label: 'Hands', type: 'select', default: 'R', choices: [['R', 'Right (treble)'], ['L', 'Left (bass)'], ['both', 'Both (grand staff)']] },
    {
      id: 'content', label: 'Content', type: 'select', default: 'notes',
      choices: [['notes', 'Single notes'], ['intervals', 'Intervals'], ['chords', 'Chords'], ['mixed', 'Mixed']],
    },
    {
      id: 'range', label: 'Range', type: 'select', default: 'staff',
      choices: [['staff', 'Within the staff'], ['ledger1', 'Up to 1 ledger line'], ['ledger2', 'Up to 2 ledger lines'], ['ledger3', 'Up to 3 ledger lines']],
    },
    { id: 'motion', label: 'Motion', type: 'select', default: 'small', choices: [['step', 'Stepwise'], ['small', 'Steps and skips'], ['leaps', 'Any leaps']] },
    { id: 'key', label: 'Key', type: 'select', default: '0', choices: KEY_CHOICES },
    { id: 'keyChanges', label: 'Key changes', type: 'select', default: '0', choices: [['0', 'None'], ['4', 'Every 4 bars'], ['8', 'Every 8 bars']] },
    { id: 'accidentals', label: 'Accidentals', type: 'select', default: '0', choices: [['0', 'None'], ['0.1', 'Some'], ['0.25', 'Many']] },
    { id: 'clefChanges', label: 'Clef changes', type: 'select', default: '0', choices: [['0', 'None'], ['0.15', 'Occasional'], ['0.35', 'Frequent']] },
    { id: 'cClefs', label: 'Include alto/tenor clefs', type: 'checkbox', default: false, showIf: (o) => o.clefChanges !== '0' },
    {
      id: 'rhythm', label: 'Rhythm', type: 'select', default: 'quarters',
      choices: [['quarters', 'Beats only'], ['simple', 'Simple'], ['mixed', 'Mixed (dotted, 16ths)']],
    },
    { id: 'rests', label: 'Rests', type: 'select', default: '0', choices: [['0', 'None'], ['0.1', 'Some'], ['0.2', 'Many']] },
    {
      id: 'handsRhythm', label: 'Hands rhythm', type: 'select', default: 'together',
      choices: [['together', 'Same rhythm'], ['independent', 'Independent']], showIf: (o) => o.hands === 'both',
    },
    { id: 'time', label: 'Time signature', type: 'select', default: '4/4', choices: [['4/4', '4/4'], ['3/4', '3/4'], ['2/4', '2/4'], ['6/8', '6/8']] },
    { id: 'measures', label: 'Measures', type: 'select', default: '8', choices: [['4', '4'], ['8', '8'], ['16', '16'], ['32', '32']] },
  ],

  generate(o, rng) {
    const hands = handsList(o.hands);
    const [beats, beatType] = o.time.split('/').map(Number);
    const time = { beats, beatType };
    const nMeasures = +o.measures;
    const maxLeap = LEAPS[o.motion];
    const halfRange = RANGES[o.range];
    const accProb = +o.accidentals;
    const restProb = +o.rests;
    const clefProb = +o.clefChanges;

    const keyPool = o.key.startsWith('r')
      ? range(-o.key.slice(1), +o.key.slice(1))
      : [+o.key];
    let fifths = rng.pick(keyPool);
    const firstKey = { fifths, mode: 'major' };

    const homeClefs = hands.map(clefForHand);
    const clefs = [...homeClefs];
    const state = hands.map((_, s) => ({ prev: CLEF_CENTER[clefs[s]] }));
    const staffMeasures = hands.map(() => []);
    const meta = [];

    for (let m = 0; m < nMeasures; m++) {
      const mm = {};
      if (m > 0 && +o.keyChanges && m % +o.keyChanges === 0 && keyPool.length > 1) {
        const others = keyPool.filter((f) => f !== fifths);
        fifths = rng.pick(others);
        mm.key = { fifths, mode: 'major' };
      }
      if (m > 0 && clefProb) {
        hands.forEach((_, s) => {
          if (!rng.chance(clefProb)) return;
          const pool = ['treble', 'bass', ...(o.cClefs ? ['alto', 'tenor'] : [])].filter((c) => c !== clefs[s]);
          clefs[s] = rng.pick(pool);
          state[s].prev = CLEF_CENTER[clefs[s]] + rng.int(-2, 2);
          (mm.clefs ||= {})[s + 1] = clefs[s];
        });
      }
      meta[m] = mm;

      const shared = rhythmMeasure(time, o.rhythm, rng);
      hands.forEach((_, s) => {
        const durs = o.handsRhythm === 'independent' && s > 0 ? rhythmMeasure(time, o.rhythm, rng) : shared;
        const center = CLEF_CENTER[clefs[s]];
        const lo = center - halfRange;
        const hi = center + halfRange;
        const events = durs.map((dur, i) => {
          if (restProb && !(m === 0 && i === 0) && rng.chance(restProb)) return { rest: true, pitches: [], dur };
          const ds = chooseDiatonics(o.content, state[s], lo, hi, maxLeap, rng);
          const pitches = ds.map((d) => diatonicInKey(d, fifths));
          if (accProb && pitches.length <= 2 && rng.chance(accProb)) alterRandomly(pitches, fifths, rng);
          return { pitches, dur };
        });
        staffMeasures[s].push(events);
      });
    }

    const handText = { R: 'right hand', L: 'left hand', both: 'both hands' }[o.hands];
    return assembleScore({
      title: `Sight reading — ${keyName(firstKey.fifths)}, ${handText}`,
      key: firstKey,
      time,
      clefs: homeClefs,
      staffMeasures,
      measureMeta: meta,
    });
  },
};

function range(lo, hi) {
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/** Next melodic position from prev, staying within [lo, hi]. */
function step(prev, lo, hi, maxLeap, rng) {
  let delta = rng.int(-maxLeap, maxLeap);
  if (delta === 0 && rng.chance(0.7)) delta = rng.pick([-1, 1]);
  let d = prev + delta;
  if (d < lo || d > hi) d = prev - delta;
  return Math.max(lo, Math.min(hi, d));
}

function chooseDiatonics(content, st, lo, hi, maxLeap, rng) {
  const kind = content === 'mixed' ? rng.weighted([['notes', 5], ['intervals', 3], ['chords', 2]]) : content;
  if (kind === 'notes') {
    st.prev = step(st.prev, lo, hi, maxLeap, rng);
    return [st.prev];
  }
  if (kind === 'intervals') {
    const size = rng.int(1, 7);
    const base = Math.max(lo, Math.min(hi - size, step(st.prev, lo, hi, Math.max(maxLeap, 2), rng)));
    st.prev = base;
    return [base, base + size];
  }
  // chords: triads in any inversion, or 4-note chords (root position + octave, or seventh chord)
  const shapes = [[0, 2, 4], [0, 2, 5], [0, 3, 5], [0, 2, 4, 7], [0, 2, 4, 6]];
  const shape = rng.weighted([[shapes[0], 3], [shapes[1], 2], [shapes[2], 2], [shapes[3], 1], [shapes[4], 1]]);
  const span = shape[shape.length - 1];
  const base = Math.max(lo, Math.min(hi - span, step(st.prev, lo, hi, Math.max(maxLeap, 2), rng)));
  st.prev = base;
  return shape.map((x) => base + x);
}

/** Raise or lower one pitch by a semitone relative to the key, avoiding E#/B#/Cb/Fb and enharmonic duplicates. */
function alterRandomly(pitches, fifths, rng) {
  const p = rng.pick(pitches);
  const others = pitches.filter((q) => q !== p).map(midiOf);
  const inKey = keyAlter(p.step, fifths);
  const options = (inKey === 0 ? [1, -1] : [0]).filter((a) => {
    if (['E1', 'B1', 'C-1', 'F-1'].includes(p.step + a)) return false;
    return !others.includes(midiOf({ ...p, alter: a }));
  });
  if (options.length) p.alter = rng.pick(options);
}

/** Durations for one measure. */
export function rhythmMeasure(time, level, rng) {
  const out = [];
  if (time.beatType === 8) {
    const groups = time.beats / 3;
    const dq = 1.5 * Q;
    for (let g = 0; g < groups; g++) {
      if (level === 'quarters') { out.push(dq); continue; }
      const opts = [[[dq], 3], [[Q, Q / 2], 3], [[Q / 2, Q / 2, Q / 2], 2]];
      if (g === 0 && groups === 2) opts.push([[2 * dq], 1]);
      if (level === 'mixed') opts.push([[0.75 * Q, Q / 4, Q / 2], 1]);
      const pick = rng.weighted(opts);
      out.push(...pick);
      if (pick[0] === 2 * dq) g++;
    }
    return out;
  }
  const beats = time.beats * (4 / time.beatType);
  let b = 0;
  while (b < beats) {
    if (level === 'quarters') { out.push(Q); b += 1; continue; }
    const opts = [[[Q], 4], [[Q / 2, Q / 2], 2]];
    if (b === 0 && beats === 4) opts.push([[4 * Q], 0.5]);
    if (b === 0 && beats === 3) opts.push([[3 * Q], 0.5]);
    if (b % 2 === 0 && b + 2 <= beats) opts.push([[2 * Q], 2]);
    if (level === 'mixed') {
      if (b + 2 <= beats && b % 2 === 0) opts.push([[1.5 * Q, Q / 2], 1.5]);
      opts.push([[Q / 4, Q / 4, Q / 4, Q / 4], 0.7], [[Q / 2, Q / 4, Q / 4], 0.7], [[0.75 * Q, Q / 4], 0.7]);
    }
    const pick = rng.weighted(opts);
    out.push(...pick);
    b += pick.reduce((a, d) => a + d, 0) / Q;
  }
  return out;
}

