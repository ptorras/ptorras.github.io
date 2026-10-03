// Practice session: drives the matcher from note input, moves the cursor, colors notes,
// runs the metronome / count-in, and plays accompaniment or a demo through the synth.
// Practice and listening can start from any cursor position; forward/back step through the notes.

import { Matcher } from './matcher.js';

export const COLORS = {
  good: '#16a34a',
  sloppy: '#d97706', // played, but with wrong notes first (wait) or off the beat (tempo)
  missed: '#dc2626',
};

export class PracticeSession {
  /**
   * @param keyboard on-screen instrument (piano keyboard or fretboard): setHints(items), flash(midi, cls)
   */
  constructor({ view, audio, keyboard, onStats, onState, onFinish }) {
    Object.assign(this, { view, audio, keyboard, onStats, onState, onFinish });
    this.timeline = null;
    this.state = 'idle'; // idle | countin | running | listening
    this.matcher = null;
    this.raf = null;
    this.navPos = null; // cursor position chosen with forward/back while idle (start point for practice)
  }

  load(timeline) {
    this.stop();
    this.timeline = timeline;
    this.navPos = null;
  }

  /** Cursor positions that have notes (the stops for forward/back). */
  get notePositions() {
    return this.timeline ? this.timeline.steps.filter((s) => s.notes.length).map((s) => s.pos) : [];
  }

  /**
   * settings: { mode, bpm, metronome, countIn, toleranceMs, latencyMs, requiredStaves, playOthers, hints }
   * @param from cursor position to start at (default: the position chosen with forward/back, else the beginning)
   */
  start(settings, { from = this.navPos } = {}) {
    if (!this.timeline) return;
    this.stop();
    this.settings = settings;
    this.view.clearColors();
    this.keyboard.setHints([]);
    const secPerQuarter = 60 / settings.bpm;
    // Fixed tempo starts at the beginning of the bar that contains the start position.
    let fromPos = from || 0;
    let t0 = 0;
    let firstMeasure = this.timeline.measures[0];
    if (fromPos > 0) {
      const step = this.timeline.steps.find((s) => s.pos >= fromPos) || this.timeline.steps[0];
      fromPos = step.pos;
      t0 = step.time;
      if (settings.mode === 'tempo') {
        firstMeasure = [...this.timeline.measures].reverse().find((m) => m.time <= step.time + 1e-6) || firstMeasure;
        t0 = firstMeasure.time;
        fromPos = (this.timeline.steps.find((s) => s.time >= t0 - 1e-6) || step).pos;
      }
    }
    this.t0 = t0;
    const steps = this.timeline.steps.filter((s) => s.pos >= fromPos).map((s) => ({ ...s, time: s.time - t0 }));
    this.matcher = new Matcher(steps, {
      mode: settings.mode,
      requiredStaves: settings.requiredStaves,
      secPerQuarter,
      toleranceSec: settings.toleranceMs / 1000,
      chordGraceSec: settings.guitarChords ? 0.25 : 0,
    });
    if (!this.matcher.steps.length) {
      this.onState?.('idle', 'Nothing to play on the selected staves.');
      return;
    }
    this.stepHadError = false;
    this.#emitStats();

    if (settings.mode === 'wait') {
      this.state = 'running';
      this.view.cursorTo(this.matcher.steps[0].pos);
      this.#updateHints();
      if (settings.metronome) this.#startFreeMetronome(secPerQuarter);
      this.onState?.('running', 'Play the highlighted notes at your own pace.');
      return;
    }

    // Fixed tempo: schedule count-in, metronome and accompaniment on the audio clock.
    this.view.cursorTo(fromPos);
    const ctx = this.audio.ensure();
    const first = firstMeasure || { beats: 4, beatType: 4, length: 4 };
    const beatQ = 4 / first.beatType;
    const countInSec = settings.countIn ? first.beats * beatQ * secPerQuarter : 0;
    const startAudio = ctx.currentTime + 0.2 + countInSec;
    const ts = ctx.getOutputTimestamp?.();
    const perfAtCtx = ts && ts.performanceTime ? ts.performanceTime + (startAudio - ts.contextTime) * 1000 : performance.now() + (startAudio - ctx.currentTime) * 1000;
    this.startPerf = perfAtCtx;
    this.audio.startClicks(this.#scheduleEvents(startAudio, secPerQuarter, settings, countInSec, first)[Symbol.iterator]());
    this.state = countInSec ? 'countin' : 'running';
    this.onState?.(this.state, countInSec ? 'Count-in…' : 'Go!');
    const loop = () => {
      const t = (performance.now() - this.startPerf) / 1000;
      if (this.state === 'countin' && t >= 0) {
        this.state = 'running';
        this.onState?.('running', 'Playing at fixed tempo.');
      }
      this.#handle(this.matcher.tick(t));
      if (this.state !== 'idle') this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Play the score through the synth with the cursor following, from a cursor position (default: navPos). */
  listen(settings, { from = this.navPos } = {}) {
    if (!this.timeline) return;
    this.stop();
    this.settings = settings;
    this.view.clearColors();
    const ctx = this.audio.ensure();
    const spq = 60 / settings.bpm;
    const startStep = this.timeline.steps.find((s) => s.pos >= (from || 0)) || this.timeline.steps[0];
    if (!startStep) return;
    const t0 = startStep.time;
    this.view.cursorTo(startStep.pos);
    const start = ctx.currentTime + 0.3;
    this.listenStart = { audio: start, t0, spq };
    const events = [];
    for (const step of this.timeline.steps) {
      if (step.time < t0 - 1e-6) continue;
      const time = start + (step.time - t0) * spq;
      events.push({
        time,
        click: false,
        onTime: () => setTimeout(() => {
          if (this.state !== 'listening') return;
          this.view.cursorTo(step.pos);
          this.listenPos = step.pos;
        }, (time - ctx.currentTime) * 1000),
      });
      for (const n of step.notes) events.push({ time, click: false, onTime: (t) => this.audio.playNote(n.midi, t, Math.max(0.1, n.duration * spq * 0.95)) });
    }
    if (settings.metronome) events.push(...this.#beatClicks(start - t0 * spq, spq).filter((e) => e.time >= start - 1e-6));
    const endTime = start + (this.timeline.end - t0) * spq;
    events.push({ time: endTime, click: false, onTime: () => setTimeout(() => this.state === 'listening' && this.stop('Finished listening.'), (endTime - ctx.currentTime) * 1000) });
    events.sort((a, b) => a.time - b.time);
    this.state = 'listening';
    this.listenPos = startStep.pos;
    this.onState?.('listening', 'Listening…');
    this.audio.startClicks(events[Symbol.iterator]());
  }

  stop(message) {
    cancelAnimationFrame(this.raf);
    this.audio.stopClicks();
    const was = this.state;
    this.state = 'idle';
    this.keyboard?.setHints([]);
    if (was !== 'idle') this.onState?.('idle', message || 'Stopped.');
  }

  /** Stop, and when already stopped, rewind the cursor to the beginning (like a DAW's stop button). */
  stopOrRewind() {
    if (this.state !== 'idle') return this.stop();
    this.rewind();
  }

  rewind() {
    this.navPos = null;
    this.view.resetCursor();
    this.view.clearColors();
    this.onState?.('idle', 'Back at the beginning.');
  }

  /**
   * Move one note forward (+1) or back (-1): moves the cursor when idle, jumps playback when listening,
   * and skips or repeats a step when practising in free tempo.
   */
  step(delta) {
    if (!this.timeline) return;
    if (this.state === 'running' && this.settings.mode === 'wait') {
      this.#handle(this.matcher.jumpTo(this.matcher.index + delta));
      return;
    }
    if (this.state === 'countin' || this.state === 'running') {
      this.onState?.(this.state, 'Stop first to move the cursor in fixed-tempo mode.');
      return;
    }
    const stops = this.notePositions;
    if (!stops.length) return;
    const cur = this.state === 'listening' ? this.listenPos : (this.navPos ?? this.view.pos);
    let i = stops.findIndex((p) => p >= cur);
    if (i < 0) i = stops.length - 1;
    if (delta > 0) i = stops[i] > cur ? i : i + 1;
    else i -= 1;
    i = Math.max(0, Math.min(stops.length - 1, i));
    this.navPos = stops[i];
    if (this.state === 'listening') {
      this.listen(this.settings, { from: this.navPos });
      return;
    }
    this.view.cursorTo(this.navPos);
    const step = this.timeline.steps.find((s) => s.pos === this.navPos);
    this.keyboard.setHints(step ? step.notes : []);
    this.onState?.('idle', `Note ${i + 1} of ${stops.length} — Start plays from here.`);
  }

  /** Live toggle of the metronome while playing. */
  setMetronome(on) {
    if (this.settings) this.settings.metronome = on;
    if (this.state === 'running' && this.settings?.mode === 'wait') {
      this.audio.stopClicks();
      if (on) this.#startFreeMetronome(60 / this.settings.bpm);
    }
  }

  /**
   * Tempo change (e.g. from a fader): applies immediately to the free-tempo metronome and to listening
   * (playback continues from the current note); fixed-tempo practice picks it up at the next start.
   */
  setTempo(bpm) {
    if (!this.settings) return;
    const old = this.settings.bpm;
    this.settings.bpm = bpm;
    if (this.state === 'running' && this.settings.mode === 'wait' && this.settings.metronome) {
      this.audio.stopClicks();
      this.#startFreeMetronome(60 / bpm);
    } else if (this.state === 'listening' && Math.abs(old - bpm) >= 1) {
      clearTimeout(this.tempoTimer);
      this.tempoTimer = setTimeout(() => this.state === 'listening' && this.listen(this.settings, { from: this.listenPos }), 250);
    }
  }

  setHints(on) {
    if (this.settings) this.settings.hints = on;
    this.#updateHints();
  }

  /** A played note. `source` 'audio' marks pitch-detected notes (guitar or piano; chords are checked via onset()). */
  noteOn(midi, perfTime, source) {
    if (!this.matcher || (this.state !== 'running' && this.state !== 'countin')) return;
    if (source === 'audio' && this.#expectedChord(perfTime)) return;
    this.#handle(this.matcher.noteOn(midi, this.#t(perfTime)));
  }

  /**
   * Audio input onset (pick or hammer attack). Monophonic pitch tracking can't hear chords, so when a chord is expected we ask
   * the audio input whether its notes are sounding and count the ones that are.
   * @param verify async (midis) => { present: [midi], ambiguous?: [midi] } (ambiguous notes are accepted)
   */
  async onset(perfTime, verify) {
    if (!this.matcher || (this.state !== 'running' && this.state !== 'countin')) return;
    const notes = this.#expectedChord(perfTime);
    if (!notes) return;
    const t = this.#t(perfTime);
    const matcher = this.matcher;
    const result = await verify(notes.map((n) => n.midi));
    if (matcher !== this.matcher) return; // restarted meanwhile
    for (const m of new Set([...result.present, ...(result.ambiguous || [])])) this.#handle(this.matcher.noteOn(m, t));
  }

  // ------------------------------------------------------------ internals

  #t(perfTime) {
    return this.settings.mode === 'tempo' ? (perfTime - this.startPerf - (this.settings.latencyMs || 0)) / 1000 : 0;
  }

  /** The chord (step with 2+ notes) expected at this time, or null. */
  #expectedChord(perfTime) {
    if (this.settings.mode === 'wait') {
      const pending = this.matcher.pendingNotes;
      return this.matcher.currentStep?.notes.length > 1 ? pending : null;
    }
    const t = this.#t(perfTime);
    const step = this.matcher.steps.find((s) => Math.abs(s.time * this.matcher.secPerQuarter - t) <= this.matcher.tolerance);
    return step && step.notes.length > 1 ? step.notes : null;
  }

  #handle(events) {
    if (!events.length) return;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          let c = COLORS.good;
          if (this.settings.mode === 'tempo' && Math.abs(e.offset) > this.matcher.tolerance / 2) c = COLORS.sloppy;
          this.view.color(e.note.ids, c);
          break;
        }
        case 'wrong':
          this.keyboard.flash(e.midi, 'wrong');
          if (this.settings.mode === 'wait') this.stepHadError = true;
          break;
        case 'miss':
          this.view.color(e.note.ids, COLORS.missed);
          break;
        case 'step':
          if (this.settings.mode === 'wait') {
            if (this.stepHadError) {
              const prev = this.matcher.steps[e.step - 1];
              prev?.notes.forEach((n) => this.view.color(n.ids, COLORS.sloppy));
            }
            this.stepHadError = false;
          }
          this.view.cursorTo(e.pos);
          this.#updateHints();
          break;
        case 'done':
          if (this.settings.mode === 'wait' && this.stepHadError) {
            this.matcher.steps.at(-1)?.notes.forEach((n) => this.view.color(n.ids, COLORS.sloppy));
          }
          this.#finish();
          break;
        default:
      }
    }
    this.#emitStats();
  }

  #finish() {
    const summary = this.matcher.summary();
    summary.bpm = this.settings.bpm;
    this.navPos = null;
    this.stop('Finished!');
    this.onFinish?.(summary);
  }

  #emitStats() {
    if (this.matcher) this.onStats?.(this.matcher.summary());
  }

  #updateHints() {
    if (!this.keyboard) return;
    const show = this.settings?.hints && this.state !== 'idle' && this.matcher;
    if (!show) return this.keyboard.setHints([]);
    if (this.settings.mode === 'wait') this.keyboard.setHints(this.matcher.pendingNotes);
    else {
      const s = this.matcher.steps[Math.max(0, this.matcher.stepCursor + 1)];
      this.keyboard.setHints(s ? s.notes : []);
    }
  }

  /** Metronome clicks for every beat of every measure, from the timeline's time signatures. */
  #beatClicks(start, spq) {
    const out = [];
    for (const m of this.timeline.measures) {
      const beatQ = 4 / m.beatType;
      const n = Math.max(1, Math.round(m.length / beatQ));
      for (let b = 0; b < n; b++) {
        out.push({ time: start + (m.time + b * beatQ) * spq, accent: b === 0 && m.length >= m.beats * beatQ - 1e-6, metro: true });
      }
    }
    return out;
  }

  #scheduleEvents(start, spq, settings, countInSec, first) {
    const events = [];
    const t0 = this.t0 || 0;
    if (countInSec) {
      const beatSec = (4 / first.beatType) * spq;
      for (let b = 0; b < first.beats; b++) events.push({ time: start - countInSec + b * beatSec, accent: b === 0, countIn: true });
    }
    events.push(...this.#beatClicks(start - t0 * spq, spq).filter((e) => e.time >= start - 1e-6));
    if (settings.playOthers && settings.requiredStaves) {
      for (const step of this.timeline.steps) {
        if (step.time < t0 - 1e-6) continue;
        for (const n of step.notes) {
          if (settings.requiredStaves.has(n.staff)) continue;
          events.push({ time: start + (step.time - t0) * spq, click: false, onTime: (t) => this.audio.playNote(n.midi, t, Math.max(0.1, n.duration * spq * 0.95)) });
        }
      }
    }
    events.sort((a, b) => a.time - b.time);
    // Metronome clicks honour the live toggle; count-in always clicks.
    const self = this;
    return {
      *[Symbol.iterator]() {
        for (const e of events) {
          if (e.metro) yield { ...e, click: self.settings.metronome };
          else yield e;
        }
      },
    };
  }

  #startFreeMetronome(spq) {
    const first = this.timeline.measures[0] || { beats: 4, beatType: 4 };
    const beatSec = (4 / first.beatType) * spq;
    const start = this.audio.now + 0.1;
    const beats = first.beats;
    this.audio.startClicks((function* gen() {
      for (let i = 0; ; i++) yield { time: start + i * beatSec, accent: i % beats === 0 };
    }()));
  }
}
