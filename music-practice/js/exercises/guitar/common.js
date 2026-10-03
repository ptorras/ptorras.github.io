// Shared helpers for guitar exercises: display option, tuning from the context, notation + tab scores.

import { Q, measureLength } from '../../core/musicxml.js';
import { TUNINGS } from '../../guitar/tunings.js';
import { assembleScore } from '../common.js';

export const DISPLAY_CHOICES = [['both', 'Notation + tab'], ['tab', 'Tab only'], ['notation', 'Notation only']];

/** The display option (notation + tab, tab only, notation only). */
export const displayOption = (def = 'both') => ({ id: 'display', label: 'Display', type: 'select', default: def, choices: DISPLAY_CHOICES });

export const NOTE_VALUE_OPTION = {
  id: 'noteValue', label: 'Note value', type: 'select', default: 'eighth',
  choices: [['quarter', 'Quarters'], ['eighth', 'Eighths'], ['sixteenth', 'Sixteenths']],
};

/** Tuning object from the generator context (standard when missing). */
export const tuningOf = (ctx) => (ctx && ctx.tuning && ctx.tuning.strings ? ctx.tuning : TUNINGS.standard);

/** Staff clefs for a display choice. */
export const clefsFor = (display) => ({ both: ['guitar', 'tab'], tab: ['tab'], notation: ['guitar'] })[display] || ['guitar', 'tab'];

/**
 * Score with the same music on a guitar staff and/or a tab staff.
 * @param measures array of measures, each an event array whose pitches carry string/fret (and finger)
 * @param fingering keep left-hand fingers on the notation staff
 */
export function guitarScore({ title, key, time, display, tuning, measures, measureMeta = [], fingering = true }) {
  const clefs = clefsFor(display);
  const staffMeasures = clefs.map((clef, s) => measures.map((events) => events.map((e) => {
    const ev = { ...e, pitches: e.pitches.map((p) => ({ ...p, finger: clef === 'guitar' && fingering ? p.finger : undefined })) };
    if (s > 0) delete ev.chord; // chord symbols once, above the top staff
    return ev;
  })));
  const score = assembleScore({ title, key, time, clefs, staffMeasures, measureMeta });
  score.tuning = [...tuning.strings];
  return score;
}

/** Length of the last note so a line ends on a full bar (at least a quarter). */
export function finalDuration(n, v, mLen) {
  const pos = ((n - 1) * v) % mLen;
  let last = mLen - pos;
  if (last < Q) last += mLen;
  return last;
}

export { measureLength };

/** Melodic sequences over an ascending note list: up and back down, as index lists. */
export function sequenceIndices(n, sequence) {
  const up = [];
  const down = [];
  const groups = { thirds: [0, 2], groups3: [0, 1, 2], groups4: [0, 1, 2, 3] }[sequence];
  if (!groups) {
    for (let i = 0; i < n; i++) up.push(i);
    for (let i = n - 2; i >= 0; i--) down.push(i);
    return up.concat(down);
  }
  const span = groups[groups.length - 1];
  for (let i = 0; i + span < n; i++) up.push(...groups.map((g) => i + g));
  for (let i = n - 1; i - span >= 0; i--) down.push(...groups.map((g) => i - g));
  return up.concat(down);
}

export const SEQUENCE_OPTION = {
  id: 'sequence', label: 'Sequence', type: 'select', default: 'straight',
  choices: [['straight', 'Straight up and down'], ['thirds', 'In 3rds'], ['groups3', 'Groups of 3'], ['groups4', 'Groups of 4']],
};

export const prettyName = (name) => name.replace('#', '♯').replace(/b$/, '♭');
