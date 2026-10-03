// Guitar sight reading: random melodies (optionally with double stops) inside one region of the neck.

import { keyAlter, keyName, spellWithStep, STEPS, midiOf, diatonicOf, diatonicInKey } from '../../core/theory.js';
import { rhythmMeasure } from '../sightreading.js';
import { tuningOf, guitarScore, displayOption } from './common.js';

/** Fret ranges: open position, the classical positions (index finger on fret N), the whole neck. */
const REGIONS = {
  open: { frets: [0, 4], hand: 1, label: 'open position' },
  p2: { frets: [2, 5], hand: 2, label: '2nd position' },
  p5: { frets: [5, 8], hand: 5, label: '5th position' },
  p7: { frets: [7, 10], hand: 7, label: '7th position' },
  p9: { frets: [9, 12], hand: 9, label: '9th position' },
  p12: { frets: [12, 15], hand: 12, label: '12th position' },
  neck: { frets: [0, 15], hand: null, label: 'whole neck' },
};
const STRING_SETS = { all: [1, 2, 3, 4, 5, 6], low: [4, 5, 6], high: [1, 2, 3] };
const STEP_PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MOTION = { step: [[1, 1]], small: [[1, 6], [2, 3], [3, 1]], leaps: [[1, 4], [2, 3], [3, 2], [4, 1], [5, 1]] };

const KEY_CHOICES = [
  ['0', 'C major / A minor'], ['r2', 'Random, up to 2 ♯/♭'], ['r4', 'Random, up to 4 ♯/♭'],
  ...[1, 2, 3, 4, -1, -2, -3, -4].map((f) => [`${f}`, `${Math.abs(f)}${f > 0 ? '♯' : '♭'} (${keyName(f)})`]),
];

export const guitarSightReadingExercise = {
  id: 'g-sightreading',
  label: 'Sight reading',
  description: 'Random reading drills inside one position of the neck, with optional double stops.',
  instrument: 'guitar',
  options: [
    {
      id: 'region', label: 'Region', type: 'select', default: 'open',
      choices: Object.entries(REGIONS).map(([id, r]) => [id, `${r.label[0].toUpperCase()}${r.label.slice(1)} (frets ${r.frets[0]}–${r.frets[1]})`]),
    },
    { id: 'strings', label: 'Strings', type: 'select', default: 'all', choices: [['all', 'All'], ['low', 'Low 3 (E A D)'], ['high', 'High 3 (G B E)']] },
    { id: 'key', label: 'Key', type: 'select', default: '0', choices: KEY_CHOICES },
    { id: 'motion', label: 'Motion', type: 'select', default: 'small', choices: [['step', 'Stepwise'], ['small', 'Steps and skips'], ['leaps', 'Leaps']] },
    { id: 'accidentals', label: 'Accidentals', type: 'select', default: '0', choices: [['0', 'None'], ['0.1', 'Some'], ['0.25', 'Many']] },
    {
      id: 'rhythm', label: 'Rhythm', type: 'select', default: 'quarters',
      choices: [['quarters', 'Beats only'], ['simple', 'Simple'], ['mixed', 'Mixed (dotted, 16ths)']],
    },
    { id: 'doubleStops', label: 'Double stops', type: 'select', default: '0', choices: [['0', 'None'], ['0.2', 'Some'], ['0.5', 'Many']] },
    { id: 'time', label: 'Time signature', type: 'select', default: '4/4', choices: [['4/4', '4/4'], ['3/4', '3/4'], ['2/4', '2/4'], ['6/8', '6/8']] },
    { id: 'measures', label: 'Measures', type: 'select', default: '8', choices: [['4', '4'], ['8', '8'], ['16', '16'], ['32', '32']] },
    { id: 'fingering', label: 'Show left-hand fingering', type: 'checkbox', default: false },
    displayOption('notation'),
  ],

  generate(o, rng, ctx) {
    const tuning = tuningOf(ctx);
    const open = tuning.strings;
    const region = REGIONS[o.region] || REGIONS.open;
    const strings = STRING_SETS[o.strings] || STRING_SETS.all;
    const [beats, beatType] = o.time.split('/').map(Number);
    const time = { beats, beatType };
    const fifths = o.key.startsWith('r') ? rng.int(-o.key.slice(1), +o.key.slice(1)) : +o.key;
    const accProb = +o.accidentals;
    const dsProb = +o.doubleStops;

    // Every playable spot in the region.
    const spots = [];
    for (const s of strings) {
      for (let f = region.frets[0]; f <= region.frets[1]; f++) spots.push({ string: s, fret: f, midi: open[open.length - s] + f });
    }
    const spotsOf = (midi) => spots.filter((x) => x.midi === midi);
    // In-key pitches available in the region, ascending.
    const stepOfPc = {};
    for (const st of STEPS) stepOfPc[(STEP_PCS[st] + keyAlter(st, fifths) + 12) % 12] = st;
    const scale = [...new Set(spots.map((x) => x.midi))].filter((m) => stepOfPc[m % 12]).sort((a, b) => a - b);

    const state = { i: Math.floor(scale.length / 2) + rng.int(-2, 2), fret: region.hand ?? 5, string: strings[1] ?? strings[0], hand: region.hand ?? 1 };
    state.i = Math.max(0, Math.min(scale.length - 1, state.i));

    const place = (midi, avoidString = null) => {
      const options = spotsOf(midi).filter((x) => x.string !== avoidString);
      if (!options.length) return null;
      return options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    };
    const cost = (x) => Math.abs(x.fret - state.fret) + 0.5 * Math.abs(x.string - state.string) + (x.fret === 0 && region.hand !== 1 ? 2 : 0);
    const fingerOf = (fret) => {
      if (fret === 0) return undefined;
      if (region.hand === null) {
        if (fret < state.hand) state.hand = fret;
        if (fret > state.hand + 3) state.hand = fret - 3;
      }
      return Math.max(1, Math.min(4, fret - state.hand + 1));
    };
    const pitchAt = (midi, spot, alter = null) => {
      const p = alter === null ? spellWithStep(midi, stepOfPc[midi % 12]) : alter;
      return { ...p, string: spot.string, fret: spot.fret, finger: fingerOf(spot.fret) };
    };

    const measures = [];
    for (let m = 0; m < +o.measures; m++) {
      const events = rhythmMeasure(time, o.rhythm, rng).map((dur, k) => {
        if (!(m === 0 && k === 0)) {
          const d = rng.weighted(MOTION[o.motion] || MOTION.small) * (rng.chance(0.5) ? 1 : -1);
          let i = state.i + d;
          if (i < 0 || i >= scale.length) i = state.i - d;
          state.i = Math.max(0, Math.min(scale.length - 1, i));
        }
        const midi = scale[state.i];
        // Chromatic neighbour (raised or lowered letter) now and then.
        if (accProb && rng.chance(accProb)) {
          const alt = chromatic(midi, stepOfPc[midi % 12], fifths, spots, rng);
          if (alt) {
            const spot = place(alt.midi);
            state.fret = spot.fret;
            state.string = spot.string;
            return { pitches: [pitchAt(alt.midi, spot, alt.pitch)], dur };
          }
        }
        const spot = place(midi);
        state.fret = spot.fret;
        state.string = spot.string;
        const pitches = [pitchAt(midi, spot)];
        if (dsProb && rng.chance(dsProb)) {
          const upper = doubleStop(pitches[0], fifths, spot, spots, rng);
          if (upper) pitches.push(pitchAt(upper.midi, upper));
        }
        return { pitches, dur };
      });
      measures.push(events);
    }
    return guitarScore({
      title: `Guitar sight reading — ${keyName(fifths).replace(/^([A-G])b/, '$1♭').replace('#', '♯')}, ${region.label}`,
      key: { fifths, mode: 'major' },
      time,
      display: o.display,
      tuning,
      measures,
      fingering: o.fingering,
    });
  },
};

/** A raised or lowered version of an in-key note that is playable in the region (no E♯, B♯, C♭, F♭). */
function chromatic(midi, step, fifths, spots, rng) {
  const base = spellWithStep(midi, step);
  const opts = [];
  for (const d of [1, -1]) {
    const alter = base.alter + d;
    if (Math.abs(alter) > 1 || ['E1', 'B1', 'C-1', 'F-1'].includes(step + alter)) continue;
    const pitch = { ...base, alter };
    const m = midiOf(pitch);
    if (spots.some((x) => x.midi === m)) opts.push({ midi: m, pitch });
  }
  return opts.length ? rng.pick(opts) : null;
}

/** Upper note of a double stop (3rd, 6th, 4th or 5th above in the key) on a higher string, within a hand span. */
function doubleStop(lowPitch, fifths, low, spots, rng) {
  const order = rng.weighted([[[2, 5, 3, 4], 3], [[5, 2, 4, 3], 2], [[3, 4, 2, 5], 1]]);
  for (const k of order) {
    const midi = midiOf(diatonicInKey(diatonicOf(lowPitch) + k, fifths));
    const opts = spots.filter((x) => x.midi === midi && x.string < low.string && Math.abs(x.fret - low.fret) <= 3
      && !(x.fret > 0 && low.fret > 0 && x.fret === low.fret && low.string - x.string > 1));
    if (opts.length) return opts.reduce((a, b) => (Math.abs(b.fret - low.fret) < Math.abs(a.fret - low.fret) ? b : a));
  }
  return null;
}
