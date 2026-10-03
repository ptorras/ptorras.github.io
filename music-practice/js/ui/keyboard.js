// On-screen 88-key piano: shows pressed keys, hints and feedback; clickable as an input.

import { isBlackKey } from '../core/theory.js';

const LOW = 21;
const HIGH = 108;

export class PianoKeyboard {
  constructor(container, { onNote } = {}) {
    this.el = document.createElement('div');
    this.el.className = 'piano';
    this.keys = new Map();
    const whites = [];
    for (let m = LOW; m <= HIGH; m++) if (!isBlackKey(m)) whites.push(m);
    const w = 100 / whites.length;
    let wi = 0;
    for (let m = LOW; m <= HIGH; m++) {
      const k = document.createElement('div');
      k.dataset.midi = m;
      if (isBlackKey(m)) {
        k.className = 'key black';
        k.style.left = `${wi * w - w * 0.3}%`;
        k.style.width = `${w * 0.6}%`;
      } else {
        k.className = 'key white';
        k.style.left = `${wi * w}%`;
        k.style.width = `${w}%`;
        if (m % 12 === 0) k.innerHTML = `<span>C${m / 12 - 1}</span>`;
        wi++;
      }
      this.keys.set(m, k);
      this.el.appendChild(k);
    }
    container.appendChild(this.el);
    this.container = container;

    // Pointer input
    let down = null;
    const release = () => {
      if (down !== null) onNote?.(down, false);
      down = null;
    };
    this.el.addEventListener('pointerdown', (e) => {
      const k = e.target.closest('.key');
      if (!k) return;
      e.preventDefault();
      down = +k.dataset.midi;
      onNote?.(down, true);
    });
    this.release = release;
    window.addEventListener('pointerup', release);
    this.el.addEventListener('pointerleave', release);
    this.el.addEventListener('pointercancel', release); // the touch turned into a sideways swipe (narrow screens)
    requestAnimationFrame(() => this.reveal([60], { center: true }));
  }

  setPressed(midi, on) {
    this.keys.get(midi)?.classList.toggle('pressed', on);
    if (on) this.reveal([midi], { margin: 0 });
  }

  /**
   * On narrow screens the keyboard scrolls sideways (see the compact layout in app.css): scroll so these notes
   * are visible, `margin` pixels away from the edges (or centred).
   */
  reveal(midis, { margin = 24, center = false } = {}) {
    const c = this.container;
    if (c.scrollWidth <= c.clientWidth) return;
    const keys = midis.map((m) => this.keys.get(m)).filter(Boolean);
    if (!keys.length) return;
    const left = this.el.offsetLeft + Math.min(...keys.map((k) => k.offsetLeft));
    const right = this.el.offsetLeft + Math.max(...keys.map((k) => k.offsetLeft + k.offsetWidth));
    if (!center && left >= c.scrollLeft + margin && right <= c.scrollLeft + c.clientWidth - margin) return;
    c.scrollTo({ left: (left + right - c.clientWidth) / 2, behavior: center ? 'auto' : 'smooth' });
  }

  /** items: MIDI numbers or { midi } objects. */
  setHints(items) {
    for (const k of this.el.querySelectorAll('.hint')) k.classList.remove('hint');
    const midis = items.map((it) => (typeof it === 'number' ? it : it.midi));
    for (const m of midis) this.keys.get(m)?.classList.add('hint');
    this.reveal(midis);
  }

  flash(midi, cls = 'wrong', ms = 350) {
    const k = this.keys.get(midi);
    if (!k) return;
    k.classList.add(cls);
    setTimeout(() => k.classList.remove(cls), ms);
  }

  destroy() {
    window.removeEventListener('pointerup', this.release);
    this.el.remove();
  }

  clear() {
    for (const k of this.keys.values()) k.classList.remove('pressed', 'hint', 'wrong', 'good');
  }
}
