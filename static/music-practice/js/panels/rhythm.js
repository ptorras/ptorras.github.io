// Rhythm panel: rhythm and groove training on drum pads (a 4x4 pad controller such as the pads of an Akai MPK,
// the computer keyboard, or the on-screen pads). A pattern is drawn as a drum grid, one lane per pad, and played
// at a fixed tempo after a count-in (or step by step at your own pace). The course walks through levels from
// quarter notes to odd meters, fills and polyrhythms. Generation, timing and scoring live in rhythm-logic.js.

import { h } from './panel.js';
import { Matcher } from '../practice/matcher.js';
import { playDrum } from '../io/drums.js';
import { safeStorage } from './trainer-stats.js';
import { makeRng } from '../core/rng.js';
import {
  TPQ, PADS, PAD_KEYS, METERS, LEVELS, POLYRHYTHMS, PASS_ACCURACY, PASS_ACCENTS, defaultPadMap, padOf, makePattern,
  specFromOptions, buildRun, positionAt, tempoSteps, waitSteps, timingClass, hasDynamics, dynamicsOk, laneOffsets,
  countLabels, passes,
} from './rhythm-logic.js';

export const RHYTHM_STORE_KEY = 'pianoPractice.rhythm.v1';
const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD_CODES = PAD_KEYS.map((k) => (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`));
const PAD_ROWS = [[12, 13, 14, 15], [8, 9, 10, 11], [4, 5, 6, 7], [0, 1, 2, 3]]; // top row first, pad 1 bottom left
const PASS_PCT = Math.round(PASS_ACCURACY * 100);
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (m) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

const ex = (...ids) => (v) => ids.includes(v.exercise);
const stepCapable = ex('rhythm', 'groove', 'poly');

// Every option of every drum tab. `showIf` sees the tab's exercise as `exercise`; each tab keeps the options that
// can show for its exercise (see drumTab).
export const RHYTHM_OPTIONS = [
    {
      id: 'meter', label: 'Time signature', type: 'select', default: '4/4', showIf: ex('rhythm', 'groove', 'echo'),
      choices: [...Object.keys(METERS).map((m) => [m, m]), ['simple', 'Changing (2/4, 3/4, 4/4)'], ['mixed', 'Changing (odd meters too)']],
    },
    { id: 'bars', label: 'Bars', type: 'select', default: '2', showIf: ex('rhythm', 'groove', 'poly'), choices: [['1', '1'], ['2', '2'], ['4', '4'], ['8', '8']] },
    {
      id: 'sub', label: 'Notes', type: 'select', default: 'eighth', showIf: ex('rhythm', 'echo'),
      choices: [['quarter', 'Quarter notes'], ['eighth', 'Eighth notes'], ['sixteenth', 'Sixteenth notes'], ['triplet', 'Triplets'], ['mixed', 'Mixed']],
    },
    { id: 'rests', label: 'Rests', type: 'checkbox', default: true, showIf: ex('rhythm', 'echo') },
    { id: 'sync', label: 'Syncopation (off-beats)', type: 'checkbox', default: false, showIf: ex('rhythm') },
    {
      id: 'pads', label: 'Pads', type: 'select', default: '1', showIf: ex('rhythm'),
      choices: [['1', 'One pad'], ['2', 'Kick and snare'], ['3', 'Kick, snare, hi-hat'], ['4', 'Kick, snare, hi-hat, tom'], ['6', 'Six pads']],
    },
    { id: 'combos', label: 'Two pads at once', type: 'checkbox', default: false, showIf: (v) => v.exercise === 'rhythm' && v.pads !== '1' },
    {
      id: 'lanes', label: 'Kit', type: 'select', default: '3', showIf: ex('groove'),
      choices: [['2', 'Kick and snare'], ['3', '+ hi-hat'], ['4', '+ open hi-hat'], ['5', 'Full kit (toms, crash)']],
    },
    {
      id: 'feel', label: 'Hi-hat', type: 'select', default: 'eighth', showIf: ex('groove'),
      choices: [['quarter', 'Quarter notes'], ['eighth', 'Eighth notes'], ['sixteenth', 'Sixteenth notes'], ['shuffle', 'Shuffle']],
    },
    {
      id: 'kick', label: 'Kick', type: 'select', default: 'simple', showIf: ex('groove'),
      choices: [['simple', 'On the beats'], ['eighth', 'Off-beats too'], ['sixteenth', 'Syncopated 16ths']],
    },
    { id: 'ghost', label: 'Ghost notes', type: 'checkbox', default: false, showIf: ex('groove') },
    { id: 'fills', label: 'Fills', type: 'checkbox', default: false, showIf: ex('groove') },
    { id: 'ratio', label: 'Polyrhythm', type: 'select', default: '3:2', showIf: ex('poly'), choices: Object.entries(POLYRHYTHMS).map(([id, p]) => [id, p.label]) },
    {
      id: 'echoStyle', label: 'Played on', type: 'select', default: 'one', showIf: ex('echo'),
      choices: [['one', 'One pad'], ['two', 'Kick and snare'], ['groove', 'Kick, snare, hi-hat']],
    },
    { id: 'pairs', label: 'Calls', type: 'select', default: '4', showIf: ex('echo'), choices: [['2', '2'], ['4', '4'], ['8', '8']] },
    { id: 'anyPad', label: 'Any pad counts', type: 'checkbox', default: true, showIf: (v) => (v.exercise === 'rhythm' && v.pads === '1') || (v.exercise === 'echo' && v.echoStyle === 'one') },
    { id: 'padSet', label: 'Pads', type: 'select', default: '8', showIf: ex('pads'), choices: [['4', 'Bottom row (4)'], ['8', 'Two rows (8)'], ['16', 'All 16']] },
    { id: 'combo', label: 'At once', type: 'select', default: '1', showIf: ex('pads'), choices: [['1', 'One pad'], ['2', 'Up to 2 pads'], ['3', 'Up to 3 pads']] },
    { id: 'cue', label: 'Shown as', type: 'select', default: 'light', showIf: ex('pads'), choices: [['light', 'Lit pads'], ['name', 'Names only']] },
    { id: 'length', label: 'Length', type: 'select', default: '24', showIf: ex('pads'), choices: [['12', '12'], ['24', '24'], ['48', '48']] },
    { id: 'accents', label: 'Dynamics (accents)', type: 'checkbox', default: false, showIf: ex('rhythm', 'groove') },
    { id: 'mode', label: 'Mode', type: 'select', default: 'tempo', showIf: stepCapable, choices: [['tempo', 'Fixed tempo'], ['step', 'Step by step (free tempo)']] },
    {
      id: 'reps', label: 'Repeats', type: 'select', default: '2', showIf: (v) => v.exercise !== 'pads' && !(stepCapable(v) && v.mode === 'step'),
      choices: [['1', '1'], ['2', '2'], ['4', '4'], ['8', '8']],
    },
    {
      id: 'ramp', label: 'Speed up', type: 'select', default: '0', showIf: (v) => v.exercise !== 'pads' && !(stepCapable(v) && v.mode === 'step'),
      choices: [['0', 'No'], ['2', '+2 BPM per repeat'], ['5', '+5 BPM per repeat'], ['10', '+10 BPM per repeat']],
    },
    { id: 'countIn', label: 'Count-in bar', type: 'checkbox', default: true, showIf: (v) => v.exercise !== 'pads' },
    {
      id: 'tolerance', label: 'Timing window', type: 'select', default: '150', showIf: (v) => v.exercise !== 'pads',
      choices: [['250', 'Relaxed (±250 ms)'], ['150', 'Normal (±150 ms)'], ['80', 'Strict (±80 ms)'], ['50', 'Tight (±50 ms)']],
    },
    {
      id: 'accentVel', label: 'Accent from velocity', type: 'select', default: '100', showIf: (v) => v.exercise === 'levels' || v.accents,
      choices: [['80', '80'], ['100', '100'], ['115', '115']],
    },
    { id: 'sounds', label: 'Pad sounds', type: 'checkbox', default: true },
];

/** Whether an option can show for an exercise: with the defaults, or with any one other option changed. */
function relevant(opt, exercise) {
  if (!opt.showIf) return true;
  const base = { ...Object.fromEntries(RHYTHM_OPTIONS.map((o) => [o.id, o.default])), exercise };
  const variants = [base];
  for (const o of RHYTHM_OPTIONS) {
    const values = o.type === 'checkbox' ? [false, true] : o.choices.map(([v]) => v);
    for (const value of values) variants.push({ ...base, [o.id]: value });
  }
  return variants.some((v) => opt.showIf(v));
}

/** A drum tab (panel) for one exercise. */
function drumTab(exercise, id, label, description) {
  const options = RHYTHM_OPTIONS.filter((o) => relevant(o, exercise))
    .map((o) => (o.showIf ? { ...o, showIf: (v) => o.showIf({ ...v, exercise }) } : o));
  return {
    id, label, description, instrument: 'drums', kind: 'panel', exercise, options,
    create: (ctx) => new RhythmTrainer(ctx, exercise, options),
  };
}

export const drumCoursePanel = drumTab('levels', 'drum-course', 'Course',
  'Levels from quarter notes to fills, odd meters and polyrhythms. Pass a level with 90% to move on.');
export const padFinderPanel = drumTab('pads', 'drum-pads', 'Pad finder', 'Learn the pad grid: hit the lit or named pads, alone or together.');
export const drumRhythmsPanel = drumTab('rhythm', 'drum-rhythms', 'Rhythms', 'Read and play rhythms on one or more pads, in any meter.');
export const drumGroovesPanel = drumTab('groove', 'drum-grooves', 'Grooves', 'Drum beats from kick and snare to a full kit, with ghost notes and fills.');
export const polyrhythmPanel = drumTab('poly', 'drum-poly', 'Polyrhythms', 'Two rhythms at once: 3 against 2, 4 against 3 and more.');
export const callResponsePanel = drumTab('echo', 'drum-echo', 'Call and response', 'Listen to a bar, then play it back.');
export const DRUM_TABS = [drumCoursePanel, padFinderPanel, drumRhythmsPanel, drumGroovesPanel, polyrhythmPanel, callResponsePanel];

function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function loadStore(storage) {
  try {
    const d = JSON.parse(storage?.getItem(RHYTHM_STORE_KEY) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

class RhythmTrainer {
  constructor(ctx, exercise, options) {
    this.ctx = ctx;
    this.exercise = exercise;
    this.values = ctx.values || {};
    for (const o of options) if (!(o.id in this.values)) this.values[o.id] = o.default;
    this.storage = safeStorage();
    this.store = loadStore(this.storage);
    this.store.best ||= {};
    this.store.level = Math.max(0, Math.min(LEVELS.length - 1, this.store.level | 0));
    this.padMap = Array.isArray(this.store.padMap) && this.store.padMap.length === 16 ? this.store.padMap : defaultPadMap();
    this.metronome = this.store.metronome !== false;
    this.rng = (ctx.makeRng || makeRng)();
    this.playsSound = true; // main.js: pads make their own sound, don't also play the piano synth
    this.state = 'idle'; // idle | countin | running | step | listening | learning
    this.timers = new Set();
    this.marks = new Map(); // note id -> { cls, tick }
    this.wrongs = []; // [{ rep, tick, pad }]
    this.dyn = { ok: 0, total: 0 };
    this.onKey = (e) => this.keydown(e);
    window.addEventListener('keydown', this.onKey);
    this.build();
    this.resize = new ResizeObserver(() => this.renderGrid());
    this.resize.observe(this.el.grid);
    this.newPattern();
  }

  get isLevels() { return this.exercise === 'levels'; }
  /** Option values with the tab's exercise. */
  get opts() { return { ...this.values, exercise: this.exercise }; }
  get level() { return LEVELS[this.store.level]; }
  get spec() { return this.isLevels ? this.level.spec : specFromOptions(this.opts); }
  get stepMode() { return this.pattern?.kind === 'pads' || (!this.isLevels && stepCapable(this.opts) && this.values.mode === 'step'); }
  get tolerance() { return (+this.values.tolerance || 150) / 1000; }
  get accentVel() { return +this.values.accentVel || 100; }
  get bpm() { return Math.max(20, Math.min(300, +(this.ctx.getBpm?.() ?? 80) || 80)); }

  save() {
    this.store.padMap = this.padMap;
    this.store.metronome = this.metronome;
    try { this.storage?.setItem(RHYTHM_STORE_KEY, JSON.stringify(this.store)); } catch { /* quota or private mode */ }
  }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, Math.max(0, ms));
    this.timers.add(t);
  }

  // ------------------------------------------------------------ panel contract

  onOptions(values) {
    this.values = values;
    this.newPattern();
  }

  onTempo() {
    this.renderTempo();
  }

  next() {
    if (this.state === 'learning') return;
    this.newPattern();
  }

  transport(action) {
    if (this.state === 'learning') return false;
    if (action === 'play') this.start();
    else if (action === 'stop') this.stop('Stopped.');
    else if (action === 'forward') this.newPattern();
    else if (action === 'back') this.start();
    else if (action === 'listen') this.listen();
    else if (action === 'metronome') this.toggleMetronome();
    else return false;
    return true;
  }

  destroy() {
    this.stop();
    window.removeEventListener('keydown', this.onKey);
    this.resize.disconnect();
    this.ctx.container.innerHTML = '';
  }

  // ------------------------------------------------------------ DOM

  build() {
    const el = (this.el = {});
    el.levelSel = h('select', { class: 'rh-level-select', onchange: () => this.setLevel(+el.levelSel.value) });
    el.levelInfo = h('div', { class: 'tr-sub rh-level-info' });
    el.levelBar = h('div', { class: 'rh-levels' },
      h('button', { class: 'tr-btn', title: 'Previous level', onclick: () => this.setLevel(this.store.level - 1) }, '‹'),
      el.levelSel,
      h('button', { class: 'tr-btn', title: 'Next level', onclick: () => this.setLevel(this.store.level + 1) }, '›'));

    el.start = h('button', { class: 'tr-btn primary', onclick: () => (this.state === 'idle' ? this.start() : this.stop('Stopped.')), title: 'Space' }, '▶ Start');
    el.listen = h('button', { class: 'tr-btn', onclick: () => this.listen(), title: 'L' }, '♪ Listen');
    el.newBtn = h('button', { class: 'tr-btn', onclick: () => this.newPattern(), title: 'N' }, 'New pattern');
    el.bpm = h('input', { type: 'number', min: 20, max: 300, class: 'rh-bpm', onchange: () => this.ctx.setBpm?.(+el.bpm.value) });
    el.metro = h('input', { type: 'checkbox', onchange: () => this.toggleMetronome(el.metro.checked) });
    el.controls = h('div', { class: 'rh-controls' },
      el.start, el.listen, el.newBtn,
      h('span', { class: 'rh-tempo' },
        h('button', { class: 'tr-btn rh-small', onclick: () => this.ctx.setBpm?.(this.bpm - 5), title: '−5 BPM' }, '−'),
        h('span', {}, '♩ ='), el.bpm,
        h('button', { class: 'tr-btn rh-small', onclick: () => this.ctx.setBpm?.(this.bpm + 5), title: '+5 BPM' }, '+')),
      h('label', { class: 'check rh-metro' }, el.metro, 'Metronome'));

    el.stats = h('div', { class: 'tr-stats' });
    el.feedback = h('div', { class: 'tr-feedback', role: 'status' });
    el.prompt = h('div', { class: 'tr-card rh-prompt' });
    el.grid = h('div', { class: 'rh-grid' });

    el.pads = h('div', { class: 'rh-pads', role: 'group', 'aria-label': 'Drum pads' });
    el.padEls = [];
    for (const row of PAD_ROWS) {
      for (const i of row) {
        const b = h('button', {
          class: `rh-pad g-${PADS[i].group}`,
          'data-pad': i,
          onpointerdown: (e) => { e.preventDefault(); this.hitPad(i, performance.now(), e.shiftKey ? 125 : 90); },
        }, h('b', {}, PADS[i].short), h('small', {}));
        el.padEls[i] = b;
        el.pads.append(b);
      }
    }
    el.mapInfo = h('div', { class: 'muted rh-map-info' });
    el.learn = h('button', { class: 'tr-btn', onclick: () => (this.state === 'learning' ? this.endLearn(false) : this.startLearn()) }, 'Learn pads');
    el.skip = h('button', { class: 'tr-btn', onclick: () => this.learnNext(null), hidden: true }, 'Skip pad');
    el.resetMap = h('button', { class: 'tr-btn', onclick: () => { this.padMap = defaultPadMap(); this.save(); this.renderPads(); } }, 'Default notes');
    el.padSide = h('div', { class: 'rh-pad-side' },
      h('div', { class: 'tr-row-title' }, 'Pads'),
      el.mapInfo,
      h('div', { class: 'rh-map-buttons' }, el.learn, el.skip, el.resetMap),
      h('div', { class: 'muted' }, 'Keyboard: 1 2 3 4 / Q W E R / A S D F / Z X C V (Shift = accent) when QWERTY is off. Space starts and stops, L listens.'));
    el.padArea = h('div', { class: 'rh-pad-area' }, el.pads, el.padSide);
    el.summary = h('div', { class: 'tr-summary', hidden: true });

    this.ctx.container.innerHTML = '';
    this.ctx.container.append(h('div', { class: 'trainer rhythm' },
      el.levelBar, el.levelInfo, el.controls, el.stats, el.feedback, el.prompt, el.grid, el.padArea, el.summary));
    this.renderTempo();
    this.renderPads();
  }

  renderTempo() {
    this.el.bpm.value = this.bpm;
    this.el.metro.checked = this.metronome;
  }

  renderLevels() {
    const { el } = this;
    el.levelBar.hidden = !this.isLevels;
    el.levelInfo.hidden = !this.isLevels;
    if (!this.isLevels) return;
    el.levelSel.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const best = this.store.best[i];
      el.levelSel.add(new Option(`${i + 1}. ${lv.name}${best != null && best >= PASS_PCT ? '  ✓' : ''}`, i));
    });
    el.levelSel.value = this.store.level;
    const best = this.store.best[this.store.level];
    el.levelInfo.textContent = `${this.level.info} Pass with ${PASS_PCT}% or more.${best != null ? ` Best so far: ${best}%.` : ''}`;
  }

  setLevel(i) {
    if (i < 0 || i >= LEVELS.length) return;
    this.store.level = i;
    this.save();
    this.newPattern();
  }

  toggleMetronome(on = !this.metronome) {
    this.metronome = on;
    this.save();
    this.renderTempo();
  }

  renderPads() {
    const used = new Set(this.pattern?.lanes || []);
    const any = this.pattern?.anyPad;
    const qwerty = this.ctx.qwerty?.();
    this.el.padEls.forEach((b, i) => {
      const m = this.padMap[i];
      b.querySelector('small').textContent = [qwerty ? null : PAD_KEYS[i].toUpperCase(), m ? m.note : '–'].filter((x) => x != null).join(' · ');
      b.title = `Pad ${i + 1}: ${PADS[i].name}${m ? ` (note ${m.note} ${noteName(m.note)}${m.channel != null ? `, channel ${m.channel + 1}` : ''})` : ' (not assigned)'}`;
      b.classList.toggle('used', any || used.has(i));
    });
    const notes = this.padMap.map((m) => m?.note);
    const isDefault = this.padMap.every((m, i) => m && m.note === 36 + i && m.channel == null);
    const channels = [...new Set(this.padMap.filter((m) => m && m.channel != null).map((m) => m.channel + 1))];
    this.el.mapInfo.textContent = isDefault
      ? 'Pad 1 = note 36 (C1 on Akai keyboards) up to pad 16 = note 51, the factory setting of bank A on Akai MPK pads.'
      : `Learned notes ${notes.filter((n) => n != null).join(', ')}${channels.length ? ` on channel ${channels.join(', ')}` : ''}.`;
  }

  // ------------------------------------------------------------ patterns

  newPattern() {
    this.stop();
    this.hideSummary();
    try {
      this.pattern = makePattern(this.spec, this.rng);
    } catch (err) {
      console.error(err);
      this.setFeedback(`Could not create a pattern: ${err.message}`, 'bad');
      return;
    }
    this.marks.clear();
    this.wrongs = [];
    this.repShown = 0;
    this.renderLevels();
    this.renderPads();
    this.renderStats(null);
    this.renderGrid();
    this.el.listen.hidden = this.pattern.kind === 'pads';
    this.el.start.hidden = this.pattern.kind === 'pads';
    if (this.stepMode) this.startStep();
    else {
      this.setFeedback('');
      this.ctx.setStatus?.(`${this.title()} — press Start (Space) for the count-in.`);
    }
  }

  title() {
    if (this.isLevels) return `Level ${this.store.level + 1}: ${this.level.name}`;
    const p = this.pattern;
    const meters = [...new Set(p.bars.map((b) => b.meter))].join(', ');
    const what = { pads: 'Pad finder', rhythm: 'Rhythm', groove: 'Groove', poly: p.title || 'Polyrhythm', echo: 'Call and response' }[p.kind];
    return p.kind === 'pads' ? what : `${what} in ${meters}`;
  }

  // ------------------------------------------------------------ grid

  renderGrid() {
    const p = this.pattern;
    const { grid, prompt } = this.el;
    if (!p) return;
    grid.hidden = p.kind === 'pads';
    prompt.hidden = p.kind !== 'pads';
    if (p.kind === 'pads') {
      this.renderPrompt();
      return;
    }
    const W = Math.max(280, grid.clientWidth || 760);
    const labelW = W < 500 ? 52 : 78;
    const pad = 12;
    const laneH = W < 500 ? 22 : 26;
    const lanes = p.lanes;
    const maxTicks = Math.max(...p.bars.map((b) => b.len), W >= 700 ? 8 * TPQ : 4 * TPQ);
    const ppt = (W - labelW - 2 * pad) / maxTicks;
    // Pack bars into lines.
    const lines = [];
    for (const bar of p.bars) {
      const line = lines[lines.length - 1];
      if (line && bar.start + bar.len - line.start <= maxTicks) { line.bars.push(bar); line.end = bar.start + bar.len; } else lines.push({ start: bar.start, end: bar.start + bar.len, bars: [bar] });
    }
    const top = 18;
    const countH = 18;
    const lineH = top + lanes.length * laneH + countH;
    const gap = 12;
    const H = lines.length * (lineH + gap);
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'rh-svg' });
    const x0 = labelW + pad;
    const laneOf = (pd) => (p.anyPad ? 0 : lanes.indexOf(pd));
    const geo = { lines, ppt, x0, top, laneH, lineH, gap, labelW, W };
    const r = Math.max(4, Math.min(9, ppt * 3 * 0.42));
    this.noteEls = [];

    lines.forEach((line, li) => {
      const y0 = li * (lineH + gap);
      line.y0 = y0;
      const g = svg('g');
      root.append(g);
      const width = (line.end - line.start) * ppt;
      lanes.forEach((pd, k) => {
        const y = y0 + top + k * laneH;
        g.append(svg('rect', { x: labelW, y, width: width + 2 * pad, height: laneH, class: `rh-lane ${k % 2 ? 'odd' : ''}` }));
        const label = p.anyPad ? 'Any pad' : PADS[pd].short;
        g.append(svg('circle', { cx: 8, cy: y + laneH / 2, r: 4, class: `rh-dot g-${PADS[pd].group}` }));
        g.append(svg('text', { x: 16, y: y + laneH / 2 + 4, class: 'rh-lane-label' }, label));
      });
      const yTop = y0 + top;
      const yBottom = yTop + lanes.length * laneH;
      for (const bar of line.bars) {
        const bx = x0 + (bar.start - line.start) * ppt;
        for (const c of countLabels(p, bar)) {
          const x = x0 + (c.tick - line.start) * ppt;
          g.append(svg('line', { x1: x, x2: x, y1: yTop, y2: yBottom, class: c.beat ? 'rh-beat' : 'rh-sub' }));
          if (c.label) g.append(svg('text', { x, y: yBottom + 13, class: `rh-count ${c.beat ? 'beat' : ''}` }, c.label));
        }
        g.append(svg('line', { x1: bx - pad / 2, x2: bx - pad / 2, y1: yTop - 4, y2: yBottom, class: 'rh-barline' }));
        const prev = p.bars[p.bars.indexOf(bar) - 1];
        const tags = [];
        if (!prev || prev.meter !== bar.meter) tags.push(bar.meter);
        if (p.kind === 'echo') tags.push(p.notes.some((n) => n.demo && n.tick >= bar.start && n.tick < bar.start + bar.len) ? 'Listen' : 'Your turn');
        if (tags.length) g.append(svg('text', { x: bx - pad / 2 + 4, y: y0 + top - 5, class: 'rh-meter' }, tags.join(' · ')));
      }
      const endX = x0 + width - pad / 2 + pad;
      g.append(svg('line', { x1: endX, x2: endX, y1: yTop - 4, y2: yBottom, class: 'rh-barline' }));
    });

    // The step cursor goes above the lanes and below the notes.
    this.cursorEl = svg('rect', { class: 'rh-step', width: Math.max(10, 2 * r + 6), height: lanes.length * laneH, rx: 4, visibility: 'hidden' });
    root.append(this.cursorEl);
    p.notes.forEach((n, i) => {
      const li = lines.findIndex((l) => n.tick >= l.start && n.tick < l.end);
      const line = lines[li];
      const x = x0 + (n.tick - line.start) * ppt;
      const y = line.y0 + top + laneOf(n.pad) * laneH + laneH / 2;
      const cls = ['rh-note', `g-${PADS[n.pad].group}`, n.ghost ? 'ghost' : '', n.demo ? 'demo' : '', n.hidden ? 'hidden' : ''].join(' ');
      const g = svg('g', { class: cls });
      g.append(svg('circle', { cx: x, cy: y, r: n.ghost ? r * 0.62 : r }));
      if (n.accent) g.append(svg('text', { x: x + r + 1, y: y - r + 3, class: 'rh-accent' }, '>'));
      root.append(g);
      this.noteEls[i] = g;
    });
    this.markLayer = svg('g');
    this.playhead = svg('line', { class: 'rh-playhead', visibility: 'hidden' });
    root.append(this.markLayer, this.playhead);
    this.geo = { ...geo, laneOf, r };
    grid.innerHTML = '';
    grid.append(root);
    this.applyMarks();
    if (this.state === 'step') this.showStep();
  }

  /** Grid position of a tick: { x, y (top of the lanes), line }. */
  at(tick) {
    const { lines, ppt, x0, top } = this.geo;
    const line = lines.find((l) => tick >= l.start && tick < l.end) || lines[lines.length - 1];
    return { x: x0 + (Math.min(tick, line.end) - line.start) * ppt, y: line.y0 + top, line };
  }

  drawPlayhead(tick) {
    if (!this.playhead || !this.geo) return;
    if (tick == null) { this.playhead.setAttribute('visibility', 'hidden'); return; }
    const { x, y } = this.at(tick);
    const h2 = this.pattern.lanes.length * this.geo.laneH;
    Object.entries({ x1: x, x2: x, y1: y - 6, y2: y + h2 + 4, visibility: 'visible' }).forEach(([k, v]) => this.playhead.setAttribute(k, v));
  }

  applyMarks() {
    if (!this.noteEls || !this.geo) return;
    this.noteEls.forEach((g) => g.classList.remove('good', 'loose', 'miss', 'dyn-bad', 'shown'));
    this.markLayer.innerHTML = '';
    const { laneOf, laneH } = this.geo;
    for (const [id, m] of this.marks) {
      const [rep, idx] = id.split(':').map(Number);
      if (rep !== this.repShown) continue;
      const g = this.noteEls[idx];
      g?.classList.add(m.cls, 'shown');
      if (m.dynBad) g?.classList.add('dyn-bad');
      if (m.tick != null) {
        // Where the hit actually landed, as a short tick in the lane.
        const n = this.pattern.notes[idx];
        const { x, y } = this.at(m.tick);
        const yy = y + laneOf(n.pad) * laneH;
        this.markLayer.append(svg('line', { x1: x, x2: x, y1: yy + 3, y2: yy + laneH - 3, class: `rh-hitmark ${m.cls}` }));
      }
    }
    for (const w of this.wrongs) {
      if (w.rep !== this.repShown) continue;
      const lane = this.pattern.anyPad ? 0 : laneOf(w.pad);
      const { x, y } = this.at(w.tick);
      const yy = lane >= 0 ? y + lane * laneH + laneH / 2 : y - 4;
      this.markLayer.append(svg('text', { x, y: yy + 4, class: 'rh-wrong' }, '×'));
    }
  }

  mark(id, m) {
    this.marks.set(id, m);
    if (+id.split(':')[0] === this.repShown) this.applyMarks();
  }

  // ------------------------------------------------------------ pad finder prompt

  renderPrompt() {
    const { prompt } = this.el;
    prompt.innerHTML = '';
    const step = this.matcher?.currentStep;
    const total = this.matcher?.steps.length || 0;
    const index = this.matcher ? Math.min(this.matcher.index + 1, total) : 0;
    const pads = step ? [...new Set(step.notes.map((n) => n.midi))] : [];
    prompt.append(
      h('div', { class: 'tr-prompt-label' }, this.matcher?.finished ? 'Done' : `Pad ${index} of ${total}`),
      h('div', { class: 'tr-chord-name words' }, this.matcher?.finished ? '✓' : pads.map((pd) => PADS[pd].name).join(' + ')),
      h('div', { class: 'tr-sub' }, this.pattern.cue === 'name' ? 'Find the pads by name.' : pads.length > 1 ? 'Hit the lit pads together.' : 'Hit the lit pad.'),
    );
  }

  // ------------------------------------------------------------ stats

  renderStats(s) {
    const chip = (label, value, cls = '') => h('div', { class: `tr-chip ${cls}` }, h('span', {}, label), h('b', {}, value));
    this.el.stats.innerHTML = '';
    if (!s) return;
    const attempts = s.hits + s.wrong + s.missed;
    const chips = [chip('Accuracy', attempts ? `${Math.round((100 * s.hits) / attempts)}%` : '–'), chip('Hits', s.hits, 'good'), chip('Wrong', s.wrong, s.wrong ? 'bad' : '')];
    if (this.matcher?.mode === 'tempo') {
      chips.push(chip('Missed', s.missed, s.missed ? 'warn' : ''));
      const offs = s.offsets;
      if (offs.length) {
        const mean = Math.round((1000 * offs.reduce((a, b) => a + b, 0)) / offs.length);
        chips.push(chip('Timing', `${mean > 0 ? '+' : ''}${mean} ms`, Math.abs(mean) > 30 ? 'warn' : ''));
      }
    }
    if (this.dyn.total) chips.push(chip('Dynamics', `${Math.round((100 * this.dyn.ok) / this.dyn.total)}%`));
    if (this.reaction?.length) chips.push(chip('Reaction', `${Math.round(this.reaction.reduce((a, b) => a + b, 0) / this.reaction.length)} ms`));
    this.el.stats.append(...chips);
  }

  setFeedback(text, cls = '') {
    this.el.feedback.textContent = text;
    this.el.feedback.className = `tr-feedback ${cls}`;
  }

  // ------------------------------------------------------------ sound and pads

  sound(pad, time, velocity) {
    if (this.values.sounds === false) return;
    const audio = this.ctx.audio;
    if (!audio) return;
    const ac = audio.ensure();
    playDrum(ac, audio.master, PADS[pad].sound, time ?? ac.currentTime, velocity);
  }

  flashPad(pad, cls = 'hit', ms = 110) {
    const b = this.el.padEls[pad];
    if (!b) return;
    b.classList.remove(cls);
    void b.offsetWidth; // restart the animation
    b.classList.add(cls);
    this.later(() => b.classList.remove(cls), ms);
  }

  cuePads(pads) {
    this.el.padEls.forEach((b, i) => b.classList.toggle('cue', pads.includes(i)));
  }

  // ------------------------------------------------------------ input

  keydown(e) {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.state === 'idle') this.start(); else if (this.state !== 'learning') this.stop('Stopped.');
      return;
    }
    if (e.key === 'Escape') { if (this.state === 'learning') this.endLearn(false); else this.stop('Stopped.'); return; }
    if (this.ctx.qwerty?.()) return; // the computer keyboard is a piano: no pad keys
    const pad = PAD_CODES.indexOf(e.code);
    if (pad >= 0) {
      e.preventDefault();
      if (!e.repeat) this.hitPad(pad, performance.now(), e.shiftKey ? 125 : 80);
    } else if (e.key === 'l' || e.key === 'L') this.listen();
    else if (e.key === 'Enter') this.el.summary.querySelector('.primary')?.click();
  }

  noteOn(midi, time, velocity, source, channel) {
    if (this.state === 'learning') {
      if (source === 'midi') this.learnNext({ note: midi, channel: channel ?? null });
      return;
    }
    const pad = padOf(this.padMap, midi, source === 'midi' ? channel : null);
    if (pad < 0) {
      if (source === 'midi') this.ctx.setStatus?.(`Note ${midi} (${noteName(midi)}) is not one of your pads. Press “Learn pads” to set them up.`);
      return;
    }
    this.hitPad(pad, time ?? performance.now(), velocity ?? 90);
  }

  hitPad(pad, time, velocity) {
    if (this.state === 'learning') return;
    this.ctx.audio?.ensure();
    this.sound(pad, null, velocity);
    this.flashPad(pad);
    if (!this.matcher || this.matcher.finished || this.state === 'listening') return;
    const key = this.pattern.anyPad ? 0 : pad;
    if (this.state === 'step') {
      this.velocity = velocity;
      this.handle(this.matcher.noteOn(key), { pad });
    } else if (this.state === 'running' || this.state === 'countin') {
      const t = (time - this.startPerf - this.latency) / 1000;
      this.velocity = velocity;
      this.handle(this.matcher.noteOn(key, t), { pad, t });
    }
  }

  // ------------------------------------------------------------ fixed tempo

  start({ listen = false } = {}) {
    if (this.state === 'learning') return;
    if (this.stepMode && !listen) { this.startStep(); return; }
    this.stop();
    this.hideSummary();
    const audio = this.ctx.audio;
    const ac = audio.ensure();
    const v = this.values;
    const reps = listen ? 1 : +v.reps || 2;
    const run = buildRun(this.pattern, { bpm: this.bpm, reps, ramp: listen ? 0 : +v.ramp || 0, countIn: listen ? false : v.countIn !== false });
    this.run = run;
    this.latency = listen ? 0 : +(this.ctx.latencyMs?.() || 0);
    this.matcher = listen ? null : new Matcher(tempoSteps(run, { anyPad: this.pattern.anyPad }), { mode: 'tempo', secPerQuarter: 1, toleranceSec: this.tolerance });
    this.notesById = new Map(run.notes.map((n) => [n.id, n]));
    this.marks.clear();
    this.wrongs = [];
    this.dyn = { ok: 0, total: 0 };
    this.offsets = [];
    this.reaction = null;
    const lead = run.countIn.length ? -run.countIn[0].t : 0;
    const startAudio = ac.currentTime + 0.15 + lead;
    const ts = ac.getOutputTimestamp?.();
    this.startPerf = ts && ts.performanceTime ? ts.performanceTime + (startAudio - ts.contextTime) * 1000 : performance.now() + (startAudio - ac.currentTime) * 1000;
    const events = [];
    for (const c of run.countIn) events.push({ time: startAudio + c.t, accent: c.accent });
    for (const c of run.clicks) events.push({ time: startAudio + c.t, click: false, onTime: (t) => this.metronome && audio.click(t, c.accent) });
    for (const n of run.notes) {
      if (!listen && !n.demo) continue;
      events.push({
        time: startAudio + n.at, click: false,
        onTime: (t) => {
          this.sound(n.pad, t, n.accent ? 120 : n.soft ? 60 : 90);
          this.later(() => this.flashPad(n.pad, 'demo', 150), (t - ac.currentTime) * 1000);
        },
      });
    }
    events.sort((a, b) => a.time - b.time);
    audio.startClicks(events[Symbol.iterator]());
    this.state = listen ? 'listening' : run.countIn.length ? 'countin' : 'running';
    this.repShown = 0;
    this.applyMarks();
    this.renderStats(listen ? null : this.matcher.stats);
    this.setFeedback(listen ? '' : run.countIn.length ? 'Count-in…' : 'Go!');
    this.el.start.textContent = '■ Stop';
    this.ctx.setStatus?.(listen ? `Listening — ♩ = ${run.reps[0].bpm}` : `${this.title()} — ♩ = ${run.reps[0].bpm}`);
    this.cuePads([]);
    const loop = () => {
      if (this.state !== 'countin' && this.state !== 'running' && this.state !== 'listening') return;
      const t = (performance.now() - this.startPerf) / 1000;
      if (this.state === 'countin' && t >= 0) {
        this.state = 'running';
        this.setFeedback('');
      }
      const pos = positionAt(run, t);
      if (pos && pos.rep !== this.repShown) {
        this.repShown = pos.rep;
        this.applyMarks();
        const r = run.reps[pos.rep];
        this.ctx.setStatus?.(`${this.title()} — repeat ${pos.rep + 1} of ${run.reps.length}, ♩ = ${r.bpm}`);
      }
      this.drawPlayhead(pos && pos.tick <= this.pattern.length ? pos.tick : null);
      if (this.matcher) this.handle(this.matcher.tick(t - this.latency / 1000), {});
      else if (t > run.end + 0.3) { this.stop('Finished listening.'); return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  listen() {
    if (this.state === 'listening') { this.stop(); return; }
    if (this.pattern?.kind === 'pads' || this.state === 'learning') return;
    this.start({ listen: true });
  }

  stop(message) {
    cancelAnimationFrame(this.raf);
    this.ctx.audio?.stopClicks();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const was = this.state;
    if (was !== 'learning') this.state = 'idle';
    this.drawPlayhead(null);
    this.el.start.textContent = '▶ Start';
    this.el.padEls.forEach((b) => b.classList.remove('hit', 'demo', 'wrong'));
    if (this.cursorEl) this.cursorEl.setAttribute('visibility', 'hidden');
    if (message && (was === 'running' || was === 'countin' || was === 'listening' || was === 'step')) {
      this.ctx.setStatus?.(message);
      if (was !== 'listening') this.setFeedback('');
    }
  }

  // ------------------------------------------------------------ step by step

  startStep() {
    this.stop();
    this.hideSummary();
    this.matcher = new Matcher(waitSteps(this.pattern, { anyPad: this.pattern.anyPad }), { mode: 'wait' });
    this.notesById = new Map(this.pattern.notes.map((n, i) => [`0:${i}`, { ...n, idx: i, rep: 0 }]));
    this.marks.clear();
    this.wrongs = [];
    this.dyn = { ok: 0, total: 0 };
    this.offsets = [];
    this.reaction = [];
    this.repShown = 0;
    this.state = 'step';
    this.stepShown = performance.now();
    this.applyMarks();
    this.renderStats(null);
    this.showStep();
    this.setFeedback('');
    this.ctx.setStatus?.(this.pattern.kind === 'pads' ? `${this.title()} — hit the pads at your own pace.` : `${this.title()} — step by step: play each highlighted beat at your own pace.`);
  }

  showStep() {
    const step = this.matcher?.currentStep;
    const pads = step && !this.matcher.finished ? [...new Set(step.notes.map((n) => this.notesById.get(n.ids?.[0] ?? n.id)?.pad))] : [];
    const cueLight = this.pattern.kind !== 'pads' || this.pattern.cue !== 'name';
    this.cuePads(cueLight ? pads.filter((p) => p != null) : []);
    if (this.pattern.kind === 'pads') { this.renderPrompt(); return; }
    if (!this.cursorEl || !step || this.matcher.finished) { this.cursorEl?.setAttribute('visibility', 'hidden'); return; }
    const { x, y } = this.at(step.tick);
    const w = +this.cursorEl.getAttribute('width');
    this.cursorEl.setAttribute('x', x - w / 2);
    this.cursorEl.setAttribute('y', y);
    this.cursorEl.setAttribute('visibility', 'visible');
  }

  // ------------------------------------------------------------ results

  /** Matcher events -> marks, feedback and stats. info: { pad, t } of the played note. */
  handle(events, info = {}) {
    if (!events.length) return;
    const tempo = this.matcher.mode === 'tempo';
    for (const e of events) {
      if (e.type === 'hit') {
        const ids = e.note.ids || [e.note.id];
        const cls = tempo ? timingClass(e.offset, this.tolerance) : 'good';
        for (const id of ids) {
          const n = this.notesById.get(id);
          if (!n) continue;
          let dynBad = false;
          if (this.pattern.accents && hasDynamics(n)) {
            this.dyn.total++;
            if (dynamicsOk(n, this.velocity, this.accentVel)) this.dyn.ok++; else dynBad = true;
          }
          const rep = tempo ? this.run.reps[n.rep] : null;
          this.mark(id, { cls, dynBad, tick: tempo ? this.pattern.notes[n.idx].tick + e.offset / rep.spt : null });
          if (tempo) this.offsets.push({ pad: n.pad, off: e.offset });
          if (dynBad) this.setFeedback(n.accent ? 'Accent: hit harder.' : 'Softer: that note is not accented.', 'warn');
        }
      } else if (e.type === 'miss') {
        for (const id of e.note.ids || [e.note.id]) this.mark(id, { cls: 'miss' });
      } else if (e.type === 'wrong') {
        if (info.pad != null) this.flashPad(info.pad, 'wrong', 220);
        if (tempo && info.t != null) {
          const pos = positionAt(this.run, info.t);
          if (pos) {
            this.wrongs.push({ rep: pos.rep, tick: pos.tick, pad: info.pad });
            if (pos.rep === this.repShown) this.applyMarks();
          }
        }
      } else if (e.type === 'step' && !tempo) {
        const now = performance.now();
        this.reaction?.push(now - this.stepShown);
        this.stepShown = now;
        this.showStep();
      } else if (e.type === 'done') {
        if (!tempo) this.reaction?.push(performance.now() - this.stepShown);
        this.renderStats(this.matcher.stats);
        this.finish();
        return;
      }
    }
    this.renderStats(this.matcher.stats);
  }

  finish() {
    const summary = this.matcher.summary();
    const tempo = this.matcher.mode === 'tempo';
    this.stop();
    if (!tempo) this.cuePads([]);
    if (this.pattern.kind === 'pads') this.renderPrompt();
    const accentAccuracy = this.dyn.total ? this.dyn.ok / this.dyn.total : null;
    const result = { ...summary, accentAccuracy };
    const acc = Math.round(summary.accuracy * 100);
    const attempts = summary.hits + summary.wrong + summary.missed;
    this.ctx.recordResult?.({ title: this.title(), correct: summary.hits, total: attempts });

    const rows = [['Hits', `${summary.hits} / ${summary.notes}`], ['Wrong pads', summary.wrong]];
    if (tempo) {
      rows.push(['Missed', summary.missed]);
      const m = summary.meanOffsetMs;
      rows.push(['Average timing', `${m > 0 ? '+' : ''}${m} ms ${m > 15 ? '(late)' : m < -15 ? '(early)' : ''}`]);
      rows.push(['Average deviation', `${summary.meanAbsOffsetMs} ms`]);
      for (const l of laneOffsets(this.offsets)) {
        if (this.pattern.lanes.length > 1 && l.n >= 3 && Math.abs(l.meanMs) > 20) rows.push([`${PADS[l.pad].name}`, `${l.meanMs > 0 ? '+' : ''}${l.meanMs} ms ${l.meanMs > 0 ? 'late' : 'early'}`]);
      }
    } else if (this.reaction?.length) {
      rows.push(['Average time per step', `${Math.round(this.reaction.reduce((a, b) => a + b, 0) / this.reaction.length)} ms`]);
    }
    if (accentAccuracy != null) rows.push(['Dynamics right', `${Math.round(accentAccuracy * 100)}%`]);
    rows.push(['Accuracy', `${acc}%`]);

    let heading = acc >= 95 ? 'Excellent!' : acc >= 80 ? 'Well done' : 'Keep practicing';
    const buttons = [h('button', { class: 'tr-btn', onclick: () => (this.stepMode ? this.startStep() : this.start()) }, 'Again')];
    if (this.isLevels) {
      const i = this.store.level;
      const passed = passes(result);
      this.store.best[i] = Math.max(this.store.best[i] ?? 0, acc);
      this.save();
      this.renderLevels();
      if (passed) {
        heading = i + 1 < LEVELS.length ? `Level ${i + 1} passed!` : 'Course complete!';
        if (i + 1 < LEVELS.length) buttons.push(h('button', { class: 'tr-btn primary', onclick: () => this.setLevel(i + 1) }, 'Next level ›'));
      } else {
        heading = `${acc}% — ${PASS_PCT}% passes this level`;
        if (accentAccuracy != null && accentAccuracy < PASS_ACCENTS && acc >= PASS_PCT) heading = `Watch the dynamics: ${Math.round(PASS_ACCENTS * 100)}% needed`;
        buttons.push(h('button', { class: 'tr-btn primary', onclick: () => this.newPattern() }, 'New pattern'));
      }
    } else {
      buttons.push(h('button', { class: 'tr-btn primary', onclick: () => this.newPattern() }, 'New pattern'));
    }
    if (tempo && acc >= PASS_PCT && !this.isLevels) rows.push(['Tip', 'Try it 5 BPM faster']);
    const box = this.el.summary;
    box.innerHTML = '';
    box.append(
      h('h3', {}, heading),
      h('table', {}, ...rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, String(b))))),
      h('div', { class: 'buttons' }, ...buttons),
    );
    box.hidden = false;
    this.setFeedback('');
    this.ctx.setStatus?.(`${this.title()} — ${acc}%. Enter: ${buttons[buttons.length - 1].textContent.replace(' ›', '')}.`);
  }

  hideSummary() {
    if (this.el?.summary) this.el.summary.hidden = true;
  }

  // ------------------------------------------------------------ learning the pads

  startLearn() {
    this.stop();
    this.state = 'learning';
    this.learning = { index: 0, map: this.padMap.map((m) => (m ? { ...m } : null)), used: [] };
    this.el.learn.textContent = 'Cancel';
    this.el.skip.hidden = false;
    this.showLearn();
  }

  showLearn() {
    const i = this.learning.index;
    this.el.padEls.forEach((b, k) => b.classList.toggle('learn', k === i));
    this.setFeedback(`Hit the pad you want as pad ${i + 1} (${PADS[i].name}), or Skip to keep its note.`, 'warn');
    this.ctx.setStatus?.(`Learning pads: ${i} of 16 done.`);
  }

  learnNext(entry) {
    const L = this.learning;
    if (!L) return;
    if (entry) {
      // One note per pad: a note already taken by a pad learned in this round is ignored.
      if (L.used.some((m) => m.note === entry.note && m.channel === entry.channel)) {
        this.setFeedback(`Note ${entry.note} is already used by another pad. Hit a different pad.`, 'bad');
        return;
      }
      // A note learned for this pad moves away from any other pad that had it.
      L.map.forEach((m, k) => { if (k !== L.index && m && m.note === entry.note && (m.channel == null || m.channel === entry.channel)) L.map[k] = null; });
      L.map[L.index] = entry;
      L.used.push(entry);
      this.sound(L.index, null, 100);
    } else if (L.map[L.index]) {
      L.used.push(L.map[L.index]);
    }
    L.index++;
    if (L.index >= 16) this.endLearn(true);
    else this.showLearn();
  }

  endLearn(keep) {
    if (keep && this.learning) {
      this.padMap = this.learning.map;
      this.save();
    }
    this.learning = null;
    this.state = 'idle';
    this.el.learn.textContent = 'Learn pads';
    this.el.skip.hidden = true;
    this.el.padEls.forEach((b) => b.classList.remove('learn'));
    this.renderPads();
    this.setFeedback(keep ? 'Pads saved.' : '', keep ? 'good' : '');
    this.ctx.setStatus?.('');
    if (this.stepMode) this.startStep();
  }
}
