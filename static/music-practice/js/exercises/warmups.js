// Warm-up exercises: five-finger patterns, Hanon No. 1, broken chords, arpeggios, cadences.

import { diatonicOf, fromDiatonic, keyAlter, midiOf } from '../core/theory.js';
import { brokenChordFingering } from '../core/fingering.js';
import { dpFingering } from '../core/pianofingering.js';
import { DUR, layoutEvents, measureLength } from '../core/musicxml.js';
import {
  assembleScore, TONIC_CHOICES, CIRCLE_PCS, pcOfChoice, tonicFor, placeTonic, handsList, clefForHand,
} from './common.js';

const TYPES = {
  fiveFinger: { label: 'Five-finger patterns', time: { beats: 4, beatType: 4 }, value: 'eighth' },
  hanon1: { label: 'Hanon No. 1', time: { beats: 4, beatType: 4 }, value: 'sixteenth' },
  brokenChords: { label: 'Broken chords (inversions)', time: { beats: 3, beatType: 4 }, value: 'eighth' },
  arpeggios: { label: 'Arpeggios', time: { beats: 6, beatType: 8 }, value: 'eighth' },
  cadences: { label: 'Cadence I–IV–V–I', time: { beats: 4, beatType: 4 }, value: 'half' },
};

export const warmupExercise = {
  id: 'warmups',
  label: 'Warm-ups',
  description: 'Technical warm-ups: five-finger patterns, Hanon, broken chords, arpeggios and cadences.',
  options: [
    { id: 'type', label: 'Exercise', type: 'select', default: 'fiveFinger', choices: Object.entries(TYPES).map(([k, v]) => [k, v.label]) },
    {
      id: 'tonic', label: 'Key', type: 'select', default: 'C',
      choices: [['chromatic', 'Rising by semitones'], ['circle', 'All 12 (circle of fifths)'], ['random', 'Random'], ...TONIC_CHOICES],
    },
    { id: 'mode', label: 'Mode', type: 'select', default: 'major', choices: [['major', 'Major'], ['minor', 'Minor']] },
    { id: 'hands', label: 'Hands', type: 'select', default: 'R', choices: [['R', 'Right'], ['L', 'Left'], ['both', 'Both']] },
    {
      id: 'octaves', label: 'Octaves', type: 'select', default: '2', choices: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
      showIf: (o) => o.type === 'arpeggios',
    },
    {
      id: 'noteValue', label: 'Note value', type: 'select', default: 'auto',
      choices: [['auto', 'Default'], ['quarter', 'Quarters'], ['eighth', 'Eighths'], ['sixteenth', 'Sixteenths']],
      showIf: (o) => o.type !== 'cadences',
    },
    { id: 'fingering', label: 'Show fingering', type: 'checkbox', default: true },
  ],

  generate(o, rng) {
    const def = TYPES[o.type];
    const hands = handsList(o.hands);
    const time = def.time;
    const mLen = measureLength(time);
    const value = DUR[o.noteValue === 'auto' || !o.noteValue ? def.value : o.noteValue];
    let pcs;
    if (o.tonic === 'circle') pcs = CIRCLE_PCS;
    else if (o.tonic === 'chromatic') pcs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    else pcs = [o.tonic === 'random' ? rng.int(0, 11) : pcOfChoice(o.tonic)];
    // Rising by semitones keeps C major and uses accidentals, so the signature doesn't change every bar.
    const fixedKey = o.tonic === 'chromatic' ? { fifths: 0, mode: 'major' } : null;

    const staffMeasures = hands.map(() => []);
    const meta = [];
    let firstKey = null;
    let lastName = '';
    for (const [k, pc] of pcs.entries()) {
      const { name, key } = tonicFor(pc, o.mode);
      lastName = name;
      const sigKey = fixedKey || { fifths: key.fifths, mode: key.mode };
      if (k === 0) firstKey = sigKey;
      else if (!fixedKey) meta[staffMeasures[0].length] = { key: sigKey, newSystem: o.type !== 'fiveFinger' };
      const ctx = { name, mode: o.mode, fifths: key.fifths, hands, value, mLen, octaves: +o.octaves || 1, fingering: o.fingering, last: k === pcs.length - 1 };
      const lines = GENERATORS[o.type](ctx);
      lines.forEach((events, s) => staffMeasures[s].push(...layoutEvents(events, mLen)));
    }
    const keyText = pcs.length > 1 ? (o.tonic === 'circle' ? 'circle of fifths' : 'rising by semitones') : `${lastName} ${o.mode}`;
    return assembleScore({
      title: `${def.label} — ${keyText}`,
      key: firstKey,
      time,
      clefs: hands.map(clefForHand),
      staffMeasures,
      measureMeta: meta,
      autoClef: true,
    });
  },
};

// ---------------------------------------------------------------- helpers

/** Pitch at a diatonic offset from a tonic, in the tonic's key (minor: optionally raised 7th). */
function degree(tonic, offset, fifths) {
  const p = fromDiatonic(diatonicOf(tonic) + offset);
  p.alter = keyAlter(p.step, fifths);
  return p;
}

const tonicFor2 = (ctx, hand) => placeTonic(ctx.name, hand === 'R' ? 60 : 48);

/** Lengthen the last event so the segment ends on a barline (at least a half note). */
function closeSegment(events, mLen) {
  const total = events.slice(0, -1).reduce((a, e) => a + e.dur, 0);
  let last = mLen - (total % mLen);
  if (last < mLen / 2) last += mLen;
  events[events.length - 1].dur = last;
  return events;
}

const note = (p, dur, finger, show) => ({ pitches: [{ ...p, finger: show ? finger : undefined }], dur });

// ---------------------------------------------------------------- generators

const GENERATORS = {
  fiveFinger(ctx) {
    return ctx.hands.map((hand) => {
      const tonic = tonicFor2(ctx, hand);
      const pattern = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0];
      const events = pattern.map((d) => note(degree(tonic, d, ctx.fifths), ctx.value, hand === 'R' ? d + 1 : 5 - d, ctx.fingering));
      return closeSegment(events, ctx.mLen);
    });
  },

  hanon1(ctx) {
    return ctx.hands.map((hand) => {
      const tonic = tonicFor2(ctx, hand);
      const events = [];
      const up = [0, 2, 3, 4, 5, 4, 3, 2];
      const fUp = hand === 'R' ? [1, 2, 3, 4, 5, 4, 3, 2] : [5, 4, 3, 2, 1, 2, 3, 4];
      const fDown = hand === 'R' ? [5, 4, 3, 2, 1, 2, 3, 4] : [1, 2, 3, 4, 5, 4, 3, 2];
      for (let s = 0; s < 14; s++) up.forEach((d, i) => events.push(note(degree(tonic, s + d, ctx.fifths), ctx.value, fUp[i], ctx.fingering)));
      for (let s = 18; s > 4; s--) up.forEach((d, i) => events.push(note(degree(tonic, s - d, ctx.fifths), ctx.value, fDown[i], ctx.fingering)));
      events.push(note(tonic, ctx.value, hand === 'R' ? 1 : 5, ctx.fingering));
      return closeSegment(events, ctx.mLen);
    });
  },

  brokenChords(ctx) {
    return ctx.hands.map((hand) => {
      const tonic = tonicFor2(ctx, hand);
      const shapes = [[0, 2, 4, 7], [2, 4, 7, 9], [4, 7, 9, 11], [7, 9, 11, 14]];
      const order = [0, 1, 2, 3, 2, 1, 0];
      const events = [];
      for (const idx of order) {
        const ps = shapes[idx].map((d) => degree(tonic, d, ctx.fifths));
        const fingers = brokenChordFingering(ps.map(midiOf), hand);
        [0, 1, 2, 3, 2, 1].forEach((i) => events.push(note(ps[i], ctx.value, fingers[i], ctx.fingering)));
      }
      events.push(note(tonic, ctx.value, hand === 'R' ? 1 : 5, ctx.fingering));
      return closeSegment(events, ctx.mLen);
    });
  },

  arpeggios(ctx) {
    const n = ctx.octaves;
    return ctx.hands.map((hand) => {
      const tonic = placeTonic(ctx.name, (hand === 'R' ? 60 : 48) - (n >= 3 ? 12 : 0));
      const offsets = [];
      for (let o = 0; o < n; o++) offsets.push(7 * o, 7 * o + 2, 7 * o + 4);
      offsets.push(7 * n);
      const upIdx = offsets.map((_, i) => i);
      const pitches = upIdx.concat(upIdx.slice(0, -1).reverse()).map((i) => degree(tonic, offsets[i], ctx.fifths));
      // Every key gets fingering: 1-2-3 / 5-4-2-1 on white-key triads, thumbs moved to white keys elsewhere.
      const fingers = dpFingering(pitches.map(midiOf), hand);
      const events = pitches.map((p, i) => note(p, ctx.value, fingers[i], ctx.fingering));
      return closeSegment(events, ctx.mLen);
    });
  },

  cadences(ctx) {
    // I – IV(6/4) – V(6) – I in close position; minor keys get a raised leading tone in V.
    const raise = (p) => (ctx.mode === 'minor' && degreeOf(p, ctx) === 6 ? { ...p, alter: p.alter + 1 } : p);
    const chords = [[0, 2, 4], [0, 3, 5], [-1, 1, 4], [0, 2, 4]];
    const bass = [-7, -11, -10, -7];
    const durs = [DUR.half, DUR.half, DUR.half, DUR.half];
    return ctx.hands.map((hand) => {
      const tonic = placeTonic(ctx.name, 60);
      return chords.map((c, i) => {
        if (hand === 'L' && ctx.hands.length === 2) {
          return note(degree(tonic, bass[i], ctx.fifths), durs[i], 5, ctx.fingering);
        }
        const shift = hand === 'L' ? -7 : 0;
        const ps = c.map((d) => raise(degree(tonic, d + shift, ctx.fifths)));
        const m = ps.map(midiOf);
        const fingers = hand === 'R' ? [1, m[2] - m[1] >= 5 ? 2 : 3, 5] : [5, m[1] - m[0] >= 5 ? 2 : 3, 1];
        return { pitches: ps.map((p, j) => ({ ...p, finger: ctx.fingering ? fingers[j] : undefined })), dur: durs[i] };
      });
    });
  },
};

/** Scale degree index (0 = tonic) of a pitch relative to the context tonic letter. */
function degreeOf(p, ctx) {
  const t = 'CDEFGAB'.indexOf(ctx.name[0]);
  return ('CDEFGAB'.indexOf(p.step) - t + 7) % 7;
}
