// Ear training panel: intervals, chord qualities and inversions, scales and modes, functional scale degrees,
// melodic dictation and chord progressions. Question generation lives in ear-logic.js.

import { h } from './panel.js';
import {
  EXERCISES, INTERVAL_SETS, EAR_CHORD_SETS, EAR_SCALE_SETS, PROG_SETS, makeEarQuestion, checkEarAnswer,
  checkProgression, answerFromPlayed, dictationNoteOk, statKey,
} from './ear-logic.js';
import { ItemStats } from './trainer-stats.js';
import { spellMidi, pitchName, findKey, TONIC_BY_PC } from '../core/theory.js';
import { prettyNote } from '../core/chords.js';

export const EAR_STATS_KEY = 'pianoPractice.earStats.v1';
const KEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '[', ']'];
const ADVANCE_MS = 1300;

const ex = (...ids) => (v) => ids.includes(v.exercise);
const REFERENCE_LABEL = {
  intervals: 'First note', chords: 'Root', inversions: 'Bass', scales: 'Tonic', degrees: 'Tonic', dictation: 'First note',
  progressions: 'Tonic chord',
};

export const earTrainingPanel = {
  id: 'ear',
  label: 'Ear training',
  description: 'Intervals, chords, scales, scale degrees, dictation and progressions by ear.',
  instrument: 'both',
  kind: 'panel',
  options: [
    { id: 'exercise', label: 'Exercise', type: 'select', choices: Object.entries(EXERCISES), default: 'intervals' },
    {
      id: 'intervalSet', label: 'Intervals', type: 'select', default: 'octave', showIf: ex('intervals'),
      choices: Object.entries(INTERVAL_SETS).map(([id, s]) => [id, s.label]),
    },
    {
      id: 'intervalDir', label: 'Direction', type: 'select', default: 'up', showIf: ex('intervals'),
      choices: [['up', 'Melodic up'], ['down', 'Melodic down'], ['harmonic', 'Harmonic'], ['mixed', 'Mixed']],
    },
    {
      id: 'chordSet', label: 'Chords', type: 'select', default: 'triads', showIf: ex('chords', 'inversions'),
      choices: Object.entries(EAR_CHORD_SETS).map(([id, s]) => [id, s.label]),
    },
    {
      id: 'chordStyle', label: 'Played as', type: 'select', default: 'block', showIf: ex('chords', 'inversions'),
      choices: [['block', 'Block chord'], ['arp', 'Arpeggio'], ['both', 'Arpeggio, then block']],
    },
    {
      id: 'scaleSet', label: 'Scales', type: 'select', default: 'majmin', showIf: ex('scales'),
      choices: Object.entries(EAR_SCALE_SETS).map(([id, s]) => [id, s.label]),
    },
    { id: 'scaleDir', label: 'Played', type: 'select', default: 'up', showIf: ex('scales'), choices: [['up', 'Ascending'], ['updown', 'Up and down']] },
    {
      id: 'tonality', label: 'Key quality', type: 'select', default: 'major', showIf: ex('degrees', 'dictation', 'progressions'),
      choices: [['major', 'Major'], ['minor', 'Minor'], ['mixed', 'Mixed']],
    },
    {
      id: 'keyMode', label: 'Key', type: 'select', default: 'random', showIf: ex('degrees', 'dictation', 'progressions'),
      choices: [['fixed', 'C major / A minor'], ['random', 'Random key']],
    },
    { id: 'chromatic', label: 'Chromatic degrees', type: 'checkbox', default: false, showIf: ex('degrees') },
    {
      id: 'dictLength', label: 'Notes', type: 'select', default: '4', showIf: ex('dictation'),
      choices: [3, 4, 5, 6, 7, 8].map((n) => [String(n), `${n} notes`]),
    },
    {
      id: 'dictMotion', label: 'Motion', type: 'select', default: 'step', showIf: ex('dictation'),
      choices: [['step', 'Stepwise'], ['mixed', 'Steps and leaps'], ['leaps', 'Mostly leaps']],
    },
    { id: 'octaveTolerant', label: 'Any octave counts', type: 'checkbox', default: true, showIf: ex('dictation') },
    {
      id: 'progSet', label: 'Chords', type: 'select', default: 'pop', showIf: ex('progressions'),
      choices: Object.entries(PROG_SETS).map(([id, s]) => [id, s.label]),
    },
    { id: 'progLength', label: 'Length', type: 'select', default: '4', showIf: ex('progressions'), choices: [['3', '3 chords'], ['4', '4 chords']] },
    { id: 'answerByPlaying', label: 'Answer by playing', type: 'checkbox', default: true, showIf: ex('intervals', 'degrees') },
    { id: 'autoAdvance', label: 'Auto-advance when right', type: 'checkbox', default: true },
    { id: 'length', label: 'Round length', type: 'select', choices: [['10', '10'], ['20', '20'], ['50', '50'], ['0', 'Endless']], default: '20' },
  ],
  create(ctx) {
    return new EarTrainer(ctx);
  },
};

class EarTrainer {
  constructor(ctx) {
    this.ctx = ctx;
    this.values = ctx.values || {};
    for (const o of earTrainingPanel.options) if (!(o.id in this.values)) this.values[o.id] = o.default;
    this.rng = ctx.makeRng ? ctx.makeRng() : null;
    this.stats = new ItemStats(EAR_STATS_KEY);
    this.timers = new Set();
    this.playEnd = 0;
    this.onKey = (e) => this.keydown(e);
    window.addEventListener('keydown', this.onKey);
    this.build();
    this.startRound();
  }

  get exercise() { return this.values.exercise || 'intervals'; }
  get roundLength() { return parseInt(this.values.length, 10) || 0; }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
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
    const el = (this.el = {});
    el.stats = h('div', { class: 'tr-stats' });
    el.label = h('div', { class: 'tr-prompt-label' });
    el.prompt = h('div', { class: 'tr-prompt' });
    el.sub = h('div', { class: 'tr-sub' });
    el.slots = h('div', { class: 'tr-slots' });
    el.feedback = h('div', { class: 'tr-feedback', role: 'status' });
    el.replay = h('button', { class: 'tr-btn', onclick: () => this.play(), title: 'R' }, '▶ Replay');
    el.reference = h('button', { class: 'tr-btn', onclick: () => this.playReference(), title: 'C' }, 'Reference');
    el.reveal = h('button', { class: 'tr-btn', onclick: () => this.reveal() }, 'Reveal');
    el.next = h('button', { class: 'tr-btn primary', onclick: () => this.next(), title: 'Enter' }, 'Next ›');
    el.answers = h('div', { class: 'tr-grid tr-ear-grid' });
    el.weak = h('div', { class: 'tr-weak' });
    el.summary = h('div', { class: 'tr-summary', hidden: true });
    const card = h('div', { class: 'tr-card' }, el.label, el.prompt, el.slots, el.sub);
    const actions = h('div', { class: 'tr-actions' }, el.replay, el.reference, el.reveal, el.next);
    this.ctx.container.replaceChildren(h('div', { class: 'trainer ear-trainer' },
      el.stats, card, actions, el.feedback, el.answers, el.weak, el.summary));
  }

  renderStats() {
    const r = this.round;
    const acc = r.total ? Math.round((100 * r.correct) / r.total) : null;
    const len = this.roundLength;
    const chip = (label, value, cls = '') => h('div', { class: `tr-chip ${cls}` }, h('span', {}, label), h('b', {}, value));
    this.el.stats.replaceChildren(
      chip('Question', len ? `${Math.min(r.total + (this.done ? 0 : 1), len)} / ${len}` : String(r.total + (this.done ? 0 : 1))),
      chip('Score', `${r.correct} / ${r.total}`),
      chip('Streak', String(r.streak), r.streak >= 5 ? 'good' : ''),
      chip('Accuracy', acc === null ? '–' : `${acc}%`, acc === null ? '' : acc >= 80 ? 'good' : acc >= 50 ? 'warn' : 'bad'),
    );
    const prefix = `${this.exercise}|`;
    const weak = this.stats.weakest(prefix).filter((w) => w.accuracy < 0.8).slice(0, 3);
    const label = (item) => {
      const id = item.slice(item.lastIndexOf(':') + 1);
      return this.q?.choices.find((c) => c.id === id)?.label || id;
    };
    this.el.weak.textContent = weak.length ? `Practising more: ${weak.map((w) => `${label(w.item)} (${Math.round(w.accuracy * 100)}%)`).join(', ')}` : '';
  }

  feedback(parts, kind = '') {
    this.el.feedback.className = `tr-feedback ${kind}`;
    this.el.feedback.replaceChildren(...[].concat(parts));
  }

  noteName(m) {
    const q = this.q;
    const mode = q?.mode || 'major';
    const key = q?.tonic !== undefined ? findKey(TONIC_BY_PC[mode][((q.tonic % 12) + 12) % 12], mode) : null;
    const flats = key ? key.fifths < 0 : true;
    return prettyNote(pitchName(spellMidi(m, !flats)));
  }

  // ------------------------------------------------------------ questions

  startRound() {
    this.clearTimers();
    this.round = { total: 0, correct: 0, streak: 0, best: 0 };
    this.el.summary.hidden = true;
    this.newQuestion();
  }

  newQuestion() {
    this.clearTimers();
    const ex = this.exercise;
    const rng = this.rng || this.ctx.makeRng();
    this.q = makeEarQuestion(this.values, rng, {
      weight: (item) => this.stats.weight(statKey(ex, item)),
      instrument: this.ctx.instrument === 'guitar' ? 'guitar' : 'piano',
    });
    const q = this.q;
    this.done = false;
    this.attempts = 0;
    this.firstSlots = null;
    this.mistakes = 0;
    this.pos = 0;
    this.shownAt = performance.now();
    this.el.label.textContent = EXERCISES[ex];
    this.el.prompt.textContent = q.prompt;
    const sub = [];
    if (q.playHint && this.values.answerByPlaying) sub.push(`Click an answer ${q.playHint} on your instrument.`);
    if (ex === 'dictation') sub.push(`Play it back note by note${this.values.octaveTolerant ? ' (any octave)' : ''}.`);
    this.el.sub.textContent = sub.join(' ');
    this.el.reference.textContent = REFERENCE_LABEL[ex] || 'Reference';
    this.el.reveal.hidden = false;
    this.feedback('');
    this.slots = q.slots ? Array.from({ length: q.slots }, () => ({ value: undefined, state: '' })) : null;
    this.renderSlots();
    this.renderAnswers();
    this.renderStats();
    this.ctx.setHints?.([]);
    this.ctx.setStatus?.(ex === 'dictation' ? 'Listen, then play the melody back' : 'Listen and answer');
    this.later(() => this.play(), 350);
  }

  renderAnswers() {
    const q = this.q;
    this.answerBtns = new Map();
    const btns = q.choices.map((c, i) => {
      const b = h('button', { class: 'tr-ans', onclick: () => this.answer(c.id) },
        h('span', { class: 'tr-key' }, KEY_LABELS[i] || ''), c.label, c.sub ? h('small', {}, c.sub) : null);
      this.answerBtns.set(c.id, b);
      return b;
    });
    this.el.answers.replaceChildren(...btns);
    this.el.answers.hidden = !btns.length;
  }

  renderSlots() {
    const q = this.q;
    const s = this.el.slots;
    if (q.exercise === 'progressions') {
      s.replaceChildren(h('span', { class: 'tr-slot tonic' }, q.mode === 'minor' ? 'i' : 'I'),
        ...this.slots.map((slot, i) => h('button', {
          class: `tr-slot ${slot.state}`, onclick: () => this.clearSlot(i),
        }, slot.value || '?')));
      s.hidden = false;
    } else if (q.exercise === 'dictation') {
      s.replaceChildren(...q.melody.map((m, i) => h('span', {
        class: `tr-slot ${i < this.pos ? 'right' : i === this.pos && !this.done ? 'current' : ''}`,
      }, i < this.pos || this.revealed ? this.noteName(m) : '•')));
      s.hidden = false;
    } else {
      s.replaceChildren();
      s.hidden = true;
    }
  }

  /** Schedule a list of events ({ at, dur, midis }) with audio time. */
  schedule(events) {
    const a = this.ctx.audio;
    if (!a || !events?.length) return;
    a.ensure();
    const t0 = a.now + 0.08;
    let end = 0;
    for (const ev of events) {
      for (const m of ev.midis) a.playNote(m, t0 + ev.at, ev.dur, ev.midis.length > 2 ? 70 : 85);
      end = Math.max(end, ev.at + ev.dur);
    }
    this.playEnd = performance.now() + (end - 0.3) * 1000;
  }

  play() {
    if (this.q) this.schedule(this.q.events);
  }

  playReference() {
    if (this.q) this.schedule(this.q.reference);
  }

  // ------------------------------------------------------------ answering

  answer(id) {
    if (this.done || !this.el.summary.hidden) return;
    if (this.q.exercise === 'progressions') return this.fillSlot(id);
    const right = checkEarAnswer(this.q, id);
    const btn = this.answerBtns.get(String(id));
    this.attempts++;
    if (right) {
      btn?.classList.add('right');
      this.feedback([h('b', {}, '✓ '), this.q.reveal], 'good');
      this.complete(this.attempts === 1);
    } else {
      btn?.classList.add('wrong');
      const label = this.q.choices.find((c) => c.id === String(id))?.label || id;
      this.feedback([h('b', {}, '✗ '), `Not ${label}. Try again, replay, or reveal.`], 'bad');
    }
  }

  fillSlot(numeral) {
    const i = this.slots.findIndex((s) => s.value === undefined);
    if (i < 0) return;
    this.slots[i] = { value: numeral, state: '' };
    this.renderSlots();
    if (this.slots.every((s) => s.value !== undefined)) this.checkSlots();
  }

  clearSlot(i) {
    if (this.done || this.slots[i].state === 'right') return;
    this.slots[i] = { value: undefined, state: '' };
    this.renderSlots();
  }

  checkSlots() {
    const ok = checkProgression(this.q, this.slots.map((s) => s.value));
    this.attempts++;
    if (!this.firstSlots) this.firstSlots = ok;
    this.slots.forEach((s, i) => { s.state = ok[i] ? 'right' : 'wrong'; });
    this.renderSlots();
    if (ok.every(Boolean)) {
      this.feedback([h('b', {}, '✓ '), this.q.reveal], 'good');
      this.complete(this.attempts === 1);
      return;
    }
    const n = ok.filter((x) => !x).length;
    this.feedback([h('b', {}, '✗ '), `${n} chord${n > 1 ? 's' : ''} wrong. Pick again for the red slot${n > 1 ? 's' : ''}.`], 'bad');
    this.slots.forEach((s, i) => { if (!ok[i]) s.value = undefined; });
    this.later(() => this.renderSlots(), 700);
  }

  noteOn(midi, time, velocity, source) {
    const q = this.q;
    if (!q || this.done || !this.el.summary.hidden) return;
    if (performance.now() < this.playEnd) return; // ignore notes played over the question
    if (q.exercise === 'dictation') return this.dictationNote(midi, source);
    if (!this.values.answerByPlaying) return;
    const id = answerFromPlayed(q, midi);
    if (id === null) return;
    const right = checkEarAnswer(q, id);
    this.ctx.flash?.(midi, right ? 'good' : 'wrong');
    if (id === 'none') {
      this.attempts++;
      this.feedback([h('b', {}, '✗ '), q.dir === 'down' ? 'Play a note below the first one.' : 'Play a note above the first one.'], 'bad');
      return;
    }
    this.answer(id);
  }

  dictationNote(midi, source) {
    const q = this.q;
    const expected = q.melody[this.pos];
    const tolerant = Boolean(this.values.octaveTolerant) || source === 'guitar';
    if (dictationNoteOk(expected, midi, tolerant)) {
      this.ctx.flash?.(midi, 'good');
      this.pos++;
      if (this.pos === q.melody.length) {
        this.attempts = 1;
        const clean = this.mistakes === 0;
        this.feedback([h('b', {}, '✓ '), clean ? 'Perfect!' : `Done, with ${this.mistakes} wrong note${this.mistakes > 1 ? 's' : ''}.`], clean ? 'good' : 'warn');
        this.complete(clean);
      } else {
        this.feedback(`${this.pos} of ${q.melody.length} ✓`);
      }
      this.renderSlots();
      return;
    }
    this.ctx.flash?.(midi, 'wrong');
    this.mistakes++;
    this.feedback([h('b', {}, '✗ '), `Not ${this.noteName(midi)}: try note ${this.pos + 1} again.`], 'bad');
  }

  /** Question finished. Stats and score count the first attempt only. */
  complete(firstTry, { revealed = false } = {}) {
    if (this.done) return;
    this.done = true;
    const q = this.q;
    const r = this.round;
    const ms = performance.now() - this.shownAt;
    r.total++;
    if (firstTry) {
      r.correct++;
      r.streak++;
      r.best = Math.max(r.best, r.streak);
    } else r.streak = 0;
    q.items.forEach((item, i) => {
      const ok = this.firstSlots ? this.firstSlots[i] : firstTry;
      this.stats.record(statKey(q.exercise, item), ok, ok ? ms : null);
    });
    this.stats.save();
    this.el.reveal.hidden = true;
    this.renderStats();
    if (this.roundLength && r.total >= this.roundLength) this.later(() => this.endRound(), revealed ? 2500 : ADVANCE_MS);
    else if (this.values.autoAdvance && !revealed) this.later(() => this.newQuestion(), firstTry ? ADVANCE_MS : 2 * ADVANCE_MS);
  }

  reveal() {
    if (this.done || !this.q) return;
    const q = this.q;
    this.revealed = true;
    if (q.exercise === 'progressions') {
      this.slots = q.progression.map((c) => ({ value: c.numeral, state: 'right' }));
    } else if (q.exercise !== 'dictation') {
      this.answerBtns.get(q.answer)?.classList.add('right');
    }
    const text = q.exercise === 'dictation' ? q.melody.map((m) => this.noteName(m)).join(' ') : q.reveal;
    this.feedback([h('b', {}, 'Answer: '), text], 'warn');
    if (q.exercise === 'dictation') this.ctx.setHints?.(q.melody);
    this.attempts = Math.max(this.attempts, 2);
    this.complete(false, { revealed: true });
    this.renderSlots();
    this.revealed = false;
    this.play();
  }

  next() {
    if (!this.el.summary.hidden) return this.startRound();
    if (this.done && this.roundLength && this.round.total >= this.roundLength) return this.endRound();
    if (!this.done && this.attempts > 0) {
      // Skipping a question already attempted counts as wrong.
      this.complete(false, { revealed: true });
      if (this.roundLength && this.round.total >= this.roundLength) return this.endRound();
    }
    return this.newQuestion();
  }

  endRound() {
    this.clearTimers();
    const r = this.round;
    if (!r.total) return;
    this.ctx.recordResult?.({ title: `Ear: ${EXERCISES[this.exercise]}`, correct: r.correct, total: r.total });
    r.recorded = true;
    this.el.summary.replaceChildren(
      h('h3', {}, 'Round complete'),
      h('table', {},
        h('tr', {}, h('td', {}, 'First-try correct'), h('td', {}, `${r.correct} / ${r.total} (${Math.round((100 * r.correct) / r.total)}%)`)),
        h('tr', {}, h('td', {}, 'Best streak'), h('td', {}, String(r.best)))),
      h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => this.startRound() }, 'New round')),
    );
    this.el.summary.hidden = false;
    this.ctx.setStatus?.('Round complete');
  }

  finishEndless() {
    const r = this.round;
    if (r && !this.roundLength && !r.recorded && r.total >= 5) {
      this.ctx.recordResult?.({ title: `Ear: ${EXERCISES[this.exercise]} (endless)`, correct: r.correct, total: r.total });
      r.recorded = true;
    }
  }

  keydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName)) return;
    if (e.key === 'Enter') { e.preventDefault(); this.next(); return; }
    const k = e.key.toLowerCase();
    if (k === 'r') { this.play(); return; }
    if (k === 'c') { this.playReference(); return; }
    if (e.key === 'Backspace' && this.slots && !this.done) {
      const i = this.slots.map((s) => s.value !== undefined && s.state !== 'right').lastIndexOf(true);
      if (i >= 0) { e.preventDefault(); this.clearSlot(i); }
      return;
    }
    const idx = KEY_LABELS.indexOf(e.key);
    if (idx >= 0 && this.q?.choices[idx]) { e.preventDefault(); this.answer(this.q.choices[idx].id); }
  }

  transport(action) {
    if (action === 'play') { this.play(); return true; }
    if (action === 'back') { this.playReference(); return true; }
    if (action === 'forward') { this.next(); return true; }
    return false;
  }
}
