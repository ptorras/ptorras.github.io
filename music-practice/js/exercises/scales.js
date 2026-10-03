// Scale exercises: any key, scale type, hands separate/together, parallel/contrary, 1-4 octaves.

import {
  SCALE_TYPES, MODES_BY_DEGREE, MODES_BY_BRIGHTNESS, buildScale, diatonicOf, midiOf, pitchName, majorFifthsOf,
  scaleTonic, scaleName, scaleGroups,
} from '../core/theory.js';
import { scaleFingering, chromaticFinger, computedScaleFingering } from '../core/fingering.js';
import { dpFingering } from '../core/pianofingering.js';
import { DUR, Q, layoutEvents, measureLength } from '../core/musicxml.js';
import {
  assembleScore, TONIC_CHOICES, CIRCLE_PCS, pcOfChoice, tonicFor, placeTonic, handsList, clefForHand,
} from './common.js';

const HAND_NAMES = { R: 'right hand', L: 'left hand', both: 'hands together' };

export const scalesExercise = {
  id: 'scales',
  label: 'Scales',
  description: 'Scales and modes in every key with fingering. Hands separately or together, parallel or contrary motion.',
  options: [
    {
      id: 'tonic', label: 'Key', type: 'select', default: 'C',
      choices: [['random', 'Random'], ['circle', 'All 12 (circle of fifths)'], ...TONIC_CHOICES],
    },
    {
      id: 'scaleType', label: 'Scale', type: 'select', default: 'major',
      choices: [
        ...scaleGroups().map(([group, ids]) => ({ group, choices: ids.map((id) => [id, SCALE_TYPES[id].label]) })),
        {
          group: 'Mixed',
          choices: [
            ['random', 'Random major / minor'],
            ['randomMode', 'Random mode'],
            ['randomJazz', 'Random jazz scale'],
            ['parallelModes', 'All 7 modes on the key note'],
            ['relativeModes', 'All 7 modes of the major key'],
          ],
        },
      ],
    },
    { id: 'hands', label: 'Hands', type: 'select', default: 'R', choices: [['R', 'Right'], ['L', 'Left'], ['both', 'Both']] },
    {
      id: 'motion', label: 'Motion', type: 'select', default: 'parallel',
      choices: [['parallel', 'Parallel'], ['contrary', 'Contrary']], showIf: (o) => o.hands === 'both',
    },
    { id: 'octaves', label: 'Octaves', type: 'select', default: '1', choices: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] },
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
    const contrary = hands.length === 2 && o.motion === 'contrary';
    const octaves = contrary ? Math.min(3, +o.octaves) : +o.octaves;
    const time = { beats: 4, beatType: 4 };
    const mLen = measureLength(time);
    const pcs = o.tonic === 'circle' ? CIRCLE_PCS : [o.tonic === 'random' ? rng.int(0, 11) : pcOfChoice(o.tonic)];

    const scales = pcs.flatMap((pc) => scaleList(o.scaleType, pc, rng));
    const staffMeasures = hands.map(() => []);
    const meta = [];
    let firstKey = null;
    let prevKey = null;
    let title = '';
    for (const [k, { name, type, sigKey }] of scales.entries()) {
      const def = SCALE_TYPES[type];
      title = `${prettyName(name)} ${scaleName(type)} scale`;
      // In a sequence of scales, each starts a new line labelled with its name.
      const label = scales.length > 1 ? `${prettyName(name)} ${scaleName(type)}` : undefined;
      if (k === 0) {
        firstKey = sigKey;
        meta[0] = { label };
      } else {
        const changed = sigKey.fifths !== prevKey.fifths;
        meta[staffMeasures[0].length] = { key: changed ? sigKey : undefined, newSystem: true, label };
      }
      prevKey = sigKey;

      const lines = hands.map((h) => scaleLine({
        name, type, hand: h, octaves, direction: o.direction, contrary, fingering: o.fingering,
      }));
      lines.forEach((line, s) => {
        const events = line.map((p) => ({ pitches: [p], dur: DUR[o.noteValue] }));
        events[events.length - 1].dur = finalDuration(events.length, DUR[o.noteValue], mLen);
        staffMeasures[s].push(...layoutEvents(events, mLen));
      });
    }
    if (o.scaleType === 'parallelModes') title = pcs.length > 1 ? 'All modes around the circle of fifths' : `The seven modes on ${prettyName(scales[0].name)}`;
    else if (o.scaleType === 'relativeModes') title = pcs.length > 1 ? 'Modes of every major key' : `Modes of ${prettyName(scales[0].name)} major`;
    else if (pcs.length > 1) title = 'Scales around the circle of fifths';
    const motion = contrary ? ', contrary motion' : '';
    title += ` — ${octaves} octave${octaves > 1 ? 's' : ''}, ${HAND_NAMES[o.hands]}${motion}`;

    return assembleScore({
      title,
      key: firstKey,
      time,
      clefs: hands.map(clefForHand),
      staffMeasures,
      measureMeta: meta,
      autoClef: octaves >= 2,
    });
  },
};

const prettyName = (name) => name.replace('#', '♯').replace(/b$/, '♭');
const RANDOM_TYPES = ['major', 'naturalMinor', 'harmonicMinor', 'melodicMinor'];
const JAZZ_TYPES = Object.keys(SCALE_TYPES).filter((t) => SCALE_TYPES[t].group === 'Jazz');

/** Tonic spelling and key signature for a scale type on a pitch class. */
function resolveScale(type, pc) {
  const { name, fifths, mode } = scaleTonic(pc, type);
  return { name, type, sigKey: { fifths, mode } };
}

/** The scales (tonic name, type, key signature) to play for one key choice. */
function scaleList(choice, pc, rng) {
  if (choice === 'random') return [resolveScale(rng.pick(RANDOM_TYPES), pc)];
  if (choice === 'randomMode') return [resolveScale(rng.pick(MODES_BY_DEGREE), pc)];
  if (choice === 'randomJazz') return [resolveScale(rng.pick(JAZZ_TYPES), pc)];
  if (choice === 'parallelModes') return MODES_BY_BRIGHTNESS.map((t) => resolveScale(t, pc));
  if (choice === 'relativeModes') {
    // Each mode starts on its degree of the major scale and shares its key signature.
    const parent = tonicFor(pc, 'major').name;
    const sigKey = { fifths: majorFifthsOf(parent), mode: 'major' };
    const degrees = buildScale(placeTonic(parent, 60), 'major', 1, 'up');
    return MODES_BY_DEGREE.map((type, i) => ({
      name: pitchName(degrees[i], false), type, sigKey: { ...sigKey, mode: SCALE_TYPES[type].mode },
    }));
  }
  return [resolveScale(choice, pc)];
}

/** Length of the last note so the line ends on a full bar (at least a quarter). */
function finalDuration(n, v, mLen) {
  const pos = ((n - 1) * v) % mLen;
  let last = mLen - pos;
  if (last < Q) last += mLen;
  return last;
}

function scaleLine({ name, type, hand, octaves, direction, contrary, fingering }) {
  // Where the bottom tonic sits.
  let lo;
  if (contrary) lo = 55; // both hands start on the same tonic near middle C
  else if (hand === 'R') lo = octaves <= 2 ? 60 : 48;
  else lo = octaves <= 2 ? 43 : 31; // tonic between G2 and F#3 (G1-F#2 for 3+ octaves), below the right hand
  let tonic = placeTonic(name, lo);
  let seq;
  if (contrary && hand === 'L') {
    tonic = { ...tonic, octave: tonic.octave - octaves };
    const down = buildScale(tonic, type, octaves, 'down');
    const up = buildScale(tonic, type, octaves, 'up');
    seq = direction === 'updown' ? down.concat(up.slice(1)) : direction === 'up' ? down : up;
  } else {
    seq = buildScale(tonic, type, octaves, direction);
  }
  seq = seq.map((p) => ({ ...p }));
  if (fingering) {
    if (SCALE_TYPES[type].chromatic) {
      seq.forEach((p) => { p.finger = chromaticFinger(p, hand); });
    } else {
      const fingers = ascendingFingering(name, type, tonic, hand, octaves);
      // Fingers follow the ascending line by pitch, so a note keeps its finger on the way down. Scales with two
      // notes on one letter (blues, bebop, diminished...) can't be indexed by letter; the melodic minor's descending
      // 6th and 7th aren't in the ascending line and fall back to the letter (same finger as the raised degree).
      const asc = buildScale(tonic, type, octaves, 'up');
      const byMidi = new Map(asc.map((p, i) => [midiOf(p), i]));
      const base = diatonicOf(tonic);
      seq.forEach((p) => { p.finger = fingers[byMidi.get(midiOf(p)) ?? diatonicOf(p) - base]; });
    }
  }
  return seq;
}

/**
 * Fingers for the ascending scale from the bottom tonic over `octaves`. Major and minor keys use the standard
 * tables. Other 7-note scales (modes, jazz) use computedScaleFingering: it applies the rules behind the tables
 * (thumbs on white keys, groups of 3 and 4 that repeat every octave), which gives the familiar shapes. Where those
 * rules find no solution (e.g. lydian augmented or altered on some tonics) and for 5-, 6- and 8-note scales,
 * dpFingering searches the cheapest consistent fingering.
 */
function ascendingFingering(name, type, tonic, hand, octaves) {
  const def = SCALE_TYPES[type];
  const table = !def.modal && !def.jazz && def.mode && scaleFingering(name, def.mode, hand, octaves);
  if (table) return table;
  const octave = buildScale(tonic, type, 1, 'up').map(midiOf);
  const computed = octave.length === 8 ? computedScaleFingering(octave, hand, octaves) : null;
  return computed || dpFingering(buildScale(tonic, type, octaves, 'up').map(midiOf), hand);
}
