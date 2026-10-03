// Fretboard patterns: scale positions (CAGED-style boxes and 3 notes per string), arpeggio shapes and neck maps.
// Notes are { midi, string, fret, finger, role }, string 1 = highest string, finger 1-4 (0 = open string).

import { scaleIntervals, scaleSize } from '../core/theory.js';
import { CHORD_TYPES } from '../core/chords.js';
import { tuningStrings, intervalName, MAX_FRET } from './tunings.js';

const mod12 = (n) => ((n % 12) + 12) % 12;

/** Semitone -> role label for a chord type ('R', '3', '♭7', '9'...), keyed by semitones mod 12. */
export function chordRoles(chordType) {
  const roles = {};
  for (const [semi, , role] of CHORD_TYPES[chordType].tones) roles[mod12(semi)] = role;
  return roles;
}

/**
 * Every fret position of a set of intervals above a root.
 * @param intervals semitones above the root (any octave)
 * @param roles optional { semitones: label } (defaults to interval names)
 * @returns [{ string, fret, midi, interval, role }] with interval = semitones above the root (0-11)
 */
export function neckMap(intervals, rootPc, tuning, { maxFret = 15, roles = null } = {}) {
  const open = tuningStrings(tuning);
  const set = new Set(intervals.map(mod12));
  const out = [];
  for (let s = 1; s <= open.length; s++) {
    const o = open[open.length - s];
    for (let fret = 0; fret <= maxFret; fret++) {
      const interval = mod12(o + fret - rootPc);
      if (!set.has(interval)) continue;
      out.push({ string: s, fret, midi: o + fret, interval, role: roles?.[interval] ?? intervalName(interval) });
    }
  }
  return out;
}

/**
 * Left-hand fingers for the frets played on one string in a position whose index finger sits on `a`.
 * One finger per fret; a stretch below the box takes finger 1, above it finger 4. Open strings get 0.
 */
function stringFingers(frets, a) {
  const f = frets.map((fret) => (fret === 0 ? 0 : Math.max(1, Math.min(4, fret - (a === 0 ? 1 : a) + 1))));
  const idx = f.map((x, i) => i).filter((i) => f[i] > 0);
  for (let k = 1; k < idx.length; k++) {
    if (f[idx[k]] <= f[idx[k - 1]]) f[idx[k]] = f[idx[k - 1]] + 1;
  }
  for (let k = idx.length - 1; k >= 0; k--) {
    const max = 4 - (idx.length - 1 - k);
    if (f[idx[k]] > max) f[idx[k]] = Math.max(1, max);
  }
  return f;
}

/**
 * One box pattern: the scale notes playable with the index finger at fret `a` (frets a..a+3, stretching one fret
 * either side when needed), from the lowest string to the highest. a = 0 is the open position.
 * @returns { a, notes: [{ midi, stringIdx, fret }], cost }
 */
function boxPattern(pcSet, open, a, nPerOctave) {
  const lo = a === 0 ? 0 : a;
  const hi = a === 0 ? 3 : a + 3;
  // Distance outside the comfortable window (open strings next to the first fret are free).
  const out = (f) => (f < 0 ? 99 : f === 0 && a <= 1 ? 0 : Math.max(0, lo - f, f - hi));
  const target = Math.round(nPerOctave * 0.4 + 0.2);
  const n = open.length;
  const notes = [];
  const counts = new Array(n).fill(0);
  const stretchLow = new Array(n).fill(false);
  let cur = 0;
  let midi = open[0] + Math.max(0, lo);
  while (!pcSet.has(mod12(midi))) midi++;
  let cost = 0;
  for (; ; midi++) {
    if (!pcSet.has(mod12(midi))) continue;
    const opts = [];
    const fc = midi - open[cur];
    if (out(fc) <= 2 && !(fc > hi && stretchLow[cur])) {
      opts.push({ s: cur, f: fc, c: 3 * out(fc) + (counts[cur] >= target ? 2 : 0) });
    }
    if (cur + 1 < n) {
      const fn = midi - open[cur + 1];
      if (out(fn) <= 2) opts.push({ s: cur + 1, f: fn, c: 3 * out(fn) + (counts[cur] < target - 1 ? 2 : counts[cur] < target ? 1 : 0) });
    }
    if (cur === n - 1 && fc > hi) break; // past the top of the box
    if (!opts.length) {
      if (cur >= n - 2) break;
      cur++; // unusual tunings: skip a string whose window this pitch cannot reach, then retry it
      midi--;
      continue;
    }
    const best = opts.reduce((x, y) => (y.c < x.c ? y : x));
    if (best.s !== cur) cur = best.s;
    if (best.f < lo && best.f > 0) stretchLow[cur] = true;
    cost += out(best.f);
    counts[cur]++;
    notes.push({ midi, stringIdx: cur, fret: best.f });
  }
  for (const c of counts) if (!c) cost += 3;
  return { a, notes, cost };
}

/** Finish raw box notes: string numbers, fingers, roles; ascending by pitch. */
function finishNotes(raw, a, open, rootPc, roles) {
  const n = open.length;
  const byString = new Map();
  for (const note of raw) {
    if (!byString.has(note.stringIdx)) byString.set(note.stringIdx, []);
    byString.get(note.stringIdx).push(note);
  }
  for (const list of byString.values()) {
    const fingers = stringFingers(list.map((x) => x.fret), a);
    list.forEach((x, i) => { x.finger = fingers[i]; });
  }
  return raw.map(({ midi, stringIdx, fret, finger }) => {
    const semi = mod12(midi - rootPc);
    return { midi, string: n - stringIdx, fret, finger, role: roles?.[semi] ?? intervalName(semi) };
  });
}

/** Choose `count` box positions around the octave (gaps of 2-3 frets) with the fewest stretches. */
function chooseBoxes(pcSet, open, nPerOctave, count = 5) {
  const boxes = [];
  for (let a = 0; a < 12; a++) boxes.push(boxPattern(pcSet, open, a, nPerOctave));
  // Gap sequences of 2s and 3s that add up to 12.
  const seqs = [];
  const rec = (seq, sum) => {
    if (seq.length === count) { if (sum === 12) seqs.push(seq); return; }
    for (const g of [2, 3]) rec([...seq, g], sum + g);
  };
  rec([], 0);
  let best = null;
  for (let s = 0; s < 12; s++) {
    for (const seq of seqs) {
      const starts = [];
      let a = s;
      for (const g of seq) { starts.push(a % 12); a += g; }
      const cost = starts.reduce((t, x) => t + boxes[x].cost, 0);
      if (!best || cost < best.cost) best = { cost, starts };
    }
  }
  return best.starts.sort((x, y) => x - y).map((a) => boxes[a]);
}

function boxPositions(intervals, rootPc, tuning, roles) {
  const open = tuningStrings(tuning);
  const pcSet = new Set(intervals.map((i) => mod12(rootPc + i)));
  const n = pcSet.size;
  return chooseBoxes(pcSet, open, n).map((box, i) => {
    const notes = finishNotes(box.notes, box.a, open, rootPc, roles);
    const frets = notes.map((x) => x.fret).filter((f) => f > 0);
    const lo = Math.min(...frets);
    const hi = Math.max(...frets);
    return { index: i + 1, label: `Position ${i + 1} (frets ${box.a === 0 ? 0 : lo}–${hi})`, fret: box.a, notes };
  });
}

/** Fingers for three notes on one string, by their spacing. */
function threeNoteFingers(frets) {
  const d1 = frets[1] - frets[0];
  const d2 = frets[2] - frets[1];
  if (frets[0] === 0) return [0, Math.min(frets[1], 3), Math.min(frets[2], 4)];
  if (d1 === 1 && d2 === 1) return [1, 2, 3];
  if (d2 === 1 || d1 > d2) return [1, 3, 4];
  return [1, 2, 4];
}

/** One 3-notes-per-string pattern starting on scale degree k, with the root `base` semitones above the low string. */
function threeNpsPattern(iv, k, base, open, rootPc) {
  const notes = [];
  const n = open.length;
  for (let s = 0; s < n; s++) {
    const frets = [];
    for (let j = 0; j < 3; j++) {
      const deg = k + 3 * s + j;
      const midi = open[0] + base + 12 * Math.floor(deg / 7) + iv[deg % 7];
      frets.push(midi - open[s]);
      notes.push({ midi, string: n - s, fret: midi - open[s], role: intervalName(midi - rootPc) });
    }
    const fingers = threeNoteFingers(frets);
    notes.slice(-3).forEach((x, j) => { x.finger = fingers[j]; });
  }
  return notes;
}

function threeNpsPositions(type, rootPc, tuning) {
  if (scaleSize(type) !== 7) return [];
  const open = tuningStrings(tuning);
  const iv = scaleIntervals(type);
  const rootFret = mod12(rootPc - open[0]);
  const out = [];
  for (let k = 0; k < 7; k++) {
    // Lowest octave whose pattern fits on the neck (patterns starting above fret 12 move down an octave).
    for (const base of [rootFret - 12, rootFret, rootFret + 12]) {
      if (base + iv[k] < 0) continue;
      const notes = threeNpsPattern(iv, k, base, open, rootPc);
      if (notes.some((x) => x.fret < 0) || notes.some((x) => x.fret > MAX_FRET)) continue;
      out.push({ fret: base + iv[k], notes });
      break;
    }
  }
  out.sort((x, y) => x.fret - y.fret);
  return out.map((p, i) => {
    const frets = p.notes.map((x) => x.fret);
    return {
      index: i + 1, label: `Pattern ${i + 1} (frets ${Math.min(...frets)}–${Math.max(...frets)})`, fret: p.fret, notes: p.notes,
    };
  });
}

/**
 * Scale positions on the neck.
 * @param system 'caged' (5 box positions, any scale) or '3nps' (three notes per string, 7-note scales; [] otherwise)
 * @returns [{ index, label, fret, notes: [{ midi, string, fret, finger, role }] }], lowest position first
 */
export function scalePositions(type, rootPc, tuning, { system = 'caged' } = {}) {
  if (system === '3nps') return threeNpsPositions(type, rootPc, tuning);
  return boxPositions(scaleIntervals(type), rootPc, tuning, null);
}

/** Arpeggio shapes of a chord type: 5 box positions built from the chord tones; roles are chord roles. */
export function arpeggioPositions(chordType, rootPc, tuning) {
  const intervals = [...new Set(CHORD_TYPES[chordType].tones.map(([s]) => mod12(s)))];
  return boxPositions(intervals, rootPc, tuning, chordRoles(chordType));
}
