// Chord trainer panel: play a named chord on the keyboard, or name a chord shown on the staff.
// Question generation and checking live in chord-logic.js; adaptive statistics in trainer-stats.js.

import { CHORD_TYPES, INVERSION_NAMES, prettyNote, inversionCount } from '../core/chords.js';
import { h, heldTracker, renderMiniScore } from './panel.js';
import {
  CHORD_SETS, KEY_CHOICES, chordSetChoices, makeChordQuestion, checkPlayedChord, checkNamedChord, describePlayed,
  evalThreshold, rootLabels, pickClef, chordScore, hintMidis,
} from './chord-logic.js';
import { ItemStats } from './trainer-stats.js';

export const CHORD_STATS_KEY = 'pianoPractice.chordStats.v1';
const STABLE_MS = 150;
const NEXT_DELAY = 900;
const NATURAL_KEYS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

const isPlay = (v) => v.mode !== 'name';
const isName = (v) => v.mode === 'name';

export const chordTrainerPanel = {
  id: 'chords',
  label: 'Chords',
  description: 'Chord names and inversions: play the chord shown, or name the chord on the staff.',
  instrument: 'piano',
  kind: 'panel',
  options: [
    { id: 'mode', label: 'Mode', type: 'select', choices: [['play', 'Play the chord'], ['name', 'Name the chord']], default: 'play' },
    {
      id: 'display', label: 'Show as', type: 'select', default: 'symbol', showIf: isPlay,
      choices: [['symbol', 'Symbol (E♭m7/G♭)'], ['words', 'Words (E♭ minor 7th…)']],
    },
    { id: 'chordSet', label: 'Chord set', type: 'select', choices: chordSetChoices(), default: 'majmin' },
    {
      id: 'roots', label: 'Roots', type: 'select', default: 'naturals',
      choices: [['naturals', 'Naturals only'], ['all', 'All 12'], ['key', 'Diatonic to a key']],
    },
    { id: 'key', label: 'Key', type: 'select', choices: KEY_CHOICES, default: 'C-major', showIf: (v) => v.roots === 'key' },
    {
      id: 'inversions', label: 'Inversions', type: 'select', default: 'root',
      choices: [['root', 'Root position only'], ['all', 'Include inversions'], ['inv', 'Inversions only']],
    },
    { id: 'requireBass', label: 'Bass must match the inversion', type: 'checkbox', default: true, showIf: isPlay },
    {
      id: 'voicing', label: 'Voicing', type: 'select', default: 'any', showIf: isPlay,
      choices: [['close', 'Close position'], ['any', 'Any (doublings, both hands)']],
    },
    {
      id: 'clef', label: 'Clef', type: 'select', default: 'treble', showIf: isName,
      choices: [['treble', 'Treble'], ['bass', 'Bass'], ['grand', 'Grand staff'], ['auto', 'Mixed']],
    },
    { id: 'playOnShow', label: 'Play the chord when shown', type: 'checkbox', default: false, showIf: isName },
    { id: 'length', label: 'Session length', type: 'select', choices: [['10', '10'], ['20', '20'], ['50', '50'], ['0', 'Endless']], default: '20' },
    { id: 'sound', label: 'Sound on answer', type: 'checkbox', default: true },
  ],
  create(ctx) {
    return new ChordTrainer(ctx);
  },
};

const itemLabel = (item) => {
  const [kind, id] = item.slice(item.indexOf('|') + 1).split(':');
  return kind === 'inv' ? INVERSION_NAMES[+id] : CHORD_TYPES[id]?.label || id;
};

class ChordTrainer {
  constructor(ctx) {
    this.ctx = ctx;
    this.values = ctx.values || {};
    for (const o of chordTrainerPanel.options) if (!(o.id in this.values)) this.values[o.id] = o.default;
    this.rng = ctx.makeRng ? ctx.makeRng() : null;
    this.stats = new ItemStats(CHORD_STATS_KEY);
    this.held = heldTracker();
    this.timers = new Set();
    this.onKey = (e) => this.keydown(e);
    window.addEventListener('keydown', this.onKey);
    this.build();
    this.startRound();
  }

  // ------------------------------------------------------------ lifecycle

  get mode() { return isName(this.values) ? 'name' : 'play'; }
  get roundLength() { return parseInt(this.values.length, 10) || 0; }
  get asksInversion() { return this.values.inversions !== 'root'; }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    clearTimeout(this.evalTimer);
  }

  onOptions(values) {
    this.values = values;
    this.finishEndless();
    this.build();
    this.startRound();
  }

  destroy() {
    this.finishEndless();
    this.clearTimers();
    window.removeEventListener('keydown', this.onKey);
    this.ctx.setHints?.([]);
    this.ctx.container.innerHTML = '';
  }

  // ------------------------------------------------------------ DOM

  build() {
    const c = this.ctx.container;
    c.innerHTML = '';
    this.el = {};
    const el = this.el;
    el.stats = h('div', { class: 'tr-stats' });
    el.label = h('div', { class: 'tr-prompt-label' });
    el.name = h('div', { class: 'tr-chord-name' });
    el.staff = h('div', { class: 'tr-staff' });
    el.sub = h('div', { class: 'tr-sub' });
    el.feedback = h('div', { class: 'tr-feedback', role: 'status' });
    el.held = h('div', { class: 'tr-held' });
    el.hint = h('button', { class: 'tr-btn', onclick: () => this.showHint(), hidden: true }, 'Show the notes');
    el.play = h('button', { class: 'tr-btn', onclick: () => this.playChord() }, '▶ Play chord');
    el.reveal = h('button', { class: 'tr-btn', onclick: () => this.reveal() }, 'Reveal');
    el.next = h('button', { class: 'tr-btn primary', onclick: () => this.next() }, 'Next ›');
    el.answers = h('div', { class: 'tr-answers' });
    el.weak = h('div', { class: 'tr-weak' });
    el.summary = h('div', { class: 'tr-summary', hidden: true });
    const card = h('div', { class: 'tr-card' }, el.label, el.name, el.staff, el.sub);
    const actions = h('div', { class: 'tr-actions' }, el.play, el.hint, el.reveal, el.next);
    c.append(h('div', { class: 'trainer chord-trainer' }, el.stats, card, el.feedback, el.held, el.answers, actions, el.weak, el.summary));
    el.name.hidden = this.mode === 'name';
    el.staff.hidden = this.mode !== 'name';
    el.held.hidden = this.mode === 'name';
    if (this.mode === 'name') this.buildAnswerButtons();
  }

  buildAnswerButtons() {
    const a = this.el.answers;
    a.innerHTML = '';
    this.rootBtns = Array.from({ length: 12 }, (_, pc) => h('button', { class: 'tr-ans tr-root', onclick: () => this.select('rootPc', pc) }));
    const types = CHORD_SETS[this.values.chordSet]?.types || CHORD_SETS.majmin.types;
    this.typeBtns = new Map(types.map((t, i) => [t, h('button', { class: 'tr-ans', onclick: () => this.select('type', t) },
      h('span', { class: 'tr-key' }, i < 9 ? String(i + 1) : ''), CHORD_TYPES[t].label,
      h('small', {}, `C${CHORD_TYPES[t].symbol}`))]));
    const maxInv = Math.max(...types.map(inversionCount));
    this.invBtns = Array.from({ length: maxInv }, (_, i) => h('button', { class: 'tr-ans', onclick: () => this.select('inversion', i) },
      INVERSION_NAMES[i].replace(/^./, (x) => x.toUpperCase())));
    const row = (title, keys, btns) => h('div', { class: 'tr-answer-row' },
      h('div', { class: 'tr-row-title' }, title, h('span', { class: 'tr-keys' }, keys)), h('div', { class: 'tr-grid' }, btns));
    a.append(
      row('Root', 'C–B, ↑/↓ then Enter', this.rootBtns),
      row('Quality', '1–9', [...this.typeBtns.values()]),
    );
    if (this.asksInversion) a.append(row('Inversion', '0, ⇧1–3', this.invBtns));
  }

  renderStats() {
    const r = this.round;
    const acc = r.total ? Math.round((100 * r.correct) / r.total) : null;
    const mean = r.times.length ? r.times.reduce((x, y) => x + y, 0) / r.times.length / 1000 : null;
    const len = this.roundLength;
    const chip = (label, value, cls = '') => h('div', { class: `tr-chip ${cls}` }, h('span', {}, label), h('b', {}, value));
    this.el.stats.replaceChildren(
      chip('Question', len ? `${Math.min(r.total + 1, len)} / ${len}` : `${r.total + 1}`),
      chip('Streak', String(r.streak), r.streak >= 5 ? 'good' : ''),
      chip('Accuracy', acc === null ? '–' : `${acc}%`, acc === null ? '' : acc >= 80 ? 'good' : acc >= 50 ? 'warn' : 'bad'),
      chip('Avg time', mean === null ? '–' : `${mean.toFixed(1)} s`),
    );
    const weak = this.stats.weakest(`${this.mode}|`).filter((w) => w.accuracy < 0.8).slice(0, 3);
    this.el.weak.textContent = weak.length ? `Practising more: ${weak.map((w) => `${itemLabel(w.item)} (${Math.round(w.accuracy * 100)}%)`).join(', ')}` : '';
  }

  feedback(text, kind = '') {
    this.el.feedback.className = `tr-feedback ${kind}`;
    this.el.feedback.replaceChildren(...[].concat(text));
  }

  // ------------------------------------------------------------ questions

  startRound() {
    this.clearTimers();
    this.round = { total: 0, correct: 0, streak: 0, best: 0, times: [] };
    this.el.summary.hidden = true;
    this.q = null;
    this.newQuestion();
  }

  newQuestion() {
    this.clearTimers();
    const rng = this.rng || this.ctx.makeRng();
    const mode = this.mode;
    this.q = makeChordQuestion(this.values, rng, {
      weight: (item) => this.stats.weight(`${mode}|${item}`),
      avoid: this.q,
    });
    this.misses = 0;
    this.done = false;
    this.lastEval = null;
    this.shownAt = performance.now();
    this.sel = { rootPc: undefined, type: undefined, inversion: this.asksInversion ? undefined : 0 };
    this.ctx.setHints?.([]);
    this.el.hint.hidden = true;
    this.el.reveal.hidden = false;
    this.feedback('');
    const q = this.q;
    if (mode === 'play') {
      this.el.label.textContent = 'Play this chord';
      this.el.name.textContent = this.values.display === 'words' ? q.words : q.symbol;
      this.el.name.classList.toggle('words', this.values.display === 'words');
      const parts = [];
      if (this.values.display !== 'words' && q.inversion) parts.push(INVERSION_NAMES[q.inversion]);
      if (this.values.voicing === 'close') parts.push('close position');
      if (!this.values.requireBass && this.asksInversion) parts.push('any inversion accepted');
      this.el.sub.textContent = parts.join(' · ');
      this.renderHeld();
      this.ctx.setStatus?.('Play the chord on your keyboard');
    } else {
      this.el.label.textContent = 'Name this chord';
      this.el.sub.textContent = '';
      this.clef = pickClef(this.values.clef, rng);
      this.renderStaff();
      const labels = rootLabels(q);
      this.rootBtns.forEach((b, pc) => { b.textContent = labels[pc]; });
      this.markSelection();
      if (this.values.playOnShow) this.later(() => this.playChord(), 250);
      this.ctx.setStatus?.('Pick the root, quality and inversion');
    }
    this.renderStats();
  }

  async renderStaff() {
    const token = (this.staffToken = {});
    try {
      if (typeof opensheetmusicdisplay === 'undefined') throw new Error('OSMD not loaded');
      const div = h('div', { class: 'tr-staff-inner' });
      this.el.staff.replaceChildren(div);
      const osmd = await renderMiniScore(div, chordScore(this.q, this.clef), { zoom: 1.4 });
      if (token !== this.staffToken) return;
      // A lone chord reads better without the 4/4.
      if (osmd?.EngravingRules) {
        osmd.EngravingRules.RenderTimeSignatures = false;
        osmd.render();
      }
    } catch (err) {
      if (token === this.staffToken) this.el.staff.textContent = this.q.notes.map((p) => prettyNote(p)).join(' ');
    }
  }

  playChord(q = this.q) {
    if (!q || !this.ctx.audio) return;
    const a = this.ctx.audio;
    a.ensure();
    const t = a.now + 0.05;
    for (const m of hintMidis(q)) a.playNote(m, t, 1.5, 75);
  }

  /** The current question is finished (correct or revealed). */
  complete(correct, { revealed = false } = {}) {
    if (this.done) return;
    this.done = true;
    const firstTry = correct && this.misses === 0;
    const ms = performance.now() - this.shownAt;
    const r = this.round;
    r.total++;
    if (firstTry) {
      r.correct++;
      r.streak++;
      r.best = Math.max(r.best, r.streak);
    } else r.streak = 0;
    if (correct) r.times.push(ms);
    const q = this.q;
    this.stats.record(`${this.mode}|type:${q.type}`, firstTry, firstTry ? ms : null);
    if (this.asksInversion) this.stats.record(`${this.mode}|inv:${q.inversion}`, firstTry, firstTry ? ms : null);
    this.stats.save();
    this.el.reveal.hidden = true;
    this.renderStats();
    if (this.roundLength && r.total >= this.roundLength) {
      this.later(() => this.endRound(), revealed ? 1500 : NEXT_DELAY);
    } else if (!revealed) {
      this.later(() => this.newQuestion(), NEXT_DELAY);
    }
  }

  next() {
    if (!this.el.summary.hidden) return this.startRound();
    if (this.done) {
      if (this.roundLength && this.round.total >= this.roundLength) return this.endRound();
      return this.newQuestion();
    }
    // Skipping a question already attempted counts as a miss.
    if (this.misses > 0) {
      this.complete(false, { revealed: true });
      if (this.roundLength && this.round.total >= this.roundLength) return this.endRound();
    }
    return this.newQuestion();
  }

  reveal() {
    if (this.done || !this.q) return;
    const q = this.q;
    this.misses = Math.max(1, this.misses);
    this.feedback([h('b', {}, `${q.symbol}`), ` = ${q.words}: ${q.notes.map((p) => prettyNote(p)).join(' ')}`], 'warn');
    this.ctx.setHints?.(hintMidis(q));
    if (this.mode === 'name') this.markSelection(true);
    if (this.values.sound) this.playChord();
    this.complete(false, { revealed: true });
  }

  showHint() {
    const q = this.q;
    this.ctx.setHints?.(hintMidis(q));
    this.feedback(['Notes: ', h('b', {}, q.notes.map((p) => prettyNote(p)).join(' ')), q.inversion ? ` (bass ${q.bassName})` : ''], 'warn');
  }

  endRound() {
    this.clearTimers();
    const r = this.round;
    const total = r.total;
    if (!total) return;
    const title = `Chords: ${this.mode === 'name' ? 'name' : 'play'}, ${CHORD_SETS[this.values.chordSet]?.label || ''}`;
    this.ctx.recordResult?.({ title, correct: r.correct, total });
    r.recorded = true;
    const mean = r.times.length ? (r.times.reduce((a, b) => a + b, 0) / r.times.length / 1000).toFixed(1) : '–';
    const s = this.el.summary;
    s.replaceChildren(
      h('h3', {}, 'Round complete'),
      h('table', {},
        h('tr', {}, h('td', {}, 'First-try correct'), h('td', {}, `${r.correct} / ${total} (${Math.round((100 * r.correct) / total)}%)`)),
        h('tr', {}, h('td', {}, 'Best streak'), h('td', {}, String(r.best))),
        h('tr', {}, h('td', {}, 'Average time'), h('td', {}, `${mean} s`))),
      h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => this.startRound() }, 'New round')),
    );
    s.hidden = false;
    this.ctx.setStatus?.('Round complete');
  }

  /** Endless sessions have no end: record them when leaving (if long enough to mean something). */
  finishEndless() {
    const r = this.round;
    if (r && !this.roundLength && !r.recorded && r.total >= 5) {
      this.ctx.recordResult?.({ title: `Chords: ${this.mode} (endless)`, correct: r.correct, total: r.total });
      r.recorded = true;
    }
  }

  // ------------------------------------------------------------ play mode

  noteOn(midi) {
    this.held.on(midi);
    this.scheduleEval();
  }

  noteOff(midi) {
    this.held.off(midi);
    if (!this.held.held.size) this.lastEval = null;
    this.scheduleEval();
  }

  renderHeld() {
    const m = this.held.midis;
    this.el.held.textContent = m.length ? `Holding: ${describePlayed(m, !/#/.test(this.q?.rootName || '')).names.join(' ')}` : '';
  }

  scheduleEval() {
    if (this.mode !== 'play') return;
    this.renderHeld();
    clearTimeout(this.evalTimer);
    this.evalTimer = setTimeout(() => this.evaluate(), STABLE_MS);
  }

  evaluate() {
    const q = this.q;
    if (!q || this.done || !this.el.summary.hidden) return;
    const midis = this.held.midis;
    if (midis.length < evalThreshold(q, this.values.voicing)) return;
    const key = midis.join(',');
    if (key === this.lastEval) return;
    this.lastEval = key;
    const res = checkPlayedChord(q, midis, { requireBass: this.values.requireBass !== false, voicing: this.values.voicing });
    if (res.ok) {
      for (const m of midis) this.ctx.flash?.(m, 'good');
      const t = ((performance.now() - this.shownAt) / 1000).toFixed(1);
      this.feedback([h('b', {}, `✓ ${q.symbol}`), ` ${this.misses ? '' : 'first try, '}${t} s`], 'good');
      this.ctx.setHints?.([]);
      this.complete(true);
      return;
    }
    this.misses++;
    const flats = !/#/.test(q.rootName);
    const played = describePlayed(midis, flats);
    const what = played.symbol ? `You played ${played.symbol}` : `You played ${played.names.join(' ')}`;
    let msg;
    if (res.reason === 'bass') msg = `Right notes, but the bass should be ${q.bassName} (${INVERSION_NAMES[q.inversion]}).`;
    else if (res.reason === 'doubled') msg = 'Right notes, but close position means each chord tone once.';
    else if (res.reason === 'spread') msg = 'Right notes, but keep them within an octave for close position.';
    else msg = `${what}, not ${q.symbol}.`;
    const extraPcs = new Set(res.extra);
    for (const m of midis) if (extraPcs.has(m % 12)) this.ctx.flash?.(m, 'wrong');
    this.feedback([h('b', {}, '✗ '), msg, this.misses >= 2 ? ' Need a hint?' : ''], 'bad');
    if (this.misses >= 2) this.el.hint.hidden = false;
    if (this.values.sound && this.misses >= 2) this.playChord();
  }

  // ------------------------------------------------------------ name mode

  get selectionComplete() {
    return this.sel.rootPc !== undefined && this.sel.type !== undefined && this.sel.inversion !== undefined;
  }

  /** Select part of the answer; the answer is checked as soon as it is complete (unless `submit` is false). */
  select(part, value, submit = true) {
    if (this.done || this.mode !== 'name') return;
    this.sel[part] = value;
    this.markSelection();
    if (submit && this.selectionComplete) this.submitName();
  }

  markSelection(reveal = false) {
    const { sel, q } = this;
    const mark = (btn, selected, right) => {
      btn.classList.toggle('selected', selected);
      btn.classList.toggle('right', Boolean(reveal && right));
    };
    this.rootBtns?.forEach((b, pc) => mark(b, sel.rootPc === pc, pc === q.rootPc));
    this.typeBtns?.forEach((b, t) => mark(b, sel.type === t, t === q.type));
    this.invBtns?.forEach((b, i) => mark(b, sel.inversion === i, i === q.inversion));
    if (!reveal) for (const b of [...(this.rootBtns || []), ...(this.typeBtns?.values() || []), ...(this.invBtns || [])]) b.classList.remove('wrong');
  }

  submitName() {
    const q = this.q;
    const { result, parts } = checkNamedChord(q, this.sel, { inversions: this.asksInversion });
    if (result) {
      this.markSelection(true);
      const extra = result === 'equivalent' ? ` (same notes as ${q.symbol})` : '';
      this.feedback([h('b', {}, `✓ ${q.symbol}`), ` ${q.words}${extra}`], 'good');
      if (this.values.sound) this.playChord();
      this.complete(true);
      return;
    }
    this.misses++;
    // Flag the wrong parts and clear them so the next pick re-checks.
    if (!parts.root) this.rootBtns[this.sel.rootPc]?.classList.add('wrong');
    if (!parts.type) this.typeBtns.get(this.sel.type)?.classList.add('wrong');
    if (!parts.inversion) this.invBtns[this.sel.inversion]?.classList.add('wrong');
    const wrong = [];
    if (!parts.root) { wrong.push('root'); this.sel.rootPc = undefined; }
    if (!parts.type) { wrong.push('quality'); this.sel.type = undefined; }
    if (!parts.inversion) { wrong.push('inversion'); this.sel.inversion = undefined; }
    for (const b of [...this.rootBtns, ...this.typeBtns.values(), ...this.invBtns]) b.classList.remove('selected');
    this.rootBtns[this.sel.rootPc]?.classList.add('selected');
    this.typeBtns.get(this.sel.type)?.classList.add('selected');
    this.invBtns[this.sel.inversion]?.classList.add('selected');
    this.feedback([h('b', {}, '✗ '), `Check the ${wrong.join(' and ')}.`], 'bad');
    if (this.values.sound && this.misses >= 2) this.playChord();
  }

  keydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.done || !this.el.summary.hidden) this.next();
      else if (this.mode === 'name' && this.selectionComplete) this.submitName();
      return;
    }
    if (this.mode !== 'name' || this.done) return;
    const k = e.key.toLowerCase();
    if (k in NATURAL_KEYS) { this.select('rootPc', NATURAL_KEYS[k]); return; }
    if (e.key === 'ArrowUp' && this.sel.rootPc !== undefined) {
      e.preventDefault();
      this.select('rootPc', (this.sel.rootPc + 1) % 12, false);
      return;
    }
    if (e.key === 'ArrowDown' && this.sel.rootPc !== undefined) {
      e.preventDefault();
      this.select('rootPc', (this.sel.rootPc + 11) % 12, false);
      return;
    }
    if (this.asksInversion && (e.key === '0' || (e.shiftKey && /^Digit[1-3]$/.test(e.code)))) {
      const i = e.key === '0' ? 0 : +e.code.slice(5);
      if (i < this.invBtns.length) this.select('inversion', i);
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const t = [...this.typeBtns.keys()][+e.key - 1];
      if (t) this.select('type', t);
    }
  }

  transport(action) {
    if (action === 'play' || action === 'back') { this.playChord(); return true; }
    if (action === 'forward') { this.next(); return true; }
    return false;
  }
}
