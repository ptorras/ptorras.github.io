// Guitar arpeggios: chord tones in five positions on the neck, with tab and fingering.

import { findKey, spellWithStep, fromDiatonic, diatonicOf, parsePitch, spellMidi } from '../../core/theory.js';
import { CHORD_TYPES, CHORD_GROUPS, chordTypesIn, chordRootName, chordSymbol } from '../../core/chords.js';
import { DUR, layoutEvents } from '../../core/musicxml.js';
import { arpeggioPositions } from '../../guitar/patterns.js';
import { TONIC_CHOICES, pcOfChoice } from '../common.js';
import {
  displayOption, NOTE_VALUE_OPTION, tuningOf, guitarScore, finalDuration, measureLength, sequenceIndices,
} from './common.js';

export const guitarArpeggioExercise = {
  id: 'g-arpeggios',
  label: 'Arpeggios',
  description: 'Arpeggios of triads, sevenths and extended chords in five positions, with tab and fingering.',
  instrument: 'guitar',
  options: [
    {
      id: 'chordType', label: 'Chord', type: 'select', default: 'maj',
      choices: CHORD_GROUPS.map((group) => ({ group, choices: chordTypesIn(group).map((id) => [id, CHORD_TYPES[id].label]) })),
    },
    { id: 'root', label: 'Root', type: 'select', default: 'C', choices: [['random', 'Random'], ...TONIC_CHOICES] },
    {
      id: 'position', label: 'Position', type: 'select', default: '1',
      choices: [['all', 'All in sequence'], ...[1, 2, 3, 4, 5].map((i) => [`${i}`, `Position ${i}`])],
    },
    {
      id: 'sequence', label: 'Sequence', type: 'select', default: 'straight',
      choices: [['straight', 'Straight up and down'], ['groups3', 'Groups of 3'], ['groups4', 'Groups of 4']],
    },
    NOTE_VALUE_OPTION,
    { id: 'fingering', label: 'Show left-hand fingering', type: 'checkbox', default: true },
    displayOption('both'),
  ],

  generate(o, rng, ctx) {
    const tuning = tuningOf(ctx);
    const type = o.chordType;
    const pc = o.root === 'random' ? rng.int(0, 11) : pcOfChoice(o.root);
    const name = chordRootName(pc, type);
    const positions = arpeggioPositions(type, pc, tuning);
    const chosen = o.position === 'all' ? positions : [positions[Math.min(positions.length, +o.position) - 1]];
    const spell = chordSpeller(name, type);
    const time = { beats: 4, beatType: 4 };
    const mLen = measureLength(time);
    const v = DUR[o.noteValue] || DUR.eighth;

    const measures = [];
    const meta = [];
    for (const pos of chosen) {
      const idx = sequenceIndices(pos.notes.length, o.sequence);
      const events = idx.map((i) => {
        const n = pos.notes[i];
        return { pitches: [{ ...spell(n.midi), string: n.string, fret: n.fret, finger: n.finger || undefined }], dur: v };
      });
      events[events.length - 1].dur = finalDuration(events.length, v, mLen);
      meta[measures.length] = { label: chosen.length > 1 ? pos.label : undefined, newSystem: measures.length > 0 };
      measures.push(...layoutEvents(events, mLen));
    }
    const symbol = chordSymbol(name, type);
    return guitarScore({
      title: `${symbol} arpeggio — ${chosen.length > 1 ? 'all positions' : chosen[0].label}`,
      key: keyForChord(name, type),
      time,
      display: o.display,
      tuning,
      measures,
      measureMeta: meta,
      fingering: o.fingering,
    });
  },
};

/** midi -> pitch spelled as a chord tone of the chord on `rootName`. */
export function chordSpeller(rootName, type) {
  const root = parsePitch(`${rootName}4`);
  const d0 = diatonicOf(root);
  const steps = {};
  for (const [semi, letter] of CHORD_TYPES[type].tones) {
    const pc = (rootPcOf(root) + semi) % 12;
    steps[pc] = fromDiatonic(d0 + letter).step;
  }
  return (midi) => {
    const step = steps[((midi % 12) + 12) % 12];
    const p = step && spellWithStep(midi, step);
    return p && Math.abs(p.alter) < 2 ? p : spellMidi(midi, rootName.includes('#'));
  };
}

const rootPcOf = (p) => ((({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[p.step] + p.alter) % 12 + 12) % 12;

/** Key signature for a chord: the major or minor key on its root when it exists, else C. */
export function keyForChord(rootName, type) {
  const tones = CHORD_TYPES[type].tones.map(([s]) => s);
  const mode = tones.includes(3) && !tones.includes(4) ? 'minor' : 'major';
  const key = findKey(rootName, mode);
  return key && Math.abs(key.fifths) <= 6 ? { fifths: key.fifths, mode } : { fifths: 0, mode: 'major' };
}
