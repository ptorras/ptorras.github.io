// Guitar tuner panel: note + octave, a cents needle with an in-tune zone, a strobe band, the frequency, the strings
// of the current tuning (nearest one highlighted, click to lock), and an input level meter.
// Reads 'pitch', 'level' and 'status' events from ctx.guitarInput (js/io/guitarinput.js).

import { h } from './panel.js';

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const nameOf = (m) => NAMES[((m % 12) + 12) % 12];
const octaveOf = (m) => Math.floor(m / 12) - 1;
const freqOf = (m, a4) => a4 * 2 ** ((m - 69) / 12);
const STANDARD = [40, 45, 50, 55, 59, 64];

let cssAdded = false;
function addCss() {
  if (cssAdded || document.querySelector('link[data-tuner-css]')) return;
  cssAdded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../css/tuner.css', import.meta.url).href;
  link.dataset.tunerCss = '';
  document.head.appendChild(link);
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1];
};

export const tunerPanel = {
  id: 'g-tuner',
  label: 'Tuner',
  description: 'Tune your guitar through the audio input. Click a string to lock the tuner to it.',
  instrument: 'guitar',
  kind: 'panel',
  options: [
    {
      id: 'a4', label: 'A4 reference', type: 'select', default: '440',
      choices: Array.from({ length: 21 }, (_, i) => [String(430 + i), `${430 + i} Hz`]),
    },
    {
      id: 'zone', label: 'In tune within', type: 'select', default: '5',
      choices: [['3', '±3 cents'], ['5', '±5 cents'], ['10', '±10 cents']],
    },
  ],

  create(ctx) {
    addCss();
    const input = ctx.guitarInput;
    const strings = ctx.tuning?.strings?.length ? ctx.tuning.strings : STANDARD;
    const st = {
      a4: Number(ctx.values?.a4) || 440,
      zone: Number(ctx.values?.zone) || 5,
      lock: null, // locked string midi
      hist: [], // recent pitch readings (midi float)
      shown: null, // smoothed midi float on display
      lastPitch: 0, // performance.now() of the last reading
      level: -100,
      strobe: 0,
      raf: 0,
      lastFrame: performance.now(),
    };
    if (input) input.a4 = st.a4;

    // ------------------------------------------------------------ DOM
    const noteName = h('span', { class: 'tn-name' }, '–');
    const noteOct = h('span', { class: 'tn-oct' }, '');
    const centsText = h('div', { class: 'tn-cents' }, 'Play a string');
    const needle = h('div', { class: 'tn-needle' });
    const zoneEl = h('div', { class: 'tn-zone' });
    const ticks = h('div', { class: 'tn-ticks' },
      [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map((c) => h('span', { class: c % 50 === 0 || c === 0 ? 'major' : '', style: { left: `${50 + c}%` } },
        h('i'), c % 25 === 0 || c === 0 ? h('b', {}, c > 0 ? `+${c}` : String(c)) : null)));
    const scale = h('div', { class: 'tn-scale' }, zoneEl, ticks, needle);
    const strobe = h('div', { class: 'tn-strobe', title: 'Strobe: stripes stand still when in tune' });
    const freqText = h('div', { class: 'tn-freq' }, '');
    const flat = h('span', { class: 'tn-dir tn-flat' }, '♭');
    const sharp = h('span', { class: 'tn-dir tn-sharp' }, '♯');
    const display = h('div', { class: 'tn-display idle' },
      h('div', { class: 'tn-notewrap' }, flat, h('div', { class: 'tn-note' }, noteName, noteOct), sharp),
      centsText, scale, strobe, freqText);

    const autoBtn = h('button', { class: 'tn-string tn-auto active', onclick: () => setLock(null), title: 'Follow the nearest string' }, 'Auto');
    const stringBtns = strings.map((m, i) => h('button', {
      class: 'tn-string',
      title: `String ${strings.length - i}: ${nameOf(m)}${octaveOf(m)} (${freqOf(m, st.a4).toFixed(2)} Hz). Click to lock.`,
      onclick: () => setLock(st.lock === m ? null : m),
    }, h('span', { class: 'sn' }, nameOf(m)), h('span', { class: 'so' }, String(octaveOf(m)))));
    const stringRow = h('div', { class: 'tn-strings' }, h('span', { class: 'tn-label' }, ctx.tuning?.label || 'Standard'), ...stringBtns, autoBtn);

    const levelBar = h('div', { class: 'tn-level-bar' });
    const levelText = h('span', { class: 'tn-level-db' }, '');
    const levelRow = h('div', { class: 'tn-level' }, h('span', { class: 'tn-label' }, 'Input'), h('div', { class: 'tn-level-track' }, levelBar), levelText);

    const msgText = h('p', {}, '');
    const startBtn = h('button', { class: 'primary', onclick: startInput }, 'Start input');
    const msg = h('div', { class: 'tn-msg' },
      h('div', { class: 'tn-msg-icon' }, '♪'),
      h('h3', {}, 'Guitar input is off'),
      msgText,
      startBtn);

    const root = h('div', { class: 'tuner' }, msg, h('div', { class: 'tn-body' }, display, stringRow, levelRow));
    ctx.container.append(root);

    // ------------------------------------------------------------ state

    function setLock(m) {
      st.lock = m;
      st.hist = [];
      st.shown = null;
      stringBtns.forEach((b, i) => b.classList.toggle('locked', strings[i] === m));
      autoBtn.classList.toggle('active', m === null);
    }

    async function startInput() {
      if (!input) return;
      startBtn.disabled = true;
      await input.start();
      startBtn.disabled = false;
    }

    function showStatus() {
      const state = input ? input.state : 'none';
      const on = state === 'on';
      msg.hidden = on;
      root.classList.toggle('off', !on);
      startBtn.hidden = !input || state === 'starting';
      const title = msg.querySelector('h3');
      if (!input) {
        title.textContent = 'Guitar input not available';
        msgText.textContent = 'This browser can’t capture audio input. Use a recent Chrome, Edge or Firefox on http://localhost.';
      } else if (state === 'starting') {
        title.textContent = 'Starting the input…';
        msgText.textContent = 'If the browser asks, allow access to the microphone / audio interface.';
      } else if (state === 'error') {
        title.textContent = 'The input could not start';
        msgText.textContent = `${input.message} Then choose your interface in the Input selector at the top and switch it on, or try again here.`;
        startBtn.textContent = 'Try again';
      } else {
        title.textContent = 'Guitar input is off';
        msgText.textContent = 'Plug your guitar into your audio interface, choose the interface in the Input selector at the top '
          + 'and switch the input on. Or start it here with the default input.';
        startBtn.textContent = 'Start input';
      }
    }

    const offs = [];
    if (input) {
      offs.push(input.on('status', showStatus));
      offs.push(input.on('pitch', (p) => {
        if (p.clarity < 0.85) return;
        st.hist.push(p.midi);
        if (st.hist.length > 7) st.hist.shift();
        // A jump to another note resets the history so the display follows quickly.
        if (st.shown !== null && Math.abs(p.midi - st.shown) > 0.7) st.hist = [p.midi];
        st.lastPitch = performance.now();
      }));
      offs.push(input.on('level', (l) => { st.level = l.db; }));
    }
    showStatus();

    // ------------------------------------------------------------ render loop

    function render() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - st.lastFrame) / 1000);
      st.lastFrame = now;
      const fresh = now - st.lastPitch < 600;
      if (fresh && st.hist.length) {
        const m = median(st.hist);
        st.shown = st.shown === null || Math.abs(m - st.shown) > 0.7 ? m : st.shown + (m - st.shown) * Math.min(1, dt * 12);
      }
      const active = st.shown !== null && now - st.lastPitch < 1500;
      display.classList.toggle('idle', !active);
      if (st.shown !== null) {
        const midiF = st.shown;
        const target = st.lock ?? Math.round(midiF);
        const cents = (midiF - target) * 100;
        const inTune = Math.abs(cents) <= st.zone;
        noteName.textContent = nameOf(target);
        noteOct.textContent = String(octaveOf(target));
        const c = Math.max(-50, Math.min(50, cents));
        needle.style.left = `${50 + c}%`;
        display.classList.toggle('intune', active && inTune);
        flat.classList.toggle('on', active && cents < -st.zone);
        sharp.classList.toggle('on', active && cents > st.zone);
        const r = Math.round(cents);
        centsText.textContent = !active ? 'Play a string'
          : inTune ? 'In tune'
            : Math.abs(cents) > 100 ? `${cents < 0 ? 'Tune up' : 'Tune down'} · playing ${nameOf(Math.round(midiF))}${octaveOf(Math.round(midiF))}`
              : Math.abs(cents) > 50 ? (cents < 0 ? `Tune up (${r} cents)` : `Tune down (+${r} cents)`)
              : `${r > 0 ? '+' : ''}${r} cents`;
        const hz = freqOf(midiF, st.a4);
        freqText.textContent = `${hz.toFixed(1)} Hz · target ${freqOf(target, st.a4).toFixed(2)} Hz`;
        if (active) st.strobe += Math.max(-60, Math.min(60, cents)) * dt * 4;
        strobe.style.backgroundPositionX = `${st.strobe.toFixed(1)}px`;
        // Nearest string (or the locked one).
        let near = st.lock;
        if (near === null && active) {
          let best = 2.5;
          for (const s of strings) if (Math.abs(midiF - s) < best) { best = Math.abs(midiF - s); near = s; }
        }
        stringBtns.forEach((b, i) => {
          b.classList.toggle('active', strings[i] === near);
          b.classList.toggle('good', strings[i] === near && active && Math.abs((midiF - strings[i]) * 100) <= st.zone);
        });
      }
      const lv = Math.max(0, Math.min(1, (st.level + 60) / 60));
      levelBar.style.width = `${(lv * 100).toFixed(1)}%`;
      levelBar.classList.toggle('hot', st.level > -3);
      levelText.textContent = st.level > -99 ? `${Math.round(st.level)} dB` : '';
      st.level = Math.max(-100, st.level - dt * 30); // meter falls back between level events
      st.raf = requestAnimationFrame(render);
    }
    zoneEl.style.left = `${50 - st.zone}%`;
    zoneEl.style.width = `${2 * st.zone}%`;
    st.raf = requestAnimationFrame(render);

    return {
      onOptions(values) {
        st.a4 = Number(values.a4) || 440;
        st.zone = Number(values.zone) || 5;
        if (input) input.a4 = st.a4;
        zoneEl.style.left = `${50 - st.zone}%`;
        zoneEl.style.width = `${2 * st.zone}%`;
        stringBtns.forEach((b, i) => {
          const m = strings[i];
          b.title = `String ${strings.length - i}: ${nameOf(m)}${octaveOf(m)} (${freqOf(m, st.a4).toFixed(2)} Hz). Click to lock.`;
        });
        st.hist = [];
      },
      destroy() {
        cancelAnimationFrame(st.raf);
        offs.forEach((off) => off());
        root.remove();
      },
    };
  },
};
