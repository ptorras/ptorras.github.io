// Panel tabs: self-contained trainer views (chord quiz, ear training, tuner, cheat sheets...) shown in the
// main area instead of the score. This file documents the contract and provides shared helpers.
//
// A panel module exports a definition:
//
//   export const myPanel = {
//     id: 'chords',                         // unique tab id
//     label: 'Chords',                      // tab label
//     description: 'One sentence shown under the tabs.',
//     instrument: 'piano' | 'guitar' | 'both',
//     kind: 'panel',
//     options: [...],                       // same schema as exercises (js/ui/forms.js); rendered in the sidebar
//     create(ctx) { return instance; },
//   };
//
// ctx (provided by main.js):
//   container      HTMLElement to render into (empty, fills the main area, scrolls vertically)
//   values         the panel's option values (live object; also passed to onOptions)
//   instrument     'piano' | 'guitar' (the instrument mode the app is in)
//   tuning         guitar tuning { id, label, strings: [MIDI low→high] } (always set, even in piano mode)
//   audio          AudioEngine: ensure(), now, playNote(midi, time, duration, velocity), noteOn(midi, vel),
//                  noteOff(midi), click(time, accent), startClicks(iter), stopClicks(), timbre ('piano'|'guitar')
//   setStatus(text)                   status line in the transport bar
//   setHints(items)                   highlight notes on the on-screen keyboard / fretboard;
//                                     items: MIDI numbers or { midi, string?, fret? } (string 1 = high e)
//   flash(midi, kind)                 brief feedback on the on-screen instrument ('wrong' | 'good')
//   recordResult({ title, correct, total })   adds an entry to the practice history
//   makeRng(seed?)                    seeded RNG (js/core/rng.js)
//   guitarInput    GuitarInput (js/io/guitarinput.js) when the guitar audio input exists, else null. Panels may
//                  subscribe to its events (e.g. 'pitch' for a tuner) and must unsubscribe in destroy().
//
// instance (all methods optional except destroy):
//   onOptions(values)                 options changed in the sidebar
//   noteOn(midi, time, velocity, source)   played note (MIDI keyboard, QWERTY, on-screen, or guitar pitch
//                                     detection: source 'guitar'); time = performance.now() ms
//   noteOff(midi, time)
//   heldNotes is not tracked for you: keep your own Set if you need chords (see heldTracker below).
//   transport(action)                 MIDI controller / keyboard transport: 'play' | 'stop' | 'forward' | 'back'
//                                     return true if handled
//   next()                            "New exercise" button / N key
//   destroy()                         remove listeners, stop audio

/* global opensheetmusicdisplay */

import { toMusicXML } from '../core/musicxml.js';

/** Tracks held notes from noteOn/noteOff (for chord answers). */
export function heldTracker() {
  const held = new Set();
  return {
    held,
    on(m) { held.add(m); },
    off(m) { held.delete(m); },
    clear() { held.clear(); },
    get midis() { return [...held].sort((a, b) => a - b); },
  };
}

/**
 * Render a small score (a score model, see js/core/musicxml.js) into a container with OSMD, without cursor
 * or title. Returns the OSMD instance. Re-rendering into the same container replaces the previous score.
 */
export async function renderMiniScore(container, score, { zoom = 1.1 } = {}) {
  container.innerHTML = '';
  const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
    backend: 'svg',
    autoResize: true,
    drawTitle: false,
    drawSubtitle: false,
    drawCredits: false,
    drawPartNames: false,
    drawMeasureNumbers: false,
    drawFingerings: true,
    autoBeam: true,
  });
  osmd.setLogLevel('warn');
  await osmd.load(toMusicXML({ ...score, title: '' }));
  osmd.Zoom = zoom;
  osmd.render();
  return osmd;
}

/** Small DOM helper: h('div', { class: 'x', onclick }, 'text', child...) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
