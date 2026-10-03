// Standard piano scale fingerings.
// Each table lists one octave ascending, from tonic to tonic (8 fingers).
// RH: interior tonics take table[0]; LH: interior tonics take table[7].

import { pitchName, isBlackKey, midiOf } from './theory.js';

const f = (s) => s.split('').map(Number);

const MAJOR = {
  C: ['12312345', '54321321'],
  G: ['12312345', '54321321'],
  D: ['12312345', '54321321'],
  A: ['12312345', '54321321'],
  E: ['12312345', '54321321'],
  B: ['12312345', '43214321'],
  Cb: ['12312345', '43214321'],
  'F#': ['23412312', '43213214'],
  Gb: ['23412312', '43213214'],
  Db: ['23123412', '32143213'],
  'C#': ['23123412', '32143213'],
  Ab: ['34123123', '32143213'],
  Eb: ['31234123', '32143213'],
  Bb: ['41231234', '32143213'],
  F: ['12341234', '54321321'],
};

const MINOR = {
  A: ['12312345', '54321321'],
  E: ['12312345', '54321321'],
  B: ['12312345', '43214321'],
  'F#': ['34123123', '43213214'],
  'C#': ['34123123', '32143213'],
  'G#': ['34123123', '32143213'],
  Ab: ['34123123', '32143213'],
  'D#': ['31234123', '21432132'],
  Eb: ['31234123', '21432132'],
  'A#': ['41231234', '21321432'],
  Bb: ['41231234', '21321432'],
  F: ['12341234', '54321321'],
  C: ['12312345', '54321321'],
  G: ['12312345', '54321321'],
  D: ['12312345', '54321321'],
};

export function hasScaleFingering(tonicName, mode) {
  return Boolean((mode === 'minor' ? MINOR : MAJOR)[tonicName]);
}

/**
 * Fingering for an ascending sequence of scale notes (length 7*octaves+1).
 * @param hand 'R' | 'L'
 */
export function scaleFingering(tonicName, mode, hand, octaves) {
  const entry = (mode === 'minor' ? MINOR : MAJOR)[tonicName];
  if (!entry) return null;
  const table = f(entry[hand === 'R' ? 0 : 1]);
  const n = 7 * octaves + 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const deg = i % 7;
    if (i === 0) out.push(table[0]);
    else if (i === n - 1) out.push(table[7]);
    else if (deg === 0) out.push(hand === 'R' ? table[0] : table[7]);
    else out.push(table[deg]);
  }
  return out;
}

/** Chromatic scale: RH 3 on black keys, 2 on F and C, else 1. LH: 3 on black, 2 on E and B, else 1. */
export function chromaticFinger(pitch, hand) {
  const midi = midiOf(pitch);
  if (isBlackKey(midi)) return 3;
  const pc = ((midi % 12) + 12) % 12;
  if (hand === 'R') return pc === 5 || pc === 0 ? 2 : 1;
  return pc === 4 || pc === 11 ? 2 : 1;
}

/**
 * Fingering for a 4-note broken chord spanning an octave (e.g. C E G C), ascending.
 * The middle finger becomes 4 where the gap between the 2nd and 3rd notes is a fourth.
 */
export function brokenChordFingering(midis, hand) {
  const wideGap = midis.length >= 3 && midis[2] - midis[1] >= 5;
  if (hand === 'R') return [1, 2, wideGap ? 4 : 3, 5];
  return [5, wideGap ? 4 : 3, 2, 1];
}

/** Five-finger position: ascending fingers 1..5 (RH) or 5..1 (LH). */
export function fiveFinger(hand) {
  return hand === 'R' ? [1, 2, 3, 4, 5] : [5, 4, 3, 2, 1];
}

export const tonicLabel = (p) => pitchName(p, false);

/**
 * Fingering for any 7-note scale without a standard table (e.g. the church modes), built the way the
 * standard fingerings are: per octave one group of 1-2-3 and one of 1-2-3-4, thumbs only on white keys.
 * The rules for choosing where the thumbs go (they reproduce every standard major and minor table above):
 *  - a white tonic always takes the thumb, so the scale can start or end on 5;
 *  - otherwise, thumbs go on white keys that follow a black key in the thumb-under direction
 *    (RH ascending, LH descending), with the 1-2-3 group first as a tie-break.
 * @param midis one octave ascending, tonic to tonic (8 MIDI numbers)
 * @param hand 'R' | 'L'
 * @returns fingers for the ascending sequence of length 7*octaves+1, or null
 */
export function computedScaleFingering(midis, hand, octaves) {
  const deg = midis.slice(0, 7);
  // Work in the thumb-under direction: RH ascending, LH descending (degree order reversed).
  const order = hand === 'R' ? [0, 1, 2, 3, 4, 5, 6] : [0, 6, 5, 4, 3, 2, 1];
  const black = order.map((d) => isBlackKey(deg[d]));
  const afterBlack = (i) => black[(i + 6) % 7];
  let best = null;
  for (let a = 0; a < 7; a++) {
    for (const gap of [3, 4]) {
      const b = (a + gap) % 7;
      if (black[a] || black[b]) continue;
      const tonicThumb = a === 0 || b === 0;
      if (!black[0] && !tonicThumb) continue;
      // Prefer the group starting at the tonic (or the first thumb after it) to be the 3-finger one.
      const first = Math.min(a, b) === a ? gap : 7 - gap;
      const score = (afterBlack(a) ? 1 : 0) + (afterBlack(b) ? 1 : 0) + (first === 3 ? 0.1 : 0);
      if (!best || score > best.score) best = { score, a, b };
    }
  }
  if (!best) return null;
  // Finger of each position (in thumb-under order): count from the most recent thumb.
  const fingerAt = (i) => {
    for (let k = 0; k < 7; k++) {
      const j = (i - k + 7) % 7;
      if (j === best.a || j === best.b) return k + 1;
    }
    return null;
  };
  const n = 7 * octaves + 1;
  const seq = [];
  for (let i = 0; i < n; i++) seq.push(fingerAt(i % 7));
  // The last note in the thumb-under direction doesn't need a thumb: it takes the next finger (4 or 5).
  if (seq[n - 1] === 1) seq[n - 1] = seq[n - 2] + 1;
  // seq runs RH ascending / LH descending; return it in ascending order.
  return hand === 'R' ? seq : seq.reverse();
}
