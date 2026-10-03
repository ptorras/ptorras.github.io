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
  }

  setPressed(midi, on) {
    this.keys.get(midi)?.classList.toggle('pressed', on);
  }

  /** items: MIDI numbers or { midi } objects. */
  setHints(items) {
    for (const k of this.el.querySelectorAll('.hint')) k.classList.remove('hint');
    for (const it of items) this.keys.get(typeof it === 'number' ? it : it.midi)?.classList.add('hint');
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
