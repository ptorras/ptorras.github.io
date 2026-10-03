// Guitar scale and arpeggio maps: the whole neck, then each position (CAGED or 3 notes per string) on its own.
// Clicking a position plays it up and down and shows it on the fretboard.

import { h } from './panel.js';
import {
  CHORD_TYPES, CHORD_GROUPS, chordTypesIn, chordIntervals, chordRootName, chordSymbol, prettyNote, buildChord,
} from '../core/chords.js';
import { SCALE_TYPES, scaleGroups, scaleTonic, scaleIntervals, scaleName, buildScale, parsePitch, midiOf } from '../core/theory.js';
import { MAX_FRET, intervalName } from '../guitar/tunings.js';
import { scalePositions, arpeggioPositions, neckMap, chordRoles } from '../guitar/patterns.js';
import { fretboardSVG, PC_NAMES } from '../guitar/diagram.js';

const KEY_LABELS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const NOTE_SECONDS = 1 / 6;
const pcOf = (m) => ((m % 12) + 12) % 12;

/** Pitch-class names spelled for a scale on a tonic: pc -> 'F♯'. */
function scaleNoteNames(rootPc, type) {
  const names = [...PC_NAMES];
  const tonic = scaleTonic(rootPc, type).name;
  for (const p of buildScale(parsePitch(`${tonic}4`), type, 1, 'up')) names[pcOf(midiOf(p))] = prettyNote(p);
  return names;
}

/** Pitch-class names spelled for a chord: pc -> 'E♭'. */
function chordNoteNames(rootPc, type) {
  const names = [...PC_NAMES];
  for (const p of buildChord(`${chordRootName(rootPc, type)}4`, type)) names[pcOf(midiOf(p))] = prettyNote(p);
  return names;
}

export const scaleMapsPanel = {
  id: 'g-scalemaps',
  label: 'Scale maps',
  description: 'Scales and arpeggios across the neck and position by position. Click a position to hear it.',
  instrument: 'guitar',
  kind: 'panel',
  options: [
    { id: 'what', label: 'Show', type: 'select', default: 'scale', choices: [['scale', 'Scale'], ['arpeggio', 'Arpeggio']] },
    {
      id: 'scale', label: 'Scale', type: 'select', default: 'minorPentatonic', showIf: (v) => v.what === 'scale',
      choices: scaleGroups((id) => id !== 'chromatic')
        .map(([group, ids]) => ({ group, choices: ids.map((id) => [id, SCALE_TYPES[id].label]) })),
    },
    {
      id: 'chord', label: 'Chord', type: 'select', default: 'dom7', showIf: (v) => v.what === 'arpeggio',
      choices: CHORD_GROUPS.map((g) => ({ group: g, choices: chordTypesIn(g).map((id) => [id, CHORD_TYPES[id].label]) })),
    },
    { id: 'key', label: 'Key', type: 'select', default: '9', choices: KEY_LABELS.map((l, pc) => [String(pc), l]) },
    {
      id: 'system', label: 'Positions', type: 'select', default: 'caged', showIf: (v) => v.what === 'scale',
      choices: [['caged', 'CAGED'], ['3nps', '3 notes per string']],
    },
    { id: 'labels', label: 'Dot labels', type: 'select', default: 'intervals', choices: [['intervals', 'Intervals'], ['notes', 'Notes'], ['fingers', 'Fingers']] },
  ],

  create(ctx) {
    const root = h('div', { class: 'gpanel scalemaps' });
    ctx.container.appendChild(root);
    let positions = [];
    let timers = [];
    let active = null;

    const stop = () => {
      timers.forEach(clearTimeout);
      timers = [];
      for (const g of root.querySelectorAll('.fb-mark.playing')) g.classList.remove('playing');
    };

    function render() {
      stop();
      const v = ctx.values;
      const tuning = ctx.tuning;
      const pc = Number(v.key);
      const arp = v.what === 'arpeggio';
      const type = arp ? v.chord : v.scale;
      const names = arp ? chordNoteNames(pc, type) : scaleNoteNames(pc, type);
      const title = arp ? `${chordSymbol(chordRootName(pc, type), type)} arpeggio`
        : `${prettyNote(scaleTonic(pc, type).name)} ${scaleName(type)}`;
      const intervals = arp ? chordIntervals(type) : scaleIntervals(type);

      const intervalOf = (n) => {
        for (const x of [n.interval, n.role]) if (typeof x === 'string' && x !== 'root' && x !== 'tone') return x;
        return intervalName(n.midi - pc);
      };
      const label = (n, allowFingers = true) => {
        if (v.labels === 'notes') return names[pcOf(n.midi)];
        if (v.labels === 'fingers' && allowFingers) return n.finger ?? '';
        return intervalOf(n);
      };
      const kind = (n) => (pcOf(n.midi) === pc ? 'root' : 'tone');

      try {
        positions = arp ? arpeggioPositions(type, pc, tuning) : scalePositions(type, pc, tuning, { system: v.system });
      } catch (err) {
        console.warn('positions failed', err);
        positions = [];
      }
      let map = [];
      try {
        map = neckMap(intervals, pc, tuning, { maxFret: MAX_FRET, roles: arp ? chordRoles(type) : null });
      } catch (err) {
        console.warn('neckMap failed', err);
      }
      const posMax = Math.max(15, ...positions.flatMap((p) => p.notes.map((n) => n.fret)));
      const toFret = Math.min(MAX_FRET, posMax + 1);

      root.innerHTML = '';
      root.append(h('h3', {}, title, h('span', { class: 'muted' }, 'whole neck')));
      const full = map.filter((n) => n.fret <= toFret)
        .map((n) => ({ string: n.string, fret: n.fret, label: label(n, false), kind: kind(n) }));
      root.append(h('div', { class: 'scale-full', html: fretboardSVG({ tuning, toFret, marks: full }) }));
      root.append(h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'root' }), 'root'),
        h('span', {}, h('i', { class: 'tone' }), arp ? 'chord tone' : 'scale tone')));

      if (!positions.length) {
        root.append(h('div', { class: 'empty' }, v.system === '3nps' && !arp
          ? 'Three notes per string needs a 7-note scale; choose CAGED positions for this one.'
          : 'No positions found.'));
        return;
      }
      root.append(h('h3', {}, arp ? 'Arpeggio positions' : v.system === '3nps' ? '3 notes per string' : 'CAGED positions',
        h('span', { class: 'muted' }, 'click to play')));
      const grid = h('div', { class: 'position-grid' });
      positions.forEach((p, i) => {
        const frets = p.notes.map((n) => n.fret);
        const lo = Math.min(...frets);
        const hi = Math.max(...frets);
        const from = lo <= 1 ? 0 : lo;
        const to = Math.max(hi, from + 4);
        const marks = p.notes.map((n) => ({ string: n.string, fret: n.fret, label: label(n), kind: kind(n) }));
        grid.append(h('div', { class: 'position-card', 'data-i': i, title: 'Click to play up and down' },
          h('div', { class: 'cap' }, p.label || `Position ${i + 1}`, /fret/.test(p.label || '') ? null : h('span', { class: 'muted' }, `frets ${lo}–${hi}`)),
          h('div', { html: fretboardSVG({ tuning, fromFret: from, toFret: to, marks, cellWidth: 44 }) })));
      });
      root.append(grid);
    }

    function play(card, pos) {
      stop();
      const seen = new Set();
      const up = [...pos.notes].sort((a, b) => a.midi - b.midi || b.string - a.string)
        .filter((n) => !seen.has(n.midi) && seen.add(n.midi));
      const seq = up.concat(up.slice(0, -1).reverse());
      ctx.setHints?.(up.map((n) => ({ midi: n.midi, string: n.string, fret: n.fret })));
      ctx.setStatus?.(`${pos.label || 'Position'}: ${up.length} notes`);
      const audio = ctx.audio;
      let t0 = 0;
      if (audio) { audio.ensure?.(); t0 = audio.now + 0.05; }
      seq.forEach((n, k) => {
        audio?.playNote(n.midi, t0 + k * NOTE_SECONDS, NOTE_SECONDS * 1.1, 80);
        const g = card.querySelector(`.fb-mark[data-s="${n.string}"][data-f="${n.fret}"]`);
        if (!g) return;
        timers.push(setTimeout(() => g.classList.add('playing'), 50 + k * NOTE_SECONDS * 1000));
        timers.push(setTimeout(() => g.classList.remove('playing'), 50 + (k + 1) * NOTE_SECONDS * 1000));
      });
    }

    function onClick(e) {
      const card = e.target.closest('.position-card');
      if (!card) return;
      active?.classList.remove('active');
      active = card;
      card.classList.add('active');
      play(card, positions[+card.dataset.i]);
    }
    root.addEventListener('click', onClick);
    render();

    return {
      onOptions() { active = null; render(); },
      destroy() {
        stop();
        root.removeEventListener('click', onClick);
        ctx.setHints?.([]);
        root.remove();
      },
    };
  },
};
