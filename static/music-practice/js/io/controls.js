// MIDI controller mapping: binds keyboard faders and buttons to app actions, with MIDI learn.
//
// A binding is one of
//   { type: 'cc', controller, channel? }        a control change (fader, knob or button); channel null = any
//   { type: 'transport', action }               a transport button sent as real-time or MMC ('play', 'stop',
//                                               'forward', 'rewind', 'record', 'pause')
//   { type: 'program', program, channel? }      a program change (some keyboards' pads/buttons)
// Buttons fire on a CC value > 0 (release messages with value 0 are ignored); faders map 0-127 to a range.

export const CONTROL_ACTIONS = [
  { id: 'play', label: 'Start', kind: 'button' },
  { id: 'stop', label: 'Stop', kind: 'button' },
  { id: 'forward', label: 'Next note', kind: 'button' },
  { id: 'back', label: 'Previous note', kind: 'button' },
  { id: 'listen', label: 'Listen', kind: 'button' },
  { id: 'restart', label: 'Back to start', kind: 'button' },
  { id: 'next', label: 'New exercise', kind: 'button' },
  { id: 'metronome', label: 'Metronome on/off', kind: 'button' },
  { id: 'tempo', label: 'Tempo', kind: 'fader', min: 30, max: 240 },
  { id: 'zoom', label: 'Zoom', kind: 'fader', min: 0.5, max: 1.6 },
];

export const DEFAULT_BINDINGS = {
  play: [{ type: 'transport', action: 'play' }],
  stop: [{ type: 'transport', action: 'stop' }, { type: 'transport', action: 'pause' }],
  forward: [{ type: 'transport', action: 'forward' }],
  back: [{ type: 'transport', action: 'rewind' }],
  listen: [],
  restart: [],
  next: [],
  metronome: [],
  tempo: [{ type: 'cc', controller: 12, channel: null }],
  zoom: [{ type: 'cc', controller: 13, channel: null }],
};

const TRANSPORT_NAMES = { play: 'Play', stop: 'Stop', forward: 'Fast forward', rewind: 'Rewind', record: 'Record', pause: 'Pause' };

/** Human-readable binding, e.g. "CC 12", "CC 20 (ch 2)", "Play button". */
export function bindingLabel(b) {
  if (b.type === 'cc') return `CC ${b.controller}${b.channel != null ? ` (ch ${b.channel + 1})` : ''}`;
  if (b.type === 'program') return `Program ${b.program + 1}${b.channel != null ? ` (ch ${b.channel + 1})` : ''}`;
  if (b.type === 'transport') return `${TRANSPORT_NAMES[b.action] || b.action} button`;
  return '?';
}

const matches = (b, m) => b.type === m.type && (
  (b.type === 'cc' && b.controller === m.controller && (b.channel == null || b.channel === m.channel))
  || (b.type === 'program' && b.program === m.program && (b.channel == null || b.channel === m.channel))
  || (b.type === 'transport' && b.action === m.action));

export class ControllerMap {
  /**
   * @param bindings persisted bindings object (action id -> [binding]); missing actions get defaults
   * @param onAction (actionId, value) => void; value is the mapped fader value for faders
   * @param onChange () => void, called when bindings change (to persist them) or learning starts/stops
   */
  constructor(bindings, { onAction, onChange }) {
    this.bindings = bindings;
    for (const a of CONTROL_ACTIONS) if (!Array.isArray(this.bindings[a.id])) this.bindings[a.id] = [...DEFAULT_BINDINGS[a.id]];
    this.onAction = onAction;
    this.onChange = onChange;
    this.learning = null;
    this.lastFire = new Map();
  }

  /** Feed a decoded controller message from MidiManager ('control' event). */
  handle(msg) {
    if (this.learning) {
      const action = CONTROL_ACTIONS.find((a) => a.id === this.learning);
      // Faders can only learn CCs; a button learns the first press (ignore CC releases).
      if (action.kind === 'fader' && msg.type !== 'cc') return;
      if (msg.type === 'cc' && action.kind === 'button' && msg.value === 0) return;
      const b = msg.type === 'cc' ? { type: 'cc', controller: msg.controller, channel: msg.channel }
        : msg.type === 'program' ? { type: 'program', program: msg.program, channel: msg.channel }
          : { type: 'transport', action: msg.action };
      // A control can only drive one action.
      for (const id of Object.keys(this.bindings)) this.bindings[id] = this.bindings[id].filter((x) => !matches(x, { ...b, value: 1 }));
      this.bindings[this.learning] = [b];
      this.learning = null;
      this.onChange?.();
      return;
    }
    for (const a of CONTROL_ACTIONS) {
      if (!this.bindings[a.id].some((b) => matches(b, msg))) continue;
      if (a.kind === 'fader') {
        this.onAction(a.id, a.min + (msg.value / 127) * (a.max - a.min));
      } else {
        if (msg.type === 'cc' && msg.value === 0) continue;
        // Some controllers send both MMC and real-time messages for one press: fire once.
        const now = performance.now();
        if (this.lastFire.has(a.id) && now - this.lastFire.get(a.id) < 120) continue;
        this.lastFire.set(a.id, now);
        this.onAction(a.id);
      }
    }
  }

  /** Start learning a binding for an action; the next controller message is assigned to it. */
  learn(actionId) {
    this.learning = this.learning === actionId ? null : actionId;
    this.onChange?.();
  }

  clear(actionId) {
    this.bindings[actionId] = [];
    this.onChange?.();
  }

  resetDefaults() {
    for (const a of CONTROL_ACTIONS) this.bindings[a.id] = [...DEFAULT_BINDINGS[a.id]];
    this.learning = null;
    this.onChange?.();
  }
}
