// Guitar chord library: a cheat sheet of chord diagrams for one root or all 12, in the current tuning.
// Clicking a diagram strums it and shows it on the fretboard.

import { h } from './panel.js';
import { CHORD_TYPES, CHORD_GROUPS, chordTypesIn, chordRootName, chordSymbol, buildChord, prettyNote } from '../core/chords.js';
import { midiOf } from '../core/theory.js';
import { chordVoicings } from '../guitar/voicings.js';
import { chordDiagramSVG, PC_NAMES } from '../guitar/diagram.js';

const ROOT_LABELS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const LIMITS = { 1: 1, 3: 3, all: 24 };
const STYLE_TAGS = { open: 'open', barre: 'barre', movable: 'movable', shell: 'shell', drop2: 'drop 2', drop3: 'drop 3' };

/** Pitch-class names spelled for a chord: pc -> 'E♭'. */
export function chordNoteNames(rootPc, type) {
  const names = [...PC_NAMES];
  const rootName = chordRootName(rootPc, type);
  for (const p of buildChord(`${rootName}4`, type)) names[((midiOf(p) % 12) + 12) % 12] = prettyNote(p);
  return names;
}

export const chordLibraryPanel = {
  id: 'g-chordlib',
  label: 'Chord library',
  description: 'Chord diagrams for any root and chord type. Click a chord to hear it and see it on the fretboard.',
  instrument: 'guitar',
  kind: 'panel',
  options: [
    { id: 'root', label: 'Root', type: 'select', default: '0', choices: [['all', 'All 12'], ...ROOT_LABELS.map((l, pc) => [String(pc), l])] },
    {
      id: 'set', label: 'Chords', type: 'select', default: 'group:Triads',
      choices: [
        { group: 'Sets', choices: CHORD_GROUPS.map((g) => [`group:${g}`, `All ${g.toLowerCase()}`]) },
        ...CHORD_GROUPS.map((g) => ({ group: g, choices: chordTypesIn(g).map((id) => [id, CHORD_TYPES[id].label]) })),
      ],
    },
    { id: 'style', label: 'Voicings', type: 'select', default: 'any', choices: [['open', 'Open'], ['barre', 'Barre'], ['jazz', 'Jazz (4 strings)'], ['any', 'All']] },
    { id: 'labels', label: 'Dot labels', type: 'select', default: 'fingers', choices: [['fingers', 'Fingers'], ['notes', 'Notes'], ['roles', 'Chord tones']] },
    { id: 'count', label: 'Per chord', type: 'select', default: '3', choices: [['1', '1 voicing'], ['3', '3 voicings'], ['all', 'All voicings']] },
  ],

  create(ctx) {
    const root = h('div', { class: 'gpanel chordlib' });
    ctx.container.appendChild(root);
    let cards = []; // [{ voicing, tuning, symbol }]
    let active = null;

    const typesOf = (set) => (set.startsWith('group:') ? chordTypesIn(set.slice(6)) : [set]);

    function render() {
      const v = ctx.values;
      const tuning = ctx.tuning;
      const roots = v.root === 'all' ? [...Array(12).keys()] : [Number(v.root)];
      const limit = LIMITS[v.count] ?? 3;
      root.innerHTML = '';
      const flow = h('div', { class: 'chord-secs' });
      root.append(flow);
      cards = [];
      active = null;
      for (const type of typesOf(v.set)) {
        const def = CHORD_TYPES[type];
        const head = roots.length === 1 ? chordSymbol(chordRootName(roots[0], type), type) : def.label;
        const grid = h('div', { class: 'chord-grid' });
        for (const pc of roots) {
          const symbol = chordSymbol(chordRootName(pc, type), type);
          let voicings = [];
          try {
            voicings = chordVoicings(pc, type, tuning, { style: v.style, limit });
          } catch (err) {
            console.warn('chordVoicings failed', symbol, err);
          }
          const names = chordNoteNames(pc, type);
          voicings.slice(0, limit).forEach((voicing) => {
            const idx = cards.length;
            cards.push({ voicing, tuning, symbol });
            const svg = chordDiagramSVG(voicing, { title: symbol, labels: v.labels, names, tuning, rootPc: pc });
            const tag = v.style === 'any' || v.style === 'jazz' ? (STYLE_TAGS[voicing.style] ?? voicing.style ?? '') : '';
            grid.append(h('div', { class: 'chord-card', 'data-i': idx, title: `${symbol}: click to play`, html: svg },
              tag ? h('span', { class: 'tag' }, tag) : null));
          });
        }
        flow.append(h('section', { class: 'chord-sec' },
          h('h3', {}, head, roots.length === 1 ? h('span', { class: 'muted' }, def.label) : null),
          grid.children.length ? grid : h('div', { class: 'empty' }, 'No voicings of this kind.')));
      }
    }

    function play(card) {
      const { voicing, tuning } = card;
      const n = voicing.frets.length;
      const notes = [];
      voicing.frets.forEach((f, i) => {
        if (f >= 0) notes.push({ midi: tuning.strings[i] + f, string: n - i, fret: f });
      });
      ctx.setHints?.(notes);
      ctx.setStatus?.(`${card.symbol}: ${voicing.frets.map((f) => (f < 0 ? 'x' : f)).join(' ')}`);
      const audio = ctx.audio;
      if (!audio) return;
      audio.ensure?.();
      const t0 = audio.now + 0.03;
      notes.forEach((nt, k) => audio.playNote(nt.midi, t0 + k * 0.025, 1.8, 85));
    }

    function onClick(e) {
      const el = e.target.closest('.chord-card');
      if (!el) return;
      active?.classList.remove('active');
      active = el;
      el.classList.add('active');
      play(cards[+el.dataset.i]);
    }
    root.addEventListener('click', onClick);
    render();

    return {
      onOptions() { render(); },
      destroy() {
        root.removeEventListener('click', onClick);
        ctx.setHints?.([]);
        root.remove();
      },
    };
  },
};
