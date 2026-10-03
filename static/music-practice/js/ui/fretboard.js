// On-screen guitar fretboard for the footer (guitar mode): shows pressed notes, hints and feedback; clickable as
// an input. Same API as PianoKeyboard. The SVG is built once per size/tuning; updates only toggle classes.

import { fretboardSVG, fretboardGeometry, PC_NAMES } from '../guitar/diagram.js';

const STATES = ['hint', 'pressed', 'alt', 'good', 'wrong'];
const key = (s, f) => `${s}:${f}`;

export class GuitarFretboard {
  /**
   * @param opts.onNote (midi, on) for clicks/taps
   * @param opts.tuning { strings: [MIDI low→high] }
   * @param opts.toFret highest fret shown (default: 12 to 17 depending on the width)
   */
  constructor(container, { onNote, tuning, toFret = null } = {}) {
    this.onNote = onNote;
    this.tuning = tuning || { strings: [40, 45, 50, 55, 59, 64] };
    this.fixedToFret = toFret;
    this.el = document.createElement('div');
    this.el.className = 'gfb';
    container.appendChild(this.el);
    this.slots = new Map(); // 's:f' -> <g>
    this.hints = []; // [{ midi, string, fret }]
    this.pressed = new Map(); // midi -> [keys]
    this.anchor = null; // fret the hand was last seen around
    this.timers = new Set();
    this.size = '';
    this.render();

    let down = null;
    const release = () => {
      if (down !== null) onNote?.(down, false);
      down = null;
      this.lastClick = null;
    };
    this.el.addEventListener('pointerdown', (e) => {
      const hit = e.target.closest?.('.fb-hit');
      if (!hit) return;
      e.preventDefault();
      const s = +hit.dataset.s;
      const f = +hit.dataset.f;
      down = this.midiAt(s, f);
      this.anchor = f || this.anchor;
      this.lastClick = { midi: down, string: s, fret: f };
      onNote?.(down, true);
    });
    this._release = release;
    window.addEventListener('pointerup', release);
    this.el.addEventListener('pointerleave', release);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(this.el);
    }
  }

  get strings() { return this.tuning.strings.length; }

  /** MIDI note at a string (1 = highest) and fret. */
  midiAt(s, f) { return this.tuning.strings[this.strings - s] + f; }

  /** Every visible position of a MIDI note: [{ string, fret }]. */
  positionsOf(midi) {
    const out = [];
    for (let s = 1; s <= this.strings; s++) {
      const f = midi - this.midiAt(s, 0);
      if (f >= 0 && f <= this.toFret) out.push({ string: s, fret: f });
    }
    return out;
  }

  setTuning(tuning) {
    this.tuning = tuning;
    this.hints = [];
    this.pressed.clear();
    this.size = '';
    this.render();
  }

  /** (Re)build the SVG for the current size and tuning, then re-apply the state. */
  render() {
    const w = this.el.clientWidth || 1000;
    const hgt = this.el.clientHeight || 120;
    const toFret = this.fixedToFret ?? Math.max(12, Math.min(17, Math.floor(w / 62)));
    const sizeKey = `${w}x${hgt}:${toFret}:${this.tuning.strings.join(',')}`;
    if (sizeKey === this.size) return;
    this.size = sizeKey;
    this.toFret = toFret;
    const base = fretboardGeometry({ tuning: this.tuning, toFret, stringSpacing: 17 });
    const width = Math.max(base.H * (w / hgt), 300);
    const marks = [];
    for (let s = 1; s <= this.strings; s++) {
      for (let f = 0; f <= toFret; f++) marks.push({ string: s, fret: f, label: PC_NAMES[this.midiAt(s, f) % 12] });
    }
    this.el.innerHTML = fretboardSVG({ tuning: this.tuning, toFret, marks, width, stringSpacing: 17, hitAreas: true });
    this.slots.clear();
    for (const g of this.el.querySelectorAll('.fb-mark')) this.slots.set(key(+g.dataset.s, +g.dataset.f), g);
    // Hit areas go on top of the marks so a tap always lands on a position.
    const svg = this.el.firstElementChild;
    for (const r of [...svg.querySelectorAll('.fb-hit')]) svg.appendChild(r);
    this.paint();
  }

  /** Re-apply hint/pressed classes after a re-render. */
  paint() {
    for (const g of this.slots.values()) g.classList.remove(...STATES);
    for (const p of this.hints) this.slots.get(key(p.string, p.fret))?.classList.add('hint');
    const pressed = [...this.pressed.keys()];
    this.pressed.clear();
    for (const m of pressed) this.setPressed(m, true);
  }

  /** Most likely position of a note: a hinted one, the clicked one, else the one nearest the hand. */
  bestPosition(midi, near = this.anchor) {
    const hinted = this.hints.find((p) => p.midi === midi);
    if (hinted) return hinted;
    if (this.lastClick?.midi === midi) return this.lastClick;
    const pos = this.positionsOf(midi);
    if (!pos.length) return null;
    const a = near ?? 3;
    const cost = (p) => (p.fret === 0 && a <= 5 ? 0.5 : Math.abs(p.fret - a)) + p.string * 0.01;
    return pos.reduce((b, p) => (cost(p) < cost(b) ? p : b));
  }

  /**
   * A detected or played pitch. Shown solid at its most likely position (the hinted one if any), and as faint
   * rings at its other positions.
   */
  setPressed(midi, on) {
    for (const k of this.pressed.get(midi) || []) this.slots.get(k)?.classList.remove('pressed', 'alt');
    this.pressed.delete(midi);
    if (!on) return;
    const best = this.bestPosition(midi);
    if (!best) return;
    const keys = [key(best.string, best.fret)];
    this.slots.get(keys[0])?.classList.add('pressed');
    for (const p of this.positionsOf(midi)) {
      const k = key(p.string, p.fret);
      if (k === keys[0]) continue;
      this.slots.get(k)?.classList.add('alt');
      keys.push(k);
    }
    this.pressed.set(midi, keys);
    if (best.fret > 0) this.anchor = best.fret;
  }

  /**
   * Hinted notes: MIDI numbers or { midi, string?, fret? } (string 1 = high). Notes without a position are placed
   * on free strings near the other hints (or near the previous hand position).
   */
  setHints(items) {
    for (const p of this.hints) this.slots.get(key(p.string, p.fret))?.classList.remove('hint');
    const list = items.map((it) => (typeof it === 'number' ? { midi: it } : { ...it }));
    const placed = [];
    for (const it of list) {
      if (it.string && it.fret !== undefined && it.fret !== null) {
        placed.push({ midi: it.midi ?? this.midiAt(it.string, it.fret), string: it.string, fret: it.fret });
      }
    }
    const used = new Set(placed.map((p) => p.string));
    const loose = list.filter((it) => !(it.string && it.fret !== undefined && it.fret !== null))
      .sort((a, b) => a.midi - b.midi);
    const grip = loose.length > 1 && loose.length <= this.strings ? this.findGrip(loose.map((it) => it.midi), used) : null;
    if (grip) {
      placed.push(...grip);
      loose.length = 0;
    }
    for (const it of loose) {
      const fretted = placed.filter((p) => p.fret > 0);
      const a = fretted.length ? fretted.reduce((s, p) => s + p.fret, 0) / fretted.length : (this.anchor ?? 3);
      let pos = this.positionsOf(it.midi);
      if (pos.some((p) => !used.has(p.string))) pos = pos.filter((p) => !used.has(p.string));
      if (!pos.length) continue;
      const cost = (p) => (p.fret === 0 && a <= 5 ? 0.5 : Math.abs(p.fret - a)) + p.string * 0.01;
      const best = pos.reduce((b, p) => (cost(p) < cost(b) ? p : b));
      placed.push({ midi: it.midi, ...best });
      used.add(best.string);
    }
    this.hints = placed;
    for (const p of placed) this.slots.get(key(p.string, p.fret))?.classList.add('hint');
    const fretted = placed.filter((p) => p.fret > 0);
    if (fretted.length) this.anchor = Math.round(fretted.reduce((s, p) => s + p.fret, 0) / fretted.length);
    // A pressed note may now have a hinted position.
    for (const m of [...this.pressed.keys()]) this.setPressed(m, true);
  }

  /**
   * Chord-sized note sets: one note per string, small fret span, close to the hand. Exhaustive search (at most
   * 6 notes x 6 positions). Returns [{ midi, string, fret }] or null when no assignment on free strings exists.
   */
  findGrip(midis, used) {
    const a = this.anchor ?? 3;
    const options = midis.map((m) => this.positionsOf(m).filter((p) => !used.has(p.string)));
    if (options.some((o) => !o.length)) return null;
    let best = null;
    let bestCost = Infinity;
    const pick = [];
    const taken = new Set();
    const visit = (i) => {
      if (i === midis.length) {
        const fretted = pick.filter((p) => p.fret > 0).map((p) => p.fret);
        const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
        const mean = fretted.length ? fretted.reduce((s, f) => s + f, 0) / fretted.length : 0;
        const opens = pick.length - fretted.length;
        const cost = span * 3 + (span > 4 ? 20 : 0) + Math.abs(mean - a) * 0.5 + (mean > 5 ? opens * 3 : 0);
        if (cost < bestCost) { bestCost = cost; best = pick.map((p, k) => ({ midi: midis[k], ...p })); }
        return;
      }
      for (const p of options[i]) {
        if (taken.has(p.string)) continue;
        taken.add(p.string);
        pick.push(p);
        visit(i + 1);
        pick.pop();
        taken.delete(p.string);
      }
    };
    visit(0);
    return best;
  }

  /** Brief feedback class ('wrong' | 'good') on a note's shown position. */
  flash(midi, cls = 'wrong', ms = 350) {
    const keys = this.pressed.get(midi);
    const best = keys ? null : this.bestPosition(midi);
    const k = keys ? keys[0] : best && key(best.string, best.fret);
    const g = k && this.slots.get(k);
    if (!g) return;
    g.classList.add(cls);
    const t = setTimeout(() => { g.classList.remove(cls); this.timers.delete(t); }, ms);
    this.timers.add(t);
  }

  clear() {
    for (const g of this.slots.values()) g.classList.remove(...STATES);
    this.hints = [];
    this.pressed.clear();
  }

  destroy() {
    this.ro?.disconnect();
    window.removeEventListener('pointerup', this._release);
    for (const t of this.timers) clearTimeout(t);
    this.el.remove();
  }
}
