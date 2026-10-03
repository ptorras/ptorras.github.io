// Shared helpers for exercise generators.

import { midiOf, spellWithStep, findKey, TONIC_BY_PC } from '../core/theory.js';
import { restMeasure, measureLength } from '../core/musicxml.js';

/**
 * Build a score model from per-staff measure lists.
 * @param staffMeasures array (one per staff) of arrays of measures (each an event array)
 * @param measureMeta optional per-measure extras ({ key, newSystem, clefs, label })
 * @param autoClef switch treble/bass per measure when a staff's notes drift out of its clef
 */
export function assembleScore({ title, key, time, clefs, staffMeasures, measureMeta = [], autoClef = false }) {
  const n = Math.max(...staffMeasures.map((m) => m.length));
  const len = measureLength(time);
  const initial = [...clefs];
  const current = [...clefs];
  const measures = [];
  for (let i = 0; i < n; i++) {
    const meta = measureMeta[i] || {};
    const m = { voices: [], key: meta.key, newSystem: meta.newSystem, label: meta.label, final: i === n - 1 };
    const changes = { ...(meta.clefs || {}) };
    staffMeasures.forEach((sm, s) => {
      const events = sm[i] || restMeasure(len);
      if (autoClef && !changes[s + 1]) {
        const midis = events.flatMap((e) => (e.rest ? [] : e.pitches.map(midiOf)));
        if (midis.length) {
          const avg = midis.reduce((a, b) => a + b, 0) / midis.length;
          if (current[s] === 'treble' && avg < 57) changes[s + 1] = 'bass';
          else if (current[s] === 'bass' && avg > 64) changes[s + 1] = 'treble';
        }
      }
      if (changes[s + 1] === current[s]) delete changes[s + 1];
      if (changes[s + 1]) current[s] = changes[s + 1];
      m.voices.push({ staff: s + 1, events });
    });
    if (Object.keys(changes).length) {
      if (i === 0) Object.entries(changes).forEach(([s, c]) => { initial[s - 1] = c; });
      else m.clefs = changes;
    }
    measures.push(m);
  }
  return { title, key, time, staves: initial, measures };
}

export const TONIC_CHOICES = [
  ['C', 'C'], ['Db', 'C♯ / D♭'], ['D', 'D'], ['Eb', 'D♯ / E♭'], ['E', 'E'], ['F', 'F'],
  ['F#', 'F♯ / G♭'], ['G', 'G'], ['Ab', 'G♯ / A♭'], ['A', 'A'], ['Bb', 'A♯ / B♭'], ['B', 'B'],
];
const PC_OF = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

/** Circle of fifths order of pitch classes starting at C. */
export const CIRCLE_PCS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export function pcOfChoice(choice) {
  return PC_OF[choice];
}

/** Conventional tonic name and key for a pitch class + mode. */
export function tonicFor(pc, mode) {
  const name = TONIC_BY_PC[mode][pc];
  const key = findKey(name, mode);
  return { name, key };
}

/** Tonic pitch object with a given name placed so its MIDI number lies in [lo, lo+11]. */
export function placeTonic(name, lo) {
  const step = name[0];
  const alter = name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0;
  const pc = (({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[step] + alter + 12) % 12;
  let midi = lo + ((pc - (lo % 12) + 12) % 12);
  return spellWithStep(midi, step);
}

export const handsList = (hands) => (hands === 'both' ? ['R', 'L'] : [hands]);
export const clefForHand = (h) => (h === 'R' ? 'treble' : 'bass');
