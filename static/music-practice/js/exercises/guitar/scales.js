// Guitar scales: any scale type in box positions (CAGED-style) or three notes per string, with tab and fingering.

import {
  SCALE_TYPES, buildScale, scaleTonic, scaleName, scaleGroups, scaleSize, spellWithStep, spellMidi, midiOf,
} from '../../core/theory.js';
import { DUR, layoutEvents } from '../../core/musicxml.js';
import { scalePositions } from '../../guitar/patterns.js';
import { TONIC_CHOICES, pcOfChoice, placeTonic } from '../common.js';
import {
  displayOption, NOTE_VALUE_OPTION, SEQUENCE_OPTION, tuningOf, guitarScore, finalDuration, measureLength,
  sequenceIndices, prettyName,
} from './common.js';

const positionChoices = (n, word) => [['all', 'All in sequence'], ...Array.from({ length: n }, (_, i) => [`${i + 1}`, `${word} ${i + 1}`])];

export const guitarScalesExercise = {
  id: 'g-scales',
  label: 'Scales',
  description: 'Scales in every position on the neck, as boxes or three notes per string, with tab and fingering.',
  instrument: 'guitar',
  options: [
    {
      id: 'scaleType', label: 'Scale', type: 'select', default: 'major',
      choices: scaleGroups().map(([group, ids]) => ({ group, choices: ids.map((id) => [id, SCALE_TYPES[id].label]) })),
    },
    { id: 'tonic', label: 'Key', type: 'select', default: 'G', choices: [['random', 'Random'], ...TONIC_CHOICES] },
    {
      id: 'system', label: 'System', type: 'select', default: 'caged',
      choices: [['caged', 'Positions (CAGED)'], ['3nps', '3 notes per string']],
    },
    { id: 'position', label: 'Position', type: 'select', default: '1', choices: positionChoices(5, 'Position'), showIf: (o) => o.system !== '3nps' },
    { id: 'pattern', label: 'Pattern', type: 'select', default: '1', choices: positionChoices(7, 'Pattern'), showIf: (o) => o.system === '3nps' },
    SEQUENCE_OPTION,
    NOTE_VALUE_OPTION,
    { id: 'fingering', label: 'Show left-hand fingering', type: 'checkbox', default: true },
    displayOption('both'),
  ],

  generate(o, rng, ctx) {
    const tuning = tuningOf(ctx);
    const type = o.scaleType;
    const pc = o.tonic === 'random' ? rng.int(0, 11) : pcOfChoice(o.tonic);
    const { name, fifths, mode } = scaleTonic(pc, type);
    // 3 notes per string needs 7-note scales; others fall back to positions.
    const system = o.system === '3nps' && scaleSize(type) === 7 ? '3nps' : 'caged';
    const positions = scalePositions(type, pc, tuning, { system });
    const choice = system === '3nps' ? o.pattern : o.position;
    const chosen = choice === 'all' || !choice ? positions
      : [positions[Math.min(positions.length, +choice) - 1]];
    const spell = spellerFor(name, type);
    const time = { beats: 4, beatType: 4 };
    const mLen = measureLength(time);
    const v = DUR[o.noteValue] || DUR.eighth;

    const measures = [];
    const meta = [];
    for (const pos of chosen) {
      const idx = sequenceIndices(pos.notes.length, o.sequence);
      const events = idx.map((i) => ({ pitches: [noteToPitch(pos.notes[i], spell)], dur: v }));
      events[events.length - 1].dur = finalDuration(events.length, v, mLen);
      meta[measures.length] = { label: chosen.length > 1 ? pos.label : undefined, newSystem: measures.length > 0 };
      measures.push(...layoutEvents(events, mLen));
    }
    const sysText = system === '3nps' ? '3 notes per string' : 'positions';
    const where = chosen.length > 1 ? `all ${sysText}` : chosen[0].label;
    return guitarScore({
      title: `${prettyName(name)} ${scaleName(type)} — ${where}`,
      key: { fifths, mode: mode === 'minor' ? 'minor' : 'major' },
      time,
      display: o.display,
      tuning,
      measures,
      measureMeta: meta,
      fingering: o.fingering,
    });
  },
};

/** pitch class -> letter name of a scale's notes, from its conventional spelling. */
export function spellerFor(name, type) {
  const steps = {};
  const def = SCALE_TYPES[type];
  if (!def.chromatic) for (const p of buildScale(placeTonic(name, 60), type, 1, 'up')) steps[midiOf(p) % 12] = p.step;
  return (midi) => (steps[midi % 12] ? spellWithStep(midi, steps[midi % 12]) : spellMidi(midi, true));
}

/** Pitch object (sounding pitch) for a fretboard note, carrying string, fret and finger. */
export function noteToPitch(note, spell) {
  return { ...spell(note.midi), string: note.string, fret: note.fret, finger: note.finger || undefined };
}
