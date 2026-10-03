// App bootstrap: wires instruments, exercises, panels, score view, MIDI, guitar input, audio and the practice
// session to the UI.
//
// Tabs come in three kinds:
//  - exercise: a generator ({ generate(options, rng, ctx) }) whose score is rendered and practised
//  - file:     a loaded MusicXML score
//  - panel:    a self-contained trainer view (see js/panels/panel.js)
// Modules are loaded lazily, so a missing or broken module only removes its own tab.

import { toMusicXML } from './core/musicxml.js';
import { makeRng, randomSeed } from './core/rng.js';
import { MidiManager, attachComputerKeyboard } from './io/midi.js';
import { AudioEngine } from './io/audio.js';
import { ControllerMap, CONTROL_ACTIONS, bindingLabel } from './io/controls.js';
import { ScoreView } from './ui/scoreview.js';
import { PianoKeyboard } from './ui/keyboard.js';
import { buildForm } from './ui/forms.js';
import { PracticeSession } from './practice/session.js';
import { registerServiceWorker, bindInstallButton, handleLaunchFiles, ScreenWakeLock } from './pwa.js';

const $ = (sel) => document.querySelector(sel);

const FILE_TAB = { id: 'file', label: 'Score file', kind: 'file', instrument: 'both', description: 'Load any MusicXML score. Notes light up as you play them.' };

// [module path, export name, instrument]; order = tab order.
const TAB_MODULES = [
  ['./exercises/sightreading.js', 'sightReadingExercise', 'piano'],
  ['./exercises/scales.js', 'scalesExercise', 'piano'],
  ['./exercises/arpeggios.js', 'arpeggioExercise', 'piano'],
  ['./exercises/warmups.js', 'warmupExercise', 'piano'],
  ['./panels/chordtrainer.js', 'chordTrainerPanel', 'piano'],
  ['./exercises/guitar/sightreading.js', 'guitarSightReadingExercise', 'guitar'],
  ['./exercises/guitar/scales.js', 'guitarScalesExercise', 'guitar'],
  ['./exercises/guitar/arpeggios.js', 'guitarArpeggioExercise', 'guitar'],
  ['./exercises/guitar/chords.js', 'guitarChordsExercise', 'guitar'],
  ['./panels/chordlibrary.js', 'chordLibraryPanel', 'guitar'],
  ['./panels/scalemaps.js', 'scaleMapsPanel', 'guitar'],
  ['./panels/tuner.js', 'tunerPanel', 'guitar'],
  ['./panels/eartraining.js', 'earTrainingPanel', 'both'],
];

const DEFAULT_TUNING = { id: 'standard', label: 'Standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64] };

// ------------------------------------------------------------ persisted settings

const STORE_KEY = 'pianoPractice.settings.v1';
const HISTORY_KEY = 'pianoPractice.history.v1';
const load = (k, d) => {
  try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; }
};
const settings = load(STORE_KEY, {
  instrument: 'piano',
  tab: 'sightreading',
  tabByInstrument: {},
  options: {},
  practice: { mode: 'wait', bpm: 80, metronome: false, countIn: true, tolerance: '150', hints: false, autoNext: true, zoom: 1, latency: 0, others: false, monitor: false, qwerty: false },
  guitar: { tuning: 'standard', device: '', channel: 'mix', enabled: false },
  controls: {},
});
settings.tabByInstrument ||= {};
settings.guitar ||= { tuning: 'standard', device: '', channel: 'mix', enabled: false };
settings.controls ||= {};
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(settings));
let history = [];
try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { history = []; }

// ------------------------------------------------------------ components

const midi = new MidiManager();
const audio = new AudioEngine();
const view = new ScoreView($('#score'));
let instrumentView = null; // PianoKeyboard or GuitarFretboard in the footer
const session = new PracticeSession({
  view, audio, keyboard: null,
  onStats: renderStats,
  onState: (state, msg) => { $('#status').textContent = msg || ''; document.body.dataset.state = state; },
  onFinish: finished,
});

let TABS = [FILE_TAB];
let TUNINGS = { standard: DEFAULT_TUNING };
let guitarInput = null;
let activePanel = null; // { tab, instance }
const current = { seed: null, title: '', file: null };

const currentTab = () => TABS.find((t) => t.id === settings.tab);
const tabsFor = (instrument) => TABS.filter((t) => t.instrument === instrument || t.instrument === 'both');
const currentTuning = () => TUNINGS[settings.guitar.tuning] || TUNINGS.standard || DEFAULT_TUNING;

async function loadModules() {
  const results = await Promise.allSettled(TAB_MODULES.map(async ([path, name, instrument]) => {
    const mod = await import(path);
    if (!mod[name]) throw new Error(`${path} has no export ${name}`);
    const tab = mod[name];
    return { ...tab, kind: tab.kind || (tab.generate ? 'exercise' : 'panel'), instrument: tab.instrument || instrument };
  }));
  const tabs = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') tabs.push(r.value);
    else console.warn(`Tab unavailable: ${TAB_MODULES[i][0]}`, r.reason?.message || r.reason);
  });
  TABS = [...tabs, FILE_TAB];
  try {
    const t = await import('./guitar/tunings.js');
    TUNINGS = t.TUNINGS;
  } catch (err) {
    console.warn('Guitar tunings unavailable', err.message);
  }
}

// ------------------------------------------------------------ instruments

async function setInstrument(instrument) {
  settings.instrument = instrument;
  save();
  document.body.dataset.instrument = instrument;
  document.querySelectorAll('#instrument button').forEach((b) => b.classList.toggle('active', b.dataset.instrument === instrument));
  audio.setTimbre(instrument === 'guitar' ? 'guitar' : 'piano');
  // Panels such as the tuner need the input object (it is only started on request).
  if (instrument === 'guitar') await ensureGuitarInput().catch((err) => console.warn('Guitar input unavailable', err.message));
  await mountInstrumentView();
  const tabs = tabsFor(instrument);
  const want = settings.tabByInstrument[instrument];
  selectTab(tabs.some((t) => t.id === want && t.id !== 'file') ? want : tabs[0].id);
}

async function mountInstrumentView() {
  instrumentView?.destroy?.();
  const footer = $('#keyboard');
  footer.innerHTML = '';
  const onNote = (m, on) => midi.inject(m, on, 90, 'mouse');
  instrumentView = null;
  if (settings.instrument === 'guitar') {
    try {
      const { GuitarFretboard } = await import('./ui/fretboard.js');
      instrumentView = new GuitarFretboard(footer, { onNote, tuning: currentTuning() });
      footer.className = 'keyboard guitar fretboard-footer';
    } catch (err) {
      console.warn('Fretboard unavailable, showing the piano keyboard', err.message);
    }
  }
  if (!instrumentView) {
    instrumentView = new PianoKeyboard(footer, { onNote });
    footer.className = 'keyboard';
  }
  session.keyboard = instrumentView;
}

// ------------------------------------------------------------ tabs

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const t of tabsFor(settings.instrument)) {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.className = t.id === settings.tab ? 'active' : '';
    b.onclick = () => selectTab(t.id);
    nav.appendChild(b);
  }
}

function selectTab(id) {
  const tab = TABS.find((t) => t.id === id) || tabsFor(settings.instrument)[0];
  session.stop();
  hideResult();
  unmountPanel();
  settings.tab = tab.id;
  settings.tabByInstrument[settings.instrument] = tab.id;
  save();
  renderTabs();
  $('#exercise-desc').textContent = tab.description || '';
  const kind = tab.kind;
  document.body.dataset.kind = kind;
  $('#file-panel').hidden = kind !== 'file';
  $('#exercise-form').hidden = kind === 'file';
  $('#practice-section').hidden = kind === 'panel';
  $('#score-wrap').hidden = kind === 'panel';
  $('#panel').hidden = kind !== 'panel';
  $('#btn-generate').hidden = false;
  $('#btn-generate').textContent = kind === 'file' ? 'Reload score' : kind === 'panel' ? 'Next' : 'New exercise';
  $('#seed').textContent = '';
  $('#stats').textContent = '';
  if (kind === 'exercise') {
    const values = (settings.options[tab.id] ||= {});
    buildForm($('#exercise-form'), tab.options, values, () => { save(); generate(); });
    generate();
  } else if (kind === 'file') {
    if (current.file) loadScore(current.file, current.file.name);
    else $('#status').textContent = 'Open or drop a MusicXML file.';
  } else {
    mountPanel(tab);
  }
}

function mountPanel(tab) {
  const values = (settings.options[tab.id] ||= {});
  const container = $('#panel');
  container.innerHTML = '';
  buildForm($('#exercise-form'), tab.options || [], values, () => { save(); activePanel?.instance.onOptions?.(values); });
  const ctx = {
    container,
    values,
    instrument: settings.instrument,
    tuning: currentTuning(),
    audio,
    guitarInput,
    setStatus: (text) => { $('#status').textContent = text; },
    setHints: (items) => instrumentView?.setHints(items || []),
    flash: (m, kind) => instrumentView?.flash(m, kind),
    recordResult: ({ title, correct, total }) => addHistory({
      tab: tab.id, title: title || tab.label, mode: 'panel', acc: total ? Math.round((100 * correct) / total) : 0, correct, total,
    }),
    makeRng,
  };
  $('#status').textContent = '';
  try {
    const instance = tab.create(ctx);
    activePanel = { tab, instance };
    $('#btn-generate').hidden = typeof instance?.next !== 'function';
  } catch (err) {
    console.error(err);
    container.textContent = `Could not open ${tab.label}: ${err.message}`;
  }
}

function unmountPanel() {
  if (!activePanel) return;
  try { activePanel.instance?.destroy?.(); } catch (err) { console.warn(err); }
  activePanel = null;
  instrumentView?.setHints([]);
  $('#panel').innerHTML = '';
}

async function generate(seed = randomSeed()) {
  const ex = currentTab();
  if (!ex || ex.kind !== 'exercise') return;
  let score;
  try {
    score = ex.generate(settings.options[ex.id], makeRng(seed), { tuning: currentTuning(), instrument: settings.instrument });
  } catch (err) {
    console.error(err);
    $('#status').textContent = `Could not create the exercise: ${err.message}`;
    return;
  }
  current.seed = seed;
  $('#seed').textContent = `seed ${seed}`;
  await loadScore(toMusicXML(score), score.title, { generated: true });
}

async function loadScore(content, title, opts) {
  session.stop();
  hideResult();
  try {
    const tl = await view.load(content, +settings.practice.zoom || 1, opts);
    current.title = title;
    session.load(tl);
    renderStaves(tl.staves);
    $('#stats').textContent = '';
    $('#status').textContent = settings.practice.mode === 'wait'
      ? 'Ready — start playing whenever you like.'
      : 'Ready — press Start (or Space) for the count-in.';
  } catch (err) {
    console.error(err);
    $('#status').textContent = `Could not load score: ${err.message || err}`;
  }
}

function renderStaves(staves) {
  const box = $('#staves');
  const prev = settings.practice.staves;
  box.innerHTML = '';
  const generated = settings.tab !== 'file';
  staves.forEach((s) => {
    const l = document.createElement('label');
    l.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = s.index;
    cb.checked = generated || !prev || prev.length !== staves.length || prev[s.index] !== false;
    cb.onchange = () => {
      settings.practice.staves = [...box.querySelectorAll('input')].map((i) => i.checked);
      save();
    };
    let label = s.label;
    if (staves.length === 2 && generated) label = s.index === 0 ? 'Upper staff' : 'Lower staff';
    l.append(cb, document.createTextNode(label));
    box.appendChild(l);
  });
  // A guitar part shown as notation + tab is one line of music: nothing to choose.
  const notationPlusTab = staves.length === 2 && staves.some((s) => s.tab);
  $('#staves-field').hidden = staves.length < 2 || (generated && notationPlusTab);
}

function requiredStaves() {
  const checks = [...$('#staves').querySelectorAll('input')];
  return new Set(checks.filter((c) => c.checked).map((c) => +c.value));
}

// ------------------------------------------------------------ practice controls

function practiceSettings() {
  const p = settings.practice;
  return {
    mode: p.mode,
    bpm: Math.max(20, Math.min(300, +p.bpm || 80)),
    metronome: p.metronome,
    countIn: p.countIn,
    toleranceMs: +p.tolerance,
    latencyMs: +p.latency || 0,
    requiredStaves: requiredStaves(),
    playOthers: p.others,
    hints: p.hints,
    guitarChords: Boolean(guitarInput?.running),
  };
}

function startPractice() {
  if (activePanel || !view.loaded) return;
  audio.ensure();
  hideResult();
  session.start(practiceSettings());
}

function listen() {
  if (activePanel || !view.loaded) return;
  audio.ensure();
  hideResult();
  if (session.state === 'listening') session.stop();
  else session.listen(practiceSettings());
}

function setBpm(bpm, { fromFader = false } = {}) {
  bpm = Math.max(20, Math.min(300, Math.round(bpm)));
  settings.practice.bpm = bpm;
  $('#opt-bpm').value = bpm;
  $('#opt-bpm-range').value = bpm;
  session.setTempo(bpm);
  save();
  if (fromFader) toast(`Tempo ♩ = ${bpm}`);
}

let zoomTimer = null;
function setZoom(z, { fromFader = false } = {}) {
  z = Math.round(z * 20) / 20;
  if (z === +settings.practice.zoom) return;
  settings.practice.zoom = z;
  $('#opt-zoom').value = z;
  save();
  if (fromFader) toast(`Zoom ${Math.round(z * 100)}%`);
  // Re-rendering is expensive: follow a moving fader at most every 150 ms.
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => view.setZoom(+settings.practice.zoom), 150);
}

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1200);
}

/** App actions shared by buttons, computer-keyboard shortcuts and MIDI controller bindings. */
const ACTIONS = {
  play: () => (session.state === 'idle' || session.state === 'listening' ? startPractice() : null),
  stop: () => { session.stopOrRewind(); hideResult(); },
  forward: () => session.step(1),
  back: () => session.step(-1),
  listen,
  restart: () => { session.stop(); session.rewind(); },
  next: () => $('#btn-generate').click(),
  metronome: () => {
    const el = $('#opt-metronome');
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change'));
    toast(`Metronome ${el.checked ? 'on' : 'off'}`);
  },
  tempo: (v) => setBpm(v, { fromFader: true }),
  zoom: (v) => setZoom(v, { fromFader: true }),
};

function runAction(id, value) {
  if (id !== 'zoom') wakeLock.poke();
  // Panels get first refusal on transport actions.
  if (activePanel) {
    if (['play', 'stop', 'forward', 'back'].includes(id) && activePanel.instance.transport?.(id)) return;
    if (id === 'next') return activePanel.instance.next?.();
    if (!['tempo', 'zoom', 'metronome'].includes(id)) return;
  }
  ACTIONS[id]?.(value);
}

function bindPracticeControls() {
  const p = settings.practice;
  const bind = (id, key, { type = 'value', after } = {}) => {
    const el = $(id);
    if (type === 'checked') el.checked = Boolean(p[key]); else el.value = p[key];
    el.addEventListener(type === 'checked' ? 'change' : 'input', () => {
      p[key] = type === 'checked' ? el.checked : el.value;
      save();
      after?.(p[key]);
    });
  };
  bind('#opt-mode', 'mode', { after: () => { session.stop(); syncModeVisibility(); } });
  bind('#opt-bpm', 'bpm', { after: (v) => { $('#opt-bpm-range').value = v; session.setTempo(+v); } });
  bind('#opt-bpm-range', 'bpm', { after: (v) => { $('#opt-bpm').value = v; session.setTempo(+v); } });
  bind('#opt-metronome', 'metronome', { type: 'checked', after: (v) => { audio.ensure(); session.setMetronome(v); } });
  bind('#opt-countin', 'countIn', { type: 'checked' });
  bind('#opt-tolerance', 'tolerance');
  bind('#opt-hints', 'hints', { type: 'checked', after: (v) => session.setHints(v) });
  bind('#opt-autonext', 'autoNext', { type: 'checked' });
  bind('#opt-others', 'others', { type: 'checked' });
  bind('#opt-latency', 'latency');
  bind('#opt-zoom', 'zoom', { after: (v) => view.setZoom(+v) });
  bind('#opt-monitor', 'monitor', { type: 'checked', after: () => audio.ensure() });
  bind('#opt-qwerty', 'qwerty', { type: 'checked' });
  syncModeVisibility();

  // Don't leave focus on buttons/checkboxes, so Space, arrows and the QWERTY piano keep working.
  document.addEventListener('click', (e) => {
    if (e.target.matches('button, input[type="checkbox"]')) e.target.blur();
  });
  $('#btn-start').onclick = () => runAction('play');
  $('#btn-stop').onclick = () => runAction('stop');
  $('#btn-forward').onclick = () => runAction('forward');
  $('#btn-back').onclick = () => runAction('back');
  $('#btn-listen').onclick = () => runAction('listen');
  $('#btn-generate').onclick = () => {
    const tab = currentTab();
    if (tab.kind === 'file') return current.file && loadScore(current.file, current.file.name);
    if (tab.kind === 'panel') return activePanel?.instance.next?.();
    return generate();
  };
  document.querySelectorAll('#instrument button').forEach((b) => { b.onclick = () => setInstrument(b.dataset.instrument); });

  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (activePanel) {
      // Panels handle their own keys; N still means "next".
      if (e.key === 'n' && !settings.practice.qwerty) runAction('next');
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (session.state === 'idle') startPractice(); else session.stop();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      runAction('forward');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      runAction('back');
    } else if (e.key === 'Home') {
      runAction('restart');
    } else if (e.key === 'n' && !settings.practice.qwerty) {
      runAction('next');
    } else if (e.key === 'Escape') {
      runAction('stop');
    }
  });
}

function syncModeVisibility() {
  const tempo = settings.practice.mode === 'tempo';
  document.querySelectorAll('.tempo-only').forEach((el) => { el.hidden = !tempo; });
}

// ------------------------------------------------------------ note input (MIDI, QWERTY, on-screen, guitar)

function handleNoteOn(m, velocity, time, source) {
  wakeLock.poke();
  instrumentView?.setPressed(m, true);
  if (settings.practice.monitor && source !== 'guitar') audio.noteOn(m, velocity);
  if (activePanel) {
    activePanel.instance.noteOn?.(m, time, velocity, source);
    return;
  }
  // In free-tempo mode, simply playing starts the exercise.
  if (session.state === 'idle' && settings.practice.mode === 'wait' && view.loaded && $('#result').hidden) startPractice();
  session.noteOn(m, time, source);
}

function handleNoteOff(m, time, source) {
  instrumentView?.setPressed(m, false);
  if (settings.practice.monitor && source !== 'guitar') audio.noteOff(m);
  activePanel?.instance.noteOff?.(m, time);
}

function bindMidi() {
  midi.on('devices', ({ status, inputs, outputs }) => {
    const pill = $('#midi-status');
    const labels = { ready: inputs.length ? `${inputs.length} MIDI input${inputs.length > 1 ? 's' : ''}` : 'No MIDI device', unsupported: 'Web MIDI not supported', denied: 'MIDI access denied' };
    pill.textContent = labels[status] || status;
    pill.className = `pill ${status === 'ready' && inputs.length ? 'ok' : 'warn'}`;
    const inSel = $('#midi-input');
    const keepIn = midi.inputId;
    inSel.innerHTML = '';
    inSel.add(new Option('All inputs', 'all'));
    inputs.forEach((d) => inSel.add(new Option(d.name, d.id)));
    inSel.value = [...inSel.options].some((o) => o.value === keepIn) ? keepIn : 'all';
    const outSel = $('#midi-output');
    const keepOut = midi.outputId;
    outSel.innerHTML = '';
    outSel.add(new Option('None', ''));
    outputs.forEach((d) => outSel.add(new Option(d.name, d.id)));
    outSel.value = [...outSel.options].some((o) => o.value === keepOut) ? keepOut : '';
  });
  $('#midi-input').onchange = (e) => midi.setInput(e.target.value);
  $('#midi-output').onchange = (e) => midi.setOutput(e.target.value);

  midi.on('noteon', ({ midi: m, velocity, time, source }) => handleNoteOn(m, velocity, time, source));
  midi.on('noteoff', ({ midi: m, time, source }) => handleNoteOff(m, time, source));
  midi.on('control', (msg) => controller.handle(msg));
  attachComputerKeyboard(midi, () => settings.practice.qwerty);
  midi.init();
}

// ------------------------------------------------------------ MIDI controller mapping

const controller = new ControllerMap(settings.controls, {
  onAction: (id, value) => runAction(id, value),
  onChange: () => { save(); renderController(); },
});

function renderController() {
  const list = $('#controller-list');
  list.innerHTML = '';
  for (const a of CONTROL_ACTIONS) {
    const row = document.createElement('div');
    row.className = 'controller-row';
    const name = document.createElement('span');
    name.textContent = a.label;
    const binding = document.createElement('span');
    binding.className = 'muted binding';
    const bs = controller.bindings[a.id];
    binding.textContent = controller.learning === a.id ? 'Waiting for a control…' : bs.length ? bs.map(bindingLabel).join(', ') : '—';
    const learn = document.createElement('button');
    learn.textContent = controller.learning === a.id ? 'Cancel' : 'Learn';
    learn.className = controller.learning === a.id ? 'learning' : '';
    learn.onclick = () => controller.learn(a.id);
    const clear = document.createElement('button');
    clear.textContent = '×';
    clear.title = 'Remove binding';
    clear.disabled = !bs.length;
    clear.onclick = () => controller.clear(a.id);
    row.append(name, binding, learn, clear);
    list.appendChild(row);
  }
  $('#ctl-reset').onclick = () => controller.resetDefaults();
}

// ------------------------------------------------------------ guitar audio input

async function ensureGuitarInput() {
  if (guitarInput) return guitarInput;
  const { GuitarInput } = await import('./io/guitarinput.js');
  guitarInput = new GuitarInput(audio);
  setGuitarRange();
  guitarInput.on('noteon', ({ midi: m, velocity, time }) => handleNoteOn(m, velocity, time, 'guitar'));
  guitarInput.on('noteoff', ({ midi: m, time }) => handleNoteOff(m, time, 'guitar'));
  guitarInput.on('onset', ({ time }) => {
    if (activePanel || !view.loaded) return;
    if (session.state === 'idle' && settings.practice.mode === 'wait' && $('#result').hidden) startPractice();
    session.onset(time, (midis) => guitarInput.verifyNotes(midis));
  });
  guitarInput.on('level', ({ rms, peak }) => {
    const v = Math.min(1, Math.sqrt(peak ?? rms ?? 0));
    $('#gi-level').style.width = `${Math.round(v * 100)}%`;
  });
  guitarInput.on('status', ({ state, message }) => {
    const b = $('#gi-toggle');
    b.textContent = state === 'on' ? 'Guitar input: on' : state === 'starting' ? 'Guitar input…' : 'Guitar input: off';
    b.classList.toggle('on', state === 'on');
    b.title = message || 'Listen to your guitar through the audio interface';
    if (state === 'error') $('#status').textContent = `Guitar input: ${message}`;
    if (state === 'on') refreshGuitarDevices();
  });
  // Panels opened before the input existed get it on the next mount; refresh the current one.
  if (activePanel && settings.instrument === 'guitar') selectTab(settings.tab);
  return guitarInput;
}

/** Limit pitch detection to the instrument's range (helps against octave errors and noise). */
function setGuitarRange() {
  const s = currentTuning().strings;
  guitarInput?.setRange?.(Math.min(...s) - 1, Math.max(...s) + 24);
}

async function refreshGuitarDevices() {
  if (!guitarInput) return;
  const sel = $('#gi-device');
  const devices = await guitarInput.listDevices().catch(() => []);
  sel.innerHTML = '';
  sel.add(new Option('Default input', ''));
  devices.forEach((d) => sel.add(new Option(d.label || 'Audio input', d.id)));
  sel.value = devices.some((d) => d.id === settings.guitar.device) ? settings.guitar.device : '';
}

async function startGuitarInput() {
  try {
    const gi = await ensureGuitarInput();
    audio.ensure();
    const ch = settings.guitar.channel === 'mix' ? 'mix' : +settings.guitar.channel;
    await gi.start(settings.guitar.device || undefined, { channel: ch });
    settings.guitar.enabled = true;
    save();
  } catch (err) {
    console.error(err);
    $('#status').textContent = `Could not start the guitar input: ${err.message || err}`;
  }
}

function stopGuitarInput() {
  guitarInput?.stop();
  settings.guitar.enabled = false;
  save();
}

function bindGuitar() {
  const tuningSel = $('#opt-tuning');
  for (const t of Object.values(TUNINGS)) tuningSel.add(new Option(t.label, t.id));
  tuningSel.value = currentTuning().id;
  tuningSel.onchange = () => {
    settings.guitar.tuning = tuningSel.value;
    save();
    instrumentView?.setTuning?.(currentTuning());
    setGuitarRange();
    if (settings.instrument === 'guitar') selectTab(settings.tab);
  };
  $('#gi-channel').value = settings.guitar.channel;
  $('#gi-channel').onchange = (e) => {
    settings.guitar.channel = e.target.value;
    save();
    if (guitarInput && settings.guitar.enabled) startGuitarInput();
  };
  $('#gi-device').add(new Option('Default input', ''));
  $('#gi-device').onchange = (e) => {
    settings.guitar.device = e.target.value;
    save();
    if (settings.guitar.enabled) startGuitarInput();
  };
  $('#gi-toggle').onclick = () => (settings.guitar.enabled && guitarInput ? stopGuitarInput() : startGuitarInput());
  navigator.mediaDevices?.addEventListener?.('devicechange', onAudioDevicesChanged);
}

/**
 * An audio interface was plugged in or out. Refresh the list; if guitar input is meant to be on but is not running
 * (it stopped when its device went away, or the chosen device was missing), start it again once the device is back.
 */
let deviceChangeTimer = null;
function onAudioDevicesChanged() {
  clearTimeout(deviceChangeTimer);
  deviceChangeTimer = setTimeout(async () => {
    if (!guitarInput) return;
    await refreshGuitarDevices();
    if (!settings.guitar.enabled || guitarInput.running || settings.instrument !== 'guitar') return;
    const devices = await guitarInput.listDevices().catch(() => []);
    if (!settings.guitar.device || devices.some((d) => d.id === settings.guitar.device)) {
      await startGuitarInput();
      if (guitarInput.running) toast('Guitar input reconnected');
    }
  }, 500); // devices often appear in several steps
}

// ------------------------------------------------------------ results & history

function renderStats(s) {
  const pct = Math.round(s.accuracy * 100);
  $('#stats').innerHTML = `<b class="good">✓ ${s.hits}</b> / ${s.notes} &nbsp; <b class="bad">✗ ${s.wrong}</b>`
    + (s.mode === 'tempo' ? ` &nbsp; <b class="warn">missed ${s.missed}</b>` : '')
    + ` &nbsp; ${pct}%`;
}

function addHistory(entry) {
  history.unshift({ t: Date.now(), instrument: settings.instrument, ...entry });
  history = history.slice(0, 200);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

let nextTimer = null;
function finished(summary) {
  addHistory({
    tab: settings.tab,
    title: current.title,
    mode: summary.mode,
    bpm: summary.bpm,
    acc: Math.round(summary.accuracy * 100),
    hits: summary.hits,
    wrong: summary.wrong,
    missed: summary.missed,
  });

  const rows = [
    ['Notes played correctly', `${summary.hits} / ${summary.notes}`],
    ['Wrong notes', summary.wrong],
  ];
  if (summary.mode === 'tempo') {
    rows.push(['Missed notes', summary.missed]);
    rows.push(['Average timing', `${summary.meanOffsetMs > 0 ? '+' : ''}${summary.meanOffsetMs} ms ${summary.meanOffsetMs > 15 ? '(late)' : summary.meanOffsetMs < -15 ? '(early)' : ''}`]);
    rows.push(['Average deviation', `${summary.meanAbsOffsetMs} ms`]);
  } else {
    rows.push(['Clean steps (no mistakes)', `${Math.round(summary.cleanSteps * 100)}%`]);
  }
  rows.push(['Accuracy', `${Math.round(summary.accuracy * 100)}%`]);
  const box = $('#result');
  box.innerHTML = `<h3>${summary.accuracy >= 0.95 ? 'Excellent!' : summary.accuracy >= 0.8 ? 'Well done' : 'Keep practicing'}</h3>`
    + `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`
    + '<div class="buttons"><button id="r-again">Again</button><button id="r-next" class="primary">Next</button></div>';
  box.hidden = false;
  $('#r-again').onclick = () => { clearTimeout(nextTimer); startPractice(); };
  $('#r-next').onclick = () => { clearTimeout(nextTimer); $('#btn-generate').click(); };
  clearTimeout(nextTimer);
  if (settings.practice.autoNext && settings.tab !== 'file' && settings.practice.mode === 'wait') {
    nextTimer = setTimeout(() => generate(), 2500);
  }
}

function hideResult() {
  clearTimeout(nextTimer);
  $('#result').hidden = true;
}

function renderHistory() {
  const ol = $('#history');
  ol.innerHTML = '';
  if (!history.length) {
    ol.innerHTML = '<li class="muted">Finished exercises will appear here.</li>';
    return;
  }
  for (const h of history.slice(0, 30)) {
    const li = document.createElement('li');
    const d = new Date(h.t);
    const when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const how = h.mode === 'panel' ? `${h.correct}/${h.total}` : h.mode === 'tempo' ? `♩=${h.bpm}` : 'free';
    li.innerHTML = `<span class="acc">${h.acc}%</span> ${escapeHtml(h.title || '')} <span class="muted">· ${how} · ${when}</span>`;
    ol.appendChild(li);
  }
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------ file loading

function bindFiles() {
  $('#file-input').addEventListener('change', (e) => openFile(e.target.files[0]));
  for (const el of [$('#file-drop'), $('.score-wrap')]) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); $('#file-drop').classList.add('over'); });
    el.addEventListener('dragleave', () => $('#file-drop').classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      $('#file-drop').classList.remove('over');
      openFile(e.dataTransfer.files[0]);
    });
  }
}

function openFile(file) {
  if (!file) return;
  current.file = file;
  $('#file-name').textContent = file.name;
  if (settings.tab !== 'file') selectTab('file');
  else loadScore(file, file.name);
}

// ------------------------------------------------------------ installable app

function bindPwa() {
  bindInstallButton($('#btn-install'));
  handleLaunchFiles(openFile);
  registerServiceWorker({
    onUpdate: (apply) => {
      $('#update-bar').hidden = false;
      $('#btn-update').onclick = apply;
      $('#btn-update-later').onclick = () => { $('#update-bar').hidden = true; };
    },
  });
}

// ------------------------------------------------------------ go

const unlockAudio = () => audio.ensure();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

const wakeLock = new ScreenWakeLock();

bindPracticeControls();
bindMidi();
bindFiles();
renderController();
renderHistory();
await loadModules();
bindGuitar();
await setInstrument(settings.instrument === 'guitar' ? 'guitar' : 'piano');
bindPwa(); // after the tabs exist: a file opened with the installed app goes to the Score file tab

// Handle for debugging from the browser console.
window.pianoPractice = {
  midi, audio, view, session, settings, controller, generate, loadScore, selectTab, setInstrument, runAction,
  get guitarInput() { return guitarInput; },
  get panel() { return activePanel; },
  get tabs() { return TABS; },
};
