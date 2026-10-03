// Web MIDI input/output. Emits note events from hardware inputs, and from virtual sources
// (on-screen keyboard, computer keyboard) through inject(). Also decodes controller messages:
// control changes, program changes, and transport buttons sent as MIDI real-time messages
// (Start/Continue/Stop) or as MIDI Machine Control (MMC) SysEx.

// MMC command byte -> transport action.
const MMC = { 1: 'stop', 2: 'play', 3: 'play', 4: 'forward', 5: 'rewind', 6: 'record', 9: 'pause' };
const REALTIME = { 0xfa: 'play', 0xfb: 'play', 0xfc: 'stop' };

export class MidiManager {
  constructor() {
    this.access = null;
    this.inputId = 'all';
    this.outputId = '';
    this.listeners = {};
    this.status = 'uninitialized';
    this.sustain = false;
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  #emit(type, detail) {
    for (const fn of this.listeners[type] || []) fn(detail);
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      this.status = 'unsupported';
      this.#emit('devices', this.devices());
      return;
    }
    try {
      // SysEx is needed for MMC transport buttons; fall back to plain MIDI if it is refused.
      try {
        this.access = await navigator.requestMIDIAccess({ sysex: true });
        this.sysex = true;
      } catch {
        this.access = await navigator.requestMIDIAccess({ sysex: false });
        this.sysex = false;
      }
      this.status = 'ready';
      this.access.onstatechange = () => this.#attach();
      this.#attach();
    } catch (err) {
      this.status = 'denied';
      console.warn('MIDI access failed', err);
      this.#emit('devices', this.devices());
    }
  }

  devices() {
    const list = (m) => (m ? [...m.values()].map((d) => ({ id: d.id, name: d.name, state: d.state })) : []);
    return { status: this.status, inputs: list(this.access?.inputs), outputs: list(this.access?.outputs) };
  }

  setInput(id) {
    this.inputId = id;
    this.#attach();
  }

  setOutput(id) {
    this.outputId = id;
  }

  #attach() {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      const active = this.inputId === 'all' || this.inputId === input.id;
      input.onmidimessage = active ? (e) => this.#onMessage(e) : null;
    }
    this.#emit('devices', this.devices());
  }

  #onMessage(e) {
    const data = e.data;
    const [status, d1, d2] = data;
    const time = e.timeStamp || performance.now();
    if (status >= 0xf0) {
      if (REALTIME[status]) this.#emit('control', { type: 'transport', action: REALTIME[status], source: 'realtime', time });
      // MMC: F0 7F <device> 06 <command> F7
      else if (status === 0xf0 && data[1] === 0x7f && data[3] === 0x06 && MMC[data[4]]) {
        this.#emit('control', { type: 'transport', action: MMC[data[4]], source: 'mmc', time });
      }
      return; // clock, active sensing and other system messages are ignored
    }
    const cmd = status & 0xf0;
    const channel = status & 0x0f;
    if (cmd === 0x90 && d2 > 0) this.#emit('noteon', { midi: d1, velocity: d2, channel, time, source: 'midi' });
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this.#emit('noteoff', { midi: d1, channel, time, source: 'midi' });
    else if (cmd === 0xb0) {
      if (d1 === 64) this.sustain = d2 >= 64;
      this.#emit('cc', { controller: d1, value: d2, channel, time });
      this.#emit('control', { type: 'cc', controller: d1, value: d2, channel, time });
    } else if (cmd === 0xc0) {
      this.#emit('control', { type: 'program', program: d1, channel, time });
    }
  }

  /** Feed a note from a non-MIDI source (on-screen or computer keyboard). */
  inject(midi, on, velocity = 90, source = 'virtual') {
    const time = performance.now();
    if (on) this.#emit('noteon', { midi, velocity, channel: 0, time, source });
    else this.#emit('noteoff', { midi, channel: 0, time, source });
  }

  /** Send raw bytes to the selected output (reserved for controlling the keyboard later). */
  send(bytes, timestamp) {
    const out = this.outputId && this.access?.outputs.get(this.outputId);
    if (out) out.send(bytes, timestamp);
    return Boolean(out);
  }

  sendNote(midi, on, velocity = 80, channel = 0) {
    return this.send([(on ? 0x90 : 0x80) | channel, midi, on ? velocity : 0]);
  }
}

/** Computer-keyboard piano: two rows mapped like a DAW (A = C, W = C#, ...). Z/X shift octaves. */
export function attachComputerKeyboard(midi, getEnabled) {
  const map = 'awsedftgyhujkolp;\''.split('');
  let base = 60;
  const held = new Map();
  const isTyping = (e) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'checkbox';
  window.addEventListener('keydown', (e) => {
    if (!getEnabled() || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { base = Math.max(24, base - 12); return; }
    if (k === 'x') { base = Math.min(96, base + 12); return; }
    const i = map.indexOf(k);
    if (i < 0 || e.repeat || held.has(k)) return;
    e.preventDefault();
    held.set(k, base + i);
    midi.inject(base + i, true, 90, 'computer');
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (!held.has(k)) return;
    midi.inject(held.get(k), false, 0, 'computer');
    held.delete(k);
  });
}
