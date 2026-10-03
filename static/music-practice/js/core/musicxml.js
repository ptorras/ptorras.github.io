// Minimal score model -> MusicXML (partwise) writer, for generated exercises.
//
// Score model:
// {
//   title, key: { fifths, mode }, time: { beats, beatType },
//   staves: ['treble', 'bass'],                     // initial clef per staff ('guitar', 'tab' for guitar)
//   tuning?: [40, 45, 50, 55, 59, 64],              // open strings (MIDI, low first) for 'tab' staves
//   measures: [{
//     key?, time?, clefs?: { [staffNumber]: clef },  // changes at measure start
//     voices: [{ staff: 1, events: [Event] }],
//   }],
// }
// Event: { pitches: [Pitch & { finger?, string?, fret? }], dur, rest?, tieStart?, tieStop?, chord? }
//   On 'tab' staves pitches are written with <string>/<fret> (string 1 = highest); elsewhere `finger` is a fingering.
//   chord: { text, root?, bass? } writes a chord symbol (<harmony>) above the event.
// Durations are in DIV units per quarter note.

import { keyAlter, spellMidi } from './theory.js';

export const DIV = 12;
export const Q = DIV; // quarter
export const DUR = { whole: 4 * Q, half: 2 * Q, quarter: Q, eighth: Q / 2, sixteenth: Q / 4 };

export const CLEFS = {
  treble: { sign: 'G', line: 2 },
  bass: { sign: 'F', line: 4 },
  alto: { sign: 'C', line: 3 },
  tenor: { sign: 'C', line: 4 },
  guitar: { sign: 'G', line: 2, octaveChange: -1 }, // treble clef sounding an octave lower
  tab: { sign: 'TAB', line: 5, tab: true },
};

const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

// Representable durations, longest first: [duration, type, dots]
const NOTE_VALUES = [
  [6 * Q, 'whole', 1], [4 * Q, 'whole', 0], [3 * Q, 'half', 1], [2 * Q, 'half', 0],
  [1.5 * Q, 'quarter', 1], [Q, 'quarter', 0], [0.75 * Q, 'eighth', 1], [Q / 2, 'eighth', 0],
  [Q / 4, '16th', 0],
];

export const measureLength = (time) => (time.beats * 4 * Q) / time.beatType;

/** Split a duration into representable note values (greedy). */
export function splitDuration(dur) {
  const out = [];
  let rest = dur;
  while (rest > 0) {
    const v = NOTE_VALUES.find(([d]) => d <= rest);
    if (!v) throw new Error(`Unrepresentable duration ${dur}`);
    out.push(v[0]);
    rest -= v[0];
  }
  return out;
}

function typeOf(dur) {
  const v = NOTE_VALUES.find(([d]) => d === dur);
  if (!v) throw new Error(`No note type for duration ${dur}`);
  return { type: v[1], dots: v[2] };
}

/**
 * Lay out a flat event stream into measures, splitting (and tying) notes across barlines,
 * and padding the final measure with rests.
 * @param events [{ pitches, dur, rest? }]
 * @param measureLen length of each measure (number) or function(measureIndex) -> length
 * @returns array of measures, each an array of events
 */
export function layoutEvents(events, measureLen) {
  const lenOf = typeof measureLen === 'function' ? measureLen : () => measureLen;
  const measures = [[]];
  let pos = 0;
  const push = (ev, dur, tieStart, tieStop) => {
    const parts = splitDuration(dur);
    for (const [i, d] of parts.entries()) {
      const e = { ...ev, dur: d };
      if (!ev.rest) {
        e.tieStop = tieStop || i > 0;
        e.tieStart = tieStart || i < parts.length - 1;
        if (i > 0 || tieStop) e.pitches = ev.pitches.map((p) => ({ ...p, finger: undefined }));
      }
      measures[measures.length - 1].push(e);
    }
  };
  for (const ev of events) {
    let remaining = ev.dur;
    let first = true;
    while (remaining > 0) {
      const room = lenOf(measures.length - 1) - pos;
      const take = Math.min(room, remaining);
      push(ev, take, remaining > take, !first);
      remaining -= take;
      pos += take;
      first = false;
      if (pos === lenOf(measures.length - 1)) {
        measures.push([]);
        pos = 0;
      }
    }
  }
  if (pos === 0) measures.pop();
  else for (const d of splitDuration(lenOf(measures.length - 1) - pos)) measures[measures.length - 1].push({ rest: true, pitches: [], dur: d });
  return measures;
}

/** Helper: a measure filled with a single rest. */
export const restMeasure = (len) => [{ rest: true, pitches: [], dur: len, measureRest: true }];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ACC_NAMES = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };

function clefXml(staff, clef) {
  const c = CLEFS[clef];
  const oct = c.octaveChange ? `<clef-octave-change>${c.octaveChange}</clef-octave-change>` : '';
  return `<clef number="${staff}"><sign>${c.sign}</sign><line>${c.line}</line>${oct}</clef>`;
}

/** Tab staff lines and tuning (line 1 = lowest string). */
function staffDetailsXml(staff, tuning = STANDARD_TUNING) {
  const lines = tuning.map((midi, i) => {
    const p = spellMidi(midi, false);
    const alter = p.alter ? `<tuning-alter>${p.alter}</tuning-alter>` : '';
    return `<staff-tuning line="${i + 1}"><tuning-step>${p.step}</tuning-step>${alter}<tuning-octave>${p.octave}</tuning-octave></staff-tuning>`;
  });
  return `<staff-details number="${staff}"><staff-lines>${tuning.length}</staff-lines>${lines.join('')}</staff-details>`;
}

/** Chord symbol above a note. The exact text is written as a numeral (OSMD prints it verbatim). */
function harmonyXml(chord, staff) {
  const text = typeof chord === 'string' ? chord : chord.text;
  return `<harmony print-frame="no"><numeral><numeral-root text="${esc(text)}">1</numeral-root></numeral>`
    + `<kind>none</kind><staff>${staff}</staff></harmony>`;
}

export function toMusicXML(score) {
  const nStaves = score.staves.length;
  let key = score.key;
  let time = score.time;
  const clefs = [...score.staves]; // current clef per staff
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${esc(score.title || '')}</work-title></work>`);
  out.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
  out.push('<part id="P1">');

  score.measures.forEach((m, mi) => {
    out.push(`<measure number="${mi + 1}">`);
    const attrs = [];
    if (mi === 0) attrs.push(`<divisions>${DIV}</divisions>`);
    if (mi === 0 || m.key) {
      key = m.key || key;
      // Modal keys (dorian, ...) are written as plain key signatures: OSMD misreads other <mode> values.
      const mode = key.mode === 'minor' ? 'minor' : 'major';
      attrs.push(`<key><fifths>${key.fifths}</fifths><mode>${mode}</mode></key>`);
    }
    if (mi === 0 || m.time) {
      time = m.time || time;
      attrs.push(`<time><beats>${time.beats}</beats><beat-type>${time.beatType}</beat-type></time>`);
    }
    if (mi === 0) {
      attrs.push(`<staves>${nStaves}</staves>`);
      score.staves.forEach((c, i) => attrs.push(clefXml(i + 1, c)));
      score.staves.forEach((c, i) => { if (CLEFS[c].tab) attrs.push(staffDetailsXml(i + 1, score.tuning)); });
    } else if (m.clefs) {
      for (const [s, c] of Object.entries(m.clefs)) {
        attrs.push(clefXml(s, c));
        clefs[s - 1] = c;
      }
    }
    if (m.newSystem) out.push('<print new-system="yes"/>');
    if (attrs.length) out.push(`<attributes>${attrs.join('')}</attributes>`);
    if (m.label) {
      out.push(`<direction placement="above"><direction-type><words font-weight="bold">${esc(m.label)}</words></direction-type><staff>1</staff></direction>`);
    }

    const mLen = measureLength(time);
    const accState = {}; // per staff: { 'C4': alter }
    m.voices.forEach((v, vi) => {
      if (vi > 0) out.push(`<backup><duration>${mLen}</duration></backup>`);
      const state = (accState[v.staff] ||= {});
      const tab = Boolean(CLEFS[clefs[v.staff - 1]]?.tab);
      for (const ev of v.events) {
        if (ev.chord) out.push(harmonyXml(ev.chord, v.staff));
        out.push(noteXml(ev, vi + 1, v.staff, key.fifths, state, tab));
      }
    });
    if (m.final) out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    out.push('</measure>');
  });
  out.push('</part></score-partwise>');
  return out.join('\n');
}

function noteXml(ev, voice, staff, fifths, accState, tab = false) {
  if (ev.rest || !ev.pitches.length) {
    const t = ev.measureRest ? null : typeOf(ev.dur);
    return `<note><rest${ev.measureRest ? ' measure="yes"' : ''}/><duration>${ev.dur}</duration><voice>${voice}</voice>`
      + (t ? `<type>${t.type}</type>${'<dot/>'.repeat(t.dots)}` : '') + `<staff>${staff}</staff></note>`;
  }
  const t = typeOf(ev.dur);
  return ev.pitches.map((p, i) => {
    const alter = p.alter || 0;
    const id = p.step + p.octave;
    const current = id in accState ? accState[id] : keyAlter(p.step, fifths);
    let acc = '';
    if (!tab && !ev.tieStop && (alter !== current || p.cautionary)) {
      acc = `<accidental>${ACC_NAMES[alter]}</accidental>`;
      accState[id] = alter;
    }
    const ties = (ev.tieStop ? '<tie type="stop"/>' : '') + (ev.tieStart ? '<tie type="start"/>' : '');
    const tied = (ev.tieStop ? '<tied type="stop"/>' : '') + (ev.tieStart ? '<tied type="start"/>' : '');
    let tech = '';
    if (tab) {
      if (p.string != null && p.fret != null) tech = `<technical><string>${p.string}</string><fret>${p.fret}</fret></technical>`;
    } else if (p.finger) {
      tech = `<technical><fingering>${p.finger}</fingering></technical>`;
    }
    const notations = tied || tech ? `<notations>${tied}${tech}</notations>` : '';
    return '<note>' + (i > 0 ? '<chord/>' : '')
      + `<pitch><step>${p.step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`
      + `<duration>${ev.dur}</duration>${ties}<voice>${voice}</voice>`
      + `<type>${t.type}</type>${'<dot/>'.repeat(t.dots)}${acc}<staff>${staff}</staff>${notations}</note>`;
  }).join('');
}
