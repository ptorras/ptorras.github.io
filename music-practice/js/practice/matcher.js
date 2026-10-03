// Pure note-matching logic, independent of the DOM so it can be unit-tested.
//
// A timeline is a list of steps (one per cursor position):
//   { pos, time /* quarter notes from start */, notes: [{ id, midi, staff }] }
// Only notes on the required staves are expected; steps without expected notes are skipped.
//
// Modes:
//  - 'wait':  free tempo. The cursor waits on each step until all its notes are played.
//  - 'tempo': fixed tempo. Each note must be played within +/- tolerance of its time;
//             notes not played in time are missed. Times here are in seconds from the start.

export class Matcher {
  /**
   * @param steps timeline steps
   * @param opts { mode, requiredStaves: Set|null, secPerQuarter, toleranceSec, chordGraceSec }
   *   chordGraceSec: extra time before a chord's notes count as missed (guitar chords are verified late)
   */
  constructor(steps, opts = {}) {
    this.mode = opts.mode || 'wait';
    this.secPerQuarter = opts.secPerQuarter || 0.75;
    this.tolerance = opts.toleranceSec ?? 0.15;
    this.chordGrace = opts.chordGraceSec || 0;
    const required = opts.requiredStaves;
    this.steps = steps
      .map((s) => ({ ...s, notes: dedupe(s.notes.filter((n) => !required || required.has(n.staff))) }))
      .filter((s) => s.notes.length > 0);
    this.reset();
  }

  reset() {
    this.index = 0;
    this.pending = this.steps.length ? new Map(this.steps[0].notes.map((n) => [n.midi, n])) : new Map();
    this.stepErrors = 0;
    this.finished = this.steps.length === 0;
    this.stats = { notes: 0, hits: 0, wrong: 0, missed: 0, cleanSteps: 0, steps: this.steps.length, offsets: [] };
    for (const s of this.steps) this.stats.notes += s.notes.length;
    // tempo mode bookkeeping
    this.expected = this.steps.flatMap((s, i) => s.notes.map((n) => ({
      ...n, step: i, at: s.time * this.secPerQuarter, grace: s.notes.length > 1 ? this.chordGrace : 0, done: false,
    })));
    this.missCursor = 0;
    this.stepCursor = -1;
    this.lastTime = this.steps.length ? this.steps[this.steps.length - 1].time * this.secPerQuarter : 0;
  }

  get currentStep() {
    return this.steps[this.index] || null;
  }

  /** Wait mode: move to another step (skipping or going back), keeping the statistics so far. */
  jumpTo(index) {
    if (this.mode !== 'wait' || !this.steps.length) return [];
    this.index = Math.max(0, Math.min(this.steps.length - 1, index));
    this.pending = new Map(this.steps[this.index].notes.map((n) => [n.midi, n]));
    this.stepErrors = 0;
    this.finished = false;
    return [{ type: 'step', step: this.index, pos: this.steps[this.index].pos }];
  }

  /** Notes still expected right now (wait mode), for hints. */
  get pendingNotes() {
    return [...this.pending.values()];
  }

  /** Handle a played note. `t` is seconds since start (tempo mode only). Returns events. */
  noteOn(midi, t = 0) {
    if (this.finished) return [];
    return this.mode === 'wait' ? this.#waitNoteOn(midi) : this.#tempoNoteOn(midi, t);
  }

  #waitNoteOn(midi) {
    const events = [];
    const note = this.pending.get(midi);
    if (!note) {
      this.stats.wrong++;
      this.stepErrors++;
      events.push({ type: 'wrong', midi, step: this.index });
      return events;
    }
    this.pending.delete(midi);
    this.stats.hits++;
    events.push({ type: 'hit', note, step: this.index });
    if (this.pending.size === 0) {
      if (this.stepErrors === 0) this.stats.cleanSteps++;
      this.stepErrors = 0;
      this.index++;
      if (this.index >= this.steps.length) {
        this.finished = true;
        events.push({ type: 'done' });
      } else {
        this.pending = new Map(this.steps[this.index].notes.map((n) => [n.midi, n]));
        events.push({ type: 'step', step: this.index, pos: this.steps[this.index].pos });
      }
    }
    return events;
  }

  #tempoNoteOn(midi, t) {
    let best = null;
    // Scan expected notes near t (they are sorted by time).
    for (let i = this.missCursor; i < this.expected.length; i++) {
      const e = this.expected[i];
      if (e.at - this.tolerance > t) break;
      if (e.done || e.midi !== midi) continue;
      const off = t - e.at;
      if (Math.abs(off) <= this.tolerance && (!best || Math.abs(off) < Math.abs(best.off))) best = { e, off };
    }
    if (!best) {
      this.stats.wrong++;
      return [{ type: 'wrong', midi, step: Math.max(0, this.stepCursor) }];
    }
    best.e.done = true;
    this.stats.hits++;
    this.stats.offsets.push(best.off);
    return [{ type: 'hit', note: best.e, step: best.e.step, offset: best.off }];
  }

  /** Advance time (tempo mode): emits cursor steps, misses, and done. */
  tick(t) {
    if (this.mode !== 'tempo' || this.finished) return [];
    const events = [];
    while (this.stepCursor + 1 < this.steps.length && this.steps[this.stepCursor + 1].time * this.secPerQuarter <= t) {
      this.stepCursor++;
      events.push({ type: 'step', step: this.stepCursor, pos: this.steps[this.stepCursor].pos });
    }
    while (this.missCursor < this.expected.length && this.expected[this.missCursor].at + this.tolerance + this.expected[this.missCursor].grace < t) {
      const e = this.expected[this.missCursor++];
      if (!e.done) {
        e.done = true;
        this.stats.missed++;
        events.push({ type: 'miss', note: e, step: e.step });
      }
    }
    if (this.missCursor >= this.expected.length) {
      this.finished = true;
      events.push({ type: 'done' });
    }
    return events;
  }

  /** Summary numbers for display. */
  summary() {
    const s = this.stats;
    const offs = s.offsets;
    const mean = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
    const meanAbs = offs.length ? offs.reduce((a, b) => a + Math.abs(b), 0) / offs.length : 0;
    const attempts = s.hits + s.wrong + s.missed;
    return {
      mode: this.mode,
      notes: s.notes,
      hits: s.hits,
      wrong: s.wrong,
      missed: s.missed,
      accuracy: attempts ? s.hits / attempts : 0,
      cleanSteps: this.mode === 'wait' ? s.cleanSteps / Math.max(1, s.steps) : undefined,
      meanOffsetMs: Math.round(mean * 1000),
      meanAbsOffsetMs: Math.round(meanAbs * 1000),
    };
  }
}

/**
 * Unisons (same pitch in two voices, or a note and its tab twin) only need one key press; `ids` keeps all their
 * note ids, and a tab note's string/fret is kept for fretboard hints.
 */
function dedupe(notes) {
  const seen = new Map();
  for (const n of notes) {
    const prev = seen.get(n.midi);
    if (!prev) seen.set(n.midi, { ...n, ids: [n.id] });
    else {
      prev.ids.push(n.id);
      if (prev.string == null && n.string != null) Object.assign(prev, { string: n.string, fret: n.fret });
    }
  }
  return [...seen.values()];
}
